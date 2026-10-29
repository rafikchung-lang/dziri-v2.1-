'use strict';
/**
 * Moderation business logic shared by slash & prefix commands (and AutoMod).
 * Handles: hierarchy checks, reason selection, timed text/voice mutes (persisted, survive restarts),
 * history entries, Discord log embeds and optional DMs.
 */
const { PermissionFlagsBits } = require('discord.js');
const store = require('../database/store');
const configService = require('./configService');
const historyService = require('./historyService');
const loggingService = require('./loggingService');
const { parseDuration, formatDuration } = require('../utils/duration');
const logger = require('../utils/logger');

const MAX_TIMEOUT = 28 * 86_400_000;
const state = () => {
  const s = store.read('state', 'mutes', () => ({ text: [], voice: [], bans: [] }));
  if (!Array.isArray(s.text)) s.text = [];
  if (!Array.isArray(s.voice)) s.voice = [];
  if (!Array.isArray(s.bans)) s.bans = [];
  return s;
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
function hierarchyError(guild, executor, target) {
  if (!target || !target.roles) return null;
  if (target.id === guild.ownerId) return 'You cannot moderate the server owner.';
  if (executor && target.id === executor.id) return 'You cannot moderate yourself.';
  if (target.id === guild.client.user.id) return 'I cannot moderate myself.';
  const me = guild.members.me;
  if (executor && executor.id !== guild.ownerId && target.roles.highest.position >= executor.roles.highest.position) {
    return 'You cannot moderate a member with an equal or higher role than yours.';
  }
  if (me && target.roles.highest.position >= me.roles.highest.position) {
    return 'I cannot moderate this member — their highest role is above or equal to mine.';
  }
  const prot = configService.getGuildConfig(guild.id).moderation.protectedRoles || [];
  if (executor && !executor.permissions.has(PermissionFlagsBits.Administrator) && prot.some((r) => target.roles.cache.has(r))) {
    return 'This member has a protected role.';
  }
  return null;
}

/**
 * Determine reason + duration for a moderation command.
 * - explicit reason text matching a configured reason → uses that reason's duration
 * - no reason → Discord select menu with the command's own reasons from the dashboard
 * - explicit duration argument always overrides
 * Returns { reason, durationStr, durationMs } or null when cancelled.
 */
async function pickReason(ctx, { usesDuration = false, title } = {}) {
  const cfg = ctx.cfg;
  let reason = ctx.args.reason ? String(ctx.args.reason).trim() : '';
  let durationStr = ctx.args.duration ? String(ctx.args.duration) : '';
  if (reason) {
    const match = cfg.reasons.find((r) => r.label.toLowerCase() === reason.toLowerCase());
    if (match && !durationStr) durationStr = match.duration;
  } else if (cfg.reasons.length && cfg.useReasonMenu !== false) {
    const picked = await ctx.chooseReason(title);
    if (!picked) return null;
    reason = picked.label;
    if (!durationStr) durationStr = picked.duration;
  } else {
    reason = 'No reason provided';
  }
  if (usesDuration && !durationStr) durationStr = cfg.defaultDuration || '';
  let durationMs = null;
  if (usesDuration) {
    durationMs = durationStr ? parseDuration(durationStr) : null;
    if (durationMs === null) durationMs = 0; // empty = permanent
  }
  return { reason, durationStr: usesDuration ? (durationMs === 0 ? 'permanent' : durationStr) : '', durationMs };
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
async function record(guild, { type, target, moderator, reason, duration, logEvent = 'moderation', dm = true, cmdCfg, extra = [] }) {
  const user = target && (target.user || target);
  const modUser = moderator && (moderator.user || moderator);
  historyService.add(guild.id, {
    type,
    targetId: user ? user.id : '',
    targetTag: user ? (user.tag || user.username) : '',
    moderatorId: modUser ? modUser.id : '',
    moderatorTag: modUser ? (modUser.tag || modUser.username) : 'Dziri System',
    reason, duration,
  });
  if (!cmdCfg || cmdCfg.log !== false) {
    await loggingService.log(guild, logEvent, {
      title: `${LABELS[type] || type}`,
      user,
      fields: [
        { name: 'Member', value: user ? `<@${user.id}> (${user.tag || user.username})` : '—' },
        { name: 'Moderator', value: modUser ? `<@${modUser.id}>` : 'Dziri System' },
        { name: 'Reason', value: reason || '—', inline: false },
        ...(duration ? [{ name: 'Duration', value: duration === 'permanent' ? 'Permanent' : duration }] : []),
        ...extra,
      ],
    });
  }
  const gcfg = configService.getGuildConfig(guild.id);
  if (dm && gcfg.moderation.dmOnAction && (!cmdCfg || cmdCfg.dmTarget !== false) && user && !user.bot) {
    const verb = DM_VERBS[type];
    if (verb) {
      user.send({ content: `You were **${verb}** in **${guild.name}**.\nReason: ${reason || '—'}${duration ? `\nDuration: ${duration === 'permanent' ? 'Permanent' : duration}` : ''}` }).catch(() => {});
    }
  }
}

const LABELS = {
  textmute: '🔇 Text Mute', textunmute: '🔊 Text Unmute', voicemute: '🎙️ Voice Mute', voiceunmute: '🎙️ Voice Unmute',
  ban: '🔨 Ban', unban: '♻️ Unban', kick: '👢 Kick', purge: '🧹 Purge', lock: '🔒 Lock', unlock: '🔓 Unlock',
  roleadd: '➕ Role Added', roleremove: '➖ Role Removed', automod: '🛡️ AutoMod', warn: '⚠️ Warning',
};
const DM_VERBS = { textmute: 'text-muted', voicemute: 'voice-muted', ban: 'banned', kick: 'kicked', textunmute: 'unmuted', voiceunmute: 'voice-unmuted' };

// ---------------------------------------------------------------------------
// Text mute
// ---------------------------------------------------------------------------
async function textMute(guild, member, moderator, { reason, durationMs, durationStr, cmdCfg, source = 'command' }) {
  const mod = configService.getGuildConfig(guild.id).moderation;
  const auditReason = `${moderator ? (moderator.user || moderator).tag : 'Dziri System'}: ${reason}`.slice(0, 500);
  if (mod.muteMode === 'role' && mod.muteRoleId) {
    const role = guild.roles.cache.get(mod.muteRoleId);
    if (!role) throw new Error('The configured mute role no longer exists.');
    await member.roles.add(role, auditReason);
    const s = state();
    s.text = s.text.filter((m) => !(m.guildId === guild.id && m.userId === member.id));
    if (durationMs > 0) s.text.push({ guildId: guild.id, userId: member.id, until: Date.now() + durationMs, mode: 'role' });
    store.markDirty('state', 'mutes');
  } else {
    const ms = durationMs > 0 ? Math.min(durationMs, MAX_TIMEOUT) : MAX_TIMEOUT;
    await member.timeout(ms, auditReason);
    if (!durationMs) durationStr = '28d (Discord maximum timeout)';
  }
  await record(guild, { type: 'textmute', target: member, moderator, reason, duration: durationStr, cmdCfg, extra: source === 'automod' ? [{ name: 'Source', value: 'AutoMod' }] : [] });
  return durationStr;
}

async function textUnmute(guild, member, moderator, { reason, cmdCfg }) {
  const mod = configService.getGuildConfig(guild.id).moderation;
  const auditReason = `${moderator ? (moderator.user || moderator).tag : 'Dziri System'}: ${reason}`.slice(0, 500);
  let changed = false;
  if (member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()) {
    await member.timeout(null, auditReason); changed = true;
  }
  if (mod.muteRoleId && member.roles.cache.has(mod.muteRoleId)) { await member.roles.remove(mod.muteRoleId, auditReason); changed = true; }
  const s = state();
  const before = s.text.length;
  s.text = s.text.filter((m) => !(m.guildId === guild.id && m.userId === member.id));
  if (s.text.length !== before) store.markDirty('state', 'mutes');
  if (!changed) return false;
  await record(guild, { type: 'textunmute', target: member, moderator, reason, cmdCfg });
  return true;
}

// ---------------------------------------------------------------------------
// Voice mute (server mute). Works even if the member is not in voice right now:
// the mute is applied the moment they join a voice channel.
// ---------------------------------------------------------------------------
async function voiceMute(guild, member, moderator, { reason, durationMs, durationStr, cmdCfg }) {
  const s = state();
  s.voice = s.voice.filter((m) => !(m.guildId === guild.id && m.userId === member.id));
  const entry = { guildId: guild.id, userId: member.id, until: durationMs > 0 ? Date.now() + durationMs : 0, applied: false };
  if (member.voice && member.voice.channelId) {
    await member.voice.setMute(true, reason.slice(0, 500));
    entry.applied = true;
  }
  s.voice.push(entry);
  store.markDirty('state', 'mutes');
  await record(guild, { type: 'voicemute', target: member, moderator, reason, duration: durationStr, cmdCfg, extra: entry.applied ? [] : [{ name: 'Note', value: 'Member not in voice — mute applies when they join.' }] });
  return entry.applied;
}

async function voiceUnmute(guild, member, moderator, { reason, cmdCfg, silent = false }) {
  const s = state();
  const had = s.voice.some((m) => m.guildId === guild.id && m.userId === member.id);
  s.voice = s.voice.filter((m) => !(m.guildId === guild.id && m.userId === member.id));
  let applied = false;
  if (member.voice && member.voice.channelId) {
    if (member.voice.serverMute) await member.voice.setMute(false, reason.slice(0, 500));
    applied = true;
  } else if (had) {
    s.voice.push({ guildId: guild.id, userId: member.id, until: -1, pendingUnmute: true });
  }
  store.markDirty('state', 'mutes');
  if (!silent) await record(guild, { type: 'voiceunmute', target: member, moderator, reason, cmdCfg });
  return applied || had;
}

/** Called from voiceStateUpdate when someone joins voice. */
async function onVoiceJoin(member) {
  const s = state();
  const e = s.voice.find((m) => m.guildId === member.guild.id && m.userId === member.id);
  if (!e) return;
  try {
    if (e.pendingUnmute) {
      if (member.voice.serverMute) await member.voice.setMute(false, 'Dziri System: voice mute expired');
      s.voice = s.voice.filter((m) => m !== e);
    } else if (e.until === 0 || e.until > Date.now()) {
      if (!member.voice.serverMute) await member.voice.setMute(true, 'Dziri System: active voice mute');
      e.applied = true;
    }
    store.markDirty('state', 'mutes');
  } catch (err) { logger.warn('Moderation', 'onVoiceJoin failed:', err.message); }
}

// ---------------------------------------------------------------------------
// Expiry scheduler — one cheap 30 s timer for everything.
// ---------------------------------------------------------------------------
let ticker = null;
function startScheduler(client) {
  if (ticker) return;
  ticker = setInterval(() => tick(client).catch((e) => logger.warn('Moderation', 'tick failed', e.message)), 30_000);
  ticker.unref();
  tick(client).catch(() => {});
}

async function tick(client) {
  const s = state();
  const now = Date.now();
  let changed = false;
  for (const m of [...s.text]) {
    if (!m.until || m.until > now) continue;
    s.text = s.text.filter((x) => x !== m); changed = true;
    const guild = client.guilds.cache.get(m.guildId);
    if (!guild) continue;
    const member = await guild.members.fetch(m.userId).catch(() => null);
    const roleId = configService.getGuildConfig(guild.id).moderation.muteRoleId;
    if (member && roleId && member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, 'Dziri System: text mute expired').catch(() => {});
      historyService.add(guild.id, { type: 'textunmute', targetId: member.id, targetTag: member.user.tag, moderatorTag: 'Dziri System', reason: 'Mute expired' });
    }
  }
  for (const m of [...s.voice]) {
    if (m.pendingUnmute || !m.until || m.until > now) continue;
    s.voice = s.voice.filter((x) => x !== m); changed = true;
    const guild = client.guilds.cache.get(m.guildId);
    if (!guild) continue;
    const member = await guild.members.fetch(m.userId).catch(() => null);
    if (!member) continue;
    if (member.voice.channelId) {
      if (member.voice.serverMute) await member.voice.setMute(false, 'Dziri System: voice mute expired').catch(() => {});
    } else if (m.applied) {
      s.voice.push({ guildId: guild.id, userId: member.id, until: -1, pendingUnmute: true });
    }
    historyService.add(guild.id, { type: 'voiceunmute', targetId: member.id, targetTag: member.user.tag, moderatorTag: 'Dziri System', reason: 'Voice mute expired' });
  }
  for (const b of [...(s.bans || [])]) {
    if (b.until > now) continue;
    s.bans = s.bans.filter((x) => x !== b); changed = true;
    const guild = client.guilds.cache.get(b.guildId);
    if (!guild) continue;
    const ok = await guild.members.unban(b.userId, 'Dziri System: temporary ban expired').then(() => true).catch(() => false);
    if (ok) {
      historyService.add(guild.id, { type: 'unban', targetId: b.userId, moderatorTag: 'Dziri System', reason: 'Temporary ban expired' });
      await loggingService.log(guild, 'unban', { title: '♻️ Temporary ban expired', fields: [{ name: 'User', value: `<@${b.userId}> (${b.userId})` }] });
    }
  }
  if (changed) store.markDirty('state', 'mutes');
}

function scheduleUnban(guildId, userId, until) {
  const s = state();
  s.bans = (s.bans || []).filter((b) => !(b.guildId === guildId && b.userId === userId));
  s.bans.push({ guildId, userId, until });
  store.markDirty('state', 'mutes');
}
function cancelUnban(guildId, userId) {
  const s = state();
  s.bans = (s.bans || []).filter((b) => !(b.guildId === guildId && b.userId === userId));
  store.markDirty('state', 'mutes');
}

function activeCounts(guildId) {
  const s = state();
  return {
    textMutes: s.text.filter((m) => m.guildId === guildId).length,
    voiceMutes: s.voice.filter((m) => m.guildId === guildId && !m.pendingUnmute).length,
  };
}

module.exports = {
  hierarchyError, pickReason, record, textMute, textUnmute, voiceMute, voiceUnmute, onVoiceJoin,
  startScheduler, activeCounts, formatDuration, LABELS, scheduleUnban, cancelUnban,
};
