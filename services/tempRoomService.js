'use strict';
/**
 * Temporary Voice Rooms (main Dziri System bot).
 *
 * Join-to-create → private voice channel owned by the member.
 * Control panel  → one persistent message (buttons, like the reference layout) that any room
 *                  owner can use; each button performs a REAL Discord action on the room they own.
 * Cleanup        → rooms are deleted when empty, and reconciled on startup (no duplicates).
 *
 * State: data/state/temprooms.json  { guilds: { [id]: { rooms: { [channelId]: {...} } } } }
 */
const path = require('path');
const fs = require('fs');
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits,
  AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, MessageFlags,
} = require('discord.js');
const store = require('../database/store');
const configService = require('./configService');
const botRegistry = require('./botRegistry');
const panelDelivery = require('./panelDelivery');
const loggingService = require('./loggingService');
const { ROOM_ACTIONS, defaultRoomButtons } = require('../config/defaults');
const logger = require('../utils/logger');

const UPLOAD_DIR = path.join(store.DATA_DIR, 'uploads');
const P = 'dz-room-';
const CID = {
  lock: `${P}lock`, unlock: `${P}unlock`, hide: `${P}hide`, unhide: `${P}unhide`, allow: `${P}allow`,
  deny: `${P}deny`, kick: `${P}kick`, limit: `${P}limit`, rename: `${P}rename`, claim: `${P}claim`,
  remove: `${P}remove`, limitUp: `${P}limitUp`, limitDown: `${P}limitDown`,
  allowPick: `${P}allow-pick`, denyPick: `${P}deny-pick`, kickPick: `${P}kick-pick`, claimPick: `${P}claim-pick`,
  renameModal: `${P}rename-modal`, limitModal: `${P}limit-modal`,
};

let clientRef = null; // main bot: owns room creation / cleanup
const pendingDelete = new Map(); // channelId -> timeout
let chatCleanupTimer = null;

function state() {
  const s = store.read('state', 'temprooms', () => ({ guilds: {} }));
  if (!s.guilds) s.guilds = {};
  return s;
}
function gstate(guildId) {
  const s = state();
  if (!s.guilds[guildId]) s.guilds[guildId] = { rooms: {} };
  if (!s.guilds[guildId].rooms) s.guilds[guildId].rooms = {};
  return s.guilds[guildId];
}
const cfgOf = (guildId) => configService.getGuildConfig(guildId).tempRooms;
const hex = (c) => { const n = parseInt(String(c || '#a855f7').replace('#', '').slice(0, 6), 16); return Number.isNaN(n) ? 0xa855f7 : n; };

function setClient(c) { clientRef = c; }
/** Any connected client that can see this guild (used for status / publishing). */
function anyClient(guildId) {
  for (const key of ['main', 'ticket']) {
    const c = botRegistry.get(key);
    if (c && c.isReady() && (!guildId || c.guilds.cache.has(guildId))) return c;
  }
  return clientRef && clientRef.isReady() ? clientRef : null;
}

// ---------------------------------------------------------------------------
// Creation / cleanup
// ---------------------------------------------------------------------------
function roomName(format, member, n) {
  return String(format || "{username}'s Room")
    .replaceAll('{username}', member.user.username)
    .replaceAll('{displayname}', member.displayName)
    .replaceAll('{user}', member.displayName)
    .replaceAll('{number}', String(n))
    .slice(0, 100) || `${member.user.username}'s Room`;
}

async function onVoiceUpdate(oldState, newState) {
  try {
    const guild = newState.guild || oldState.guild;
    const cfg = cfgOf(guild.id);
    if (!cfg.enabled) return;
    if (newState.channelId && newState.channelId === cfg.joinChannelId && newState.member && !newState.member.user.bot) {
      await createRoom(newState.member, cfg);
    }
    if (oldState.channelId && oldState.channelId !== newState.channelId) await maybeDelete(guild, oldState.channelId, cfg);
  } catch (err) { logger.warn('TempRooms', 'voice update failed:', err.message); }
}

async function createRoom(member, cfg) {
  const guild = member.guild;
  const gs = gstate(guild.id);
  const mine = Object.values(gs.rooms).filter((r) => r.ownerId === member.id && guild.channels.cache.has(r.channelId));
  if (mine.length >= Math.max(1, Number(cfg.maxRoomsPerUser) || 1)) {
    const existing = guild.channels.cache.get(mine[0].channelId);
    if (existing) { await member.voice.setChannel(existing).catch(() => {}); return existing; }
  }
  const category = cfg.categoryId ? guild.channels.cache.get(cfg.categoryId) : null;
  if (cfg.categoryId && (!category || category.type !== ChannelType.GuildCategory)) logger.warn('TempRooms', 'Configured category is missing.');
  const me = guild.members.me;
  const n = Object.keys(gs.rooms).length + 1;
  let channel;
  try {
    channel = await guild.channels.create({
      name: roomName(cfg.nameFormat, member, n),
      type: ChannelType.GuildVoice,
      parent: category && category.type === ChannelType.GuildCategory ? category.id : (guild.channels.cache.get(cfg.joinChannelId) || {}).parentId || undefined,
      userLimit: Math.max(0, Math.min(99, Number(cfg.defaultUserLimit) || 0)),
      permissionOverwrites: [
        ...(cfg.defaultLocked ? [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] }] : []),
        { id: member.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream] },
        ...(me ? [{ id: me.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] }] : []),
      ],
      reason: `Temporary room for ${member.user.tag}`,
    });
  } catch (err) { logger.error('TempRooms', 'Create failed:', err.message); return null; }

  gs.rooms[channel.id] = { channelId: channel.id, ownerId: member.id, createdAt: Date.now(), locked: Boolean(cfg.defaultLocked), hidden: false };
  store.markDirty('state', 'temprooms');
  await member.voice.setChannel(channel).catch(() => {});
  await logRoom(guild, cfg, '➕ Temporary room created', member, channel);
  return channel;
}

async function maybeDelete(guild, channelId, cfg) {
  const gs = gstate(guild.id);
  const room = gs.rooms[channelId];
  if (!room || !cfg.deleteWhenEmpty) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) { delete gs.rooms[channelId]; store.markDirty('state', 'temprooms'); return; }
  if (channel.members.filter((m) => !m.user.bot).size > 0) return;
  clearTimeout(pendingDelete.get(channelId));
  const grace = Math.max(0, Math.min(300, Number(cfg.emptyGraceSeconds) || 0)) * 1000;
  const t = setTimeout(async () => {
    pendingDelete.delete(channelId);
    const ch = guild.channels.cache.get(channelId);
    if (!ch) { delete gs.rooms[channelId]; store.markDirty('state', 'temprooms'); return; }
    if (ch.members.filter((m) => !m.user.bot).size > 0) return;
    await ch.delete('Temporary room empty').catch(() => {});
    delete gs.rooms[channelId];
    store.markDirty('state', 'temprooms');
    await logRoom(guild, cfgOf(guild.id), '🗑️ Temporary room deleted (empty)', null, ch);
  }, grace);
  t.unref();
  pendingDelete.set(channelId, t);
}

/** On startup: delete leftover empty rooms and forget rooms whose channel is gone. */
async function reconcile(client) {
  setClient(client);
  const s = state();
  let changed = false;
  for (const [guildId, gs] of Object.entries(s.guilds)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    for (const [channelId, room] of Object.entries(gs.rooms)) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) { delete gs.rooms[channelId]; changed = true; continue; }
      if (channel.members.filter((m) => !m.user.bot).size === 0) {
        await channel.delete('Dziri System: stale temporary room').catch(() => {});
        delete gs.rooms[channelId]; changed = true;
      } else if (channel.members && channel.members.size && !channel.members.has(room.ownerId)) {
        // Owner left while others stayed: hand the room to someone still inside.
        const next = channel.members.filter((m) => !m.user.bot).first();
        if (next && next.id !== room.ownerId) { room.ownerId = next.id; changed = true; }
      }
    }
  }
  if (changed) store.markDirty('state', 'temprooms');
}

// ---------------------------------------------------------------------------
// Voice-channel chat cleanup (temporary rooms + explicitly selected public voice channels)
// ---------------------------------------------------------------------------
const cleanupChannelLocks = new Set();
const cleanupScopeLocks = new Set();

function intervalMs(settings) {
  const value = Math.max(1, Number(settings.intervalValue) || 24);
  return value * (settings.intervalUnit === 'days' ? 86_400_000 : 3_600_000);
}

/**
 * Backward-compatible config read: guilds that only have the previous
 * tempRooms.chatCleanup setting retain that enabled state and interval.
 */
function messageCleanupConfig(guildId) {
  const full = configService.getGuildConfig(guildId);
  const raw = configService.getRaw(guildId);
  const configured = raw.automod && raw.automod.messageCleanup;
  if (configured) return full.automod.messageCleanup;
  const legacy = full.tempRooms.chatCleanup || { enabled: true, retentionHours: 24 };
  return {
    temporaryRooms: { enabled: legacy.enabled !== false, intervalValue: Math.max(1, Number(legacy.retentionHours) || 24), intervalUnit: 'hours' },
    publicVoice: { enabled: false, channelIds: [], intervalValue: 24, intervalUnit: 'hours' },
  };
}

function cleanupMeta(guildId, scope) {
  const gs = gstate(guildId);
  if (!gs.cleanup) gs.cleanup = {};
  if (!gs.cleanup[scope]) gs.cleanup[scope] = { lastRun: 0, lastDeleted: 0, lastFailed: 0, lastScanned: 0, lastError: '', lastChannels: 0, retryAt: 0 };
  return gs.cleanup[scope];
}

/** Clear every message existing when the job starts, across all Discord fetch pages. */
async function clearVoiceChat(channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice || !channel.messages || typeof channel.messages.fetch !== 'function') {
    throw new Error('The selected channel is not a Discord voice channel with an associated chat.');
  }
  if (cleanupChannelLocks.has(channel.id)) return { deleted: 0, failed: 0, scanned: 0, skipped: true };
  cleanupChannelLocks.add(channel.id);
  try {
    const startedAt = Date.now();
    const bulkCutoff = startedAt - 14 * 86_400_000 + 60_000;
    let before; let deleted = 0; let failed = 0; let scanned = 0;
    while (true) {
      let fetched;
      try { fetched = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }); }
      catch (err) { throw new Error(`Could not fetch messages from #${channel.name}: ${err.message}`); }
      if (!fetched || !fetched.size) break;
      const page = [...fetched.values()];
      before = page[page.length - 1].id;
      const eligible = page.filter((m) => m.createdTimestamp <= startedAt);
      scanned += eligible.length;
      const recent = eligible.filter((m) => m.createdTimestamp > bulkCutoff);
      const old = eligible.filter((m) => m.createdTimestamp <= bulkCutoff);

      if (recent.length && typeof channel.bulkDelete === 'function') {
        try {
          const result = await channel.bulkDelete(recent, true);
          deleted += result ? result.size : 0;
          failed += recent.length - (result ? result.size : 0);
        } catch {
          for (const message of recent) { try { await message.delete(); deleted++; } catch { failed++; } }
        }
      } else {
        for (const message of recent) { try { await message.delete(); deleted++; } catch { failed++; } }
      }
      for (const message of old) { try { await message.delete(); deleted++; } catch { failed++; } }
      if (fetched.size < 100) break;
    }
    return { deleted, failed, scanned, skipped: false };
  } finally {
    cleanupChannelLocks.delete(channel.id);
  }
}

/** Compatibility helper retained for callers from the previous release. */
async function cleanupRoomChat(channel, retentionHours = 24) {
  if (!channel || !channel.messages || typeof channel.messages.fetch !== 'function') return { deleted: 0, failed: 0, scanned: 0 };
  const cutoff = Date.now() - Math.max(1, Number(retentionHours) || 24) * 3_600_000;
  const bulkCutoff = Date.now() - 14 * 86_400_000 + 60_000;
  let before; let deleted = 0; let failed = 0; let scanned = 0;
  while (true) {
    const fetched = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!fetched || !fetched.size) break;
    const page = [...fetched.values()]; before = page[page.length - 1].id;
    const expired = page.filter((m) => m.createdTimestamp < cutoff); scanned += expired.length;
    const recent = expired.filter((m) => m.createdTimestamp > bulkCutoff);
    const old = expired.filter((m) => m.createdTimestamp <= bulkCutoff);
    if (recent.length && typeof channel.bulkDelete === 'function') {
      try { const d = await channel.bulkDelete(recent, true); deleted += d ? d.size : 0; failed += recent.length - (d ? d.size : 0); }
      catch { for (const m of recent) { try { await m.delete(); deleted++; } catch { failed++; } } }
    }
    for (const m of old) { try { await m.delete(); deleted++; } catch { failed++; } }
    if (fetched.size < 100) break;
  }
  return { deleted, failed, scanned };
}

async function channelsForScope(guild, scope) {
  if (scope === 'temporaryRooms') {
    return Object.values(gstate(guild.id).rooms || {}).map((room) => guild.channels.cache.get(room.channelId)).filter((c) => c && c.type === ChannelType.GuildVoice);
  }
  const cfg = messageCleanupConfig(guild.id).publicVoice;
  const channels = [];
  for (const id of cfg.channelIds || []) {
    const channel = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
    if (channel && channel.type === ChannelType.GuildVoice) channels.push(channel);
  }
  return channels;
}

async function runMessageCleanup(guild, scope, { manual = false } = {}) {
  if (!['temporaryRooms', 'publicVoice'].includes(scope)) throw new Error('Unknown cleanup scope.');
  const lockKey = `${guild.id}:${scope}`;
  if (cleanupScopeLocks.has(lockKey)) throw new Error('A cleanup job is already running for this channel type.');
  cleanupScopeLocks.add(lockKey);
  const meta = cleanupMeta(guild.id, scope);
  try {
    const channels = await channelsForScope(guild, scope);
    const total = { deleted: 0, failed: 0, scanned: 0, channels: channels.length, errors: [] };
    for (const channel of channels) {
      try {
        const result = await clearVoiceChat(channel);
        total.deleted += result.deleted; total.failed += result.failed; total.scanned += result.scanned;
      } catch (err) { total.errors.push(`${channel.name}: ${err.message}`); }
    }
    meta.lastRun = Date.now();
    meta.lastDeleted = total.deleted; meta.lastFailed = total.failed; meta.lastScanned = total.scanned; meta.lastChannels = total.channels;
    meta.lastError = total.errors.join('\n').slice(0, 2000); meta.retryAt = meta.lastError ? Date.now() + 15 * 60_000 : 0;
    store.markDirty('state', 'temprooms'); store.flushNow('state', 'temprooms');
    logger.info('MessageCleanup', `${guild.name} ${scope}: ${total.deleted} deleted, ${total.failed} failed in ${total.channels} channel(s)${manual ? ' (manual)' : ''}.`);
    return total;
  } finally { cleanupScopeLocks.delete(lockKey); }
}

function cleanupStatus(guildId) {
  const cfg = messageCleanupConfig(guildId);
  const out = {};
  for (const scope of ['temporaryRooms', 'publicVoice']) {
    const settings = cfg[scope]; const meta = cleanupMeta(guildId, scope);
    const anchor = meta.lastRun || Date.now();
    out[scope] = {
      ...settings,
      lastRun: meta.lastRun || 0,
      nextRun: settings.enabled ? (meta.retryAt > Date.now() ? meta.retryAt : anchor + intervalMs(settings)) : 0,
      lastDeleted: meta.lastDeleted || 0,
      lastFailed: meta.lastFailed || 0,
      lastScanned: meta.lastScanned || 0,
      lastChannels: meta.lastChannels || 0,
      lastError: meta.lastError || '',
      running: cleanupScopeLocks.has(`${guildId}:${scope}`),
    };
  }
  return out;
}

async function runChatCleanup(client = clientRef) {
  if (!client || !client.guilds) return;
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    const cfg = messageCleanupConfig(guild.id);
    for (const scope of ['temporaryRooms', 'publicVoice']) {
      const settings = cfg[scope]; if (!settings.enabled) continue;
      const meta = cleanupMeta(guild.id, scope);
      if (!meta.lastRun) { meta.lastRun = now; store.markDirty('state', 'temprooms'); continue; }
      const due = meta.lastRun + intervalMs(settings);
      if (now >= due && (!meta.retryAt || now >= meta.retryAt)) await runMessageCleanup(guild, scope).catch((err) => {
        meta.lastError = err.message; meta.retryAt = Date.now() + 15 * 60_000; store.markDirty('state', 'temprooms');
        logger.warn('MessageCleanup', `${guild.name} ${scope}:`, err.message);
      });
    }
  }
  store.flushAll();
}

function startChatCleanup(client) {
  setClient(client);
  if (chatCleanupTimer) return;
  runChatCleanup(client).catch((err) => logger.warn('MessageCleanup', 'Initial scheduler check failed:', err.message));
  chatCleanupTimer = setInterval(() => runChatCleanup(client).catch((err) => logger.warn('MessageCleanup', 'Scheduler failed:', err.message)), 60_000);
  chatCleanupTimer.unref();
}

async function logRoom(guild, cfg, title, member, channel) {
  if (!cfg.logChannelId) return;
  const ch = guild.channels.cache.get(cfg.logChannelId);
  if (!ch || !ch.isTextBased()) return;
  const embed = new EmbedBuilder().setColor(hex(cfg.panel.color)).setTitle(title).setTimestamp().setFooter({ text: 'Dziri System • Temporary Rooms' })
    .addFields(
      ...(member ? [{ name: 'Member', value: `<@${member.id}>`, inline: true }] : []),
      { name: 'Room', value: channel ? `${channel.name}` : '—', inline: true },
    );
  await ch.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Control panel
// ---------------------------------------------------------------------------
const STYLE_MAP = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };

/**
 * Normalise the configured buttons.
 *
 * The merged config always carries the default button array, so the migration from the old
 * `buttonLabels` format has to look at the RAW stored document to know what the guild really
 * saved. Without that check an upgraded guild would silently lose its custom labels.
 */
function storedButtonList(guildId, panel) {
  if (guildId) {
    const rawPanel = ((configService.getRaw(guildId).tempRooms || {}).panel) || {};
    if (Array.isArray(rawPanel.buttons)) return rawPanel.buttons;
    if (rawPanel.buttonLabels && typeof rawPanel.buttonLabels === 'object') {
      return defaultRoomButtons().map((b) => ({ ...b, label: rawPanel.buttonLabels[b.action] || b.label }));
    }
    return defaultRoomButtons();
  }
  return Array.isArray(panel.buttons) ? panel.buttons : defaultRoomButtons();
}

function panelButtons(panel, guildId) {
  const list = storedButtonList(guildId, panel);
  return list
    .filter((b) => b && ROOM_ACTIONS[b.action] && b.enabled !== false)
    .slice(0, 25)
    .map((b, i) => ({
      id: b.id || `b-${b.action}-${i}`,
      action: b.action,
      label: String(b.label || ROOM_ACTIONS[b.action].label).slice(0, 80),
      emoji: b.emoji === undefined ? ROOM_ACTIONS[b.action].emoji : String(b.emoji || '').trim(),
      style: STYLE_MAP[b.style] ? b.style : 'secondary',
    }));
}

function panelPayload(guild, cfg) {
  const p = cfg.panel;
  const { embed, files } = panelDelivery.buildEmbed(p, { nameHint: 'room-panel' });
  const guildId = guild && guild.id;

  // Buttons come from the dashboard: label, emoji, style, order and enabled state.
  // Discord allows 5 per row / 5 rows — the configured order is preserved across rows.
  const components = [];
  let row = new ActionRowBuilder();
  for (const b of panelButtons(p, guildId)) {
    if (row.components.length === 5) { components.push(row); row = new ActionRowBuilder(); }
    if (components.length === 5) break;
    const btn = new ButtonBuilder().setCustomId(`${P}${b.action}`).setLabel(b.label).setStyle(STYLE_MAP[b.style]);
    if (b.emoji) { try { btn.setEmoji(b.emoji); } catch { /* invalid emoji → label only */ } }
    row.addComponents(btn);
  }
  if (row.components.length && components.length < 5) components.push(row);
  return { embeds: [embed], files, components };
}

async function publishPanel(guildId) {
  const cfg = cfgOf(guildId);
  if (!cfg.panel.channelId) throw new Error('Select a control panel channel first.');
  if (!panelButtons(cfg.panel, guildId).length) throw new Error('Enable at least one control panel button first.');
  const { key, client } = botRegistry.resolveSender(cfg.panel.senderBot, guildId);
  const guild = client.guilds.cache.get(guildId);

  const result = await panelDelivery.publish({
    guildId,
    system: 'temprooms',
    channelId: cfg.panel.channelId,
    senderBot: cfg.panel.senderBot,
    delivery: cfg.panel.delivery,
    webhookName: cfg.panel.title || 'Dziri System Rooms',
    buildPayload: () => panelPayload(guild, cfg),
  });

  const raw = configService.getGuildConfig(guildId).tempRooms;
  configService.saveSection(guildId, 'tempRooms', {
    ...raw,
    panel: { ...raw.panel, messageId: result.messageId, publishedChannelId: result.channelId, publishedAt: Date.now(), publishedBy: key, publishedMode: result.mode },
  });
  return result;
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------
/**
 * Resolve which temporary room an interaction applies to.
 *
 * The Join-to-Create channel is ONLY a trigger and is never compared against here.
 * Resolution order (all keyed by guildId → channelId → ownerId):
 *   1. the member's CURRENT voice channel, if it is a tracked temporary room
 *   2. that same channel adopted into state (covers rooms created before a restart)
 *   3. a tracked room the member owns (e.g. they stepped out for a moment)
 * Staff may additionally control the room they are currently sitting in.
 *
 * Voice state is re-fetched when the gateway cache is cold, so this works for either bot.
 */
async function resolveRoom(interaction) {
  const guild = interaction.guild;
  const gs = gstate(guild.id);
  const cfg = cfgOf(guild.id);
  const userId = interaction.user.id;

  let member = interaction.member && interaction.member.roles ? interaction.member : null;
  let voiceChannelId = member && member.voice ? member.voice.channelId : null;

  // The cache can be cold (bot restarted, or a client without voice-state cache) — refresh.
  if (!voiceChannelId) {
    const fresh = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
    if (fresh) { member = fresh; voiceChannelId = fresh.voice ? fresh.voice.channelId : null; }
  }
  // Last resort: find the voice channel that currently contains this member.
  if (!voiceChannelId) {
    const ch = guild.channels.cache.find((c) => c && c.isVoiceBased && c.isVoiceBased() && c.members && c.members.has(userId));
    if (ch) voiceChannelId = ch.id;
  }

  const staff = Boolean(member && (
    member.permissions.has(PermissionFlagsBits.ManageChannels)
    || (cfg.staffRoles || []).some((r) => member.roles.cache.has(r))
  ));

  // 1 + 2: the room the member is sitting in right now.
  if (voiceChannelId) {
    const channel = guild.channels.cache.get(voiceChannelId);
    let room = gs.rooms[voiceChannelId];
    if (!room && channel && isAdoptableRoom(channel, cfg)) {
      // A temporary room whose mapping was lost: re-adopt it instead of refusing the action.
      room = { channelId: voiceChannelId, ownerId: userId, createdAt: channel.createdTimestamp || Date.now(), locked: false, hidden: false, adopted: true };
      gs.rooms[voiceChannelId] = room;
      store.markDirty('state', 'temprooms');
      logger.info('TempRooms', `Adopted untracked room ${channel.name} for ${userId}.`);
    }
    if (room && channel) {
      if (room.ownerId === userId || staff) return { room, channel, staff, member };
      return { room: null, channel, staff, member, notOwner: true, ownerId: room.ownerId };
    }
  }

  // 3: a room this member owns but is not currently inside.
  const owned = Object.values(gs.rooms).find((r) => r.ownerId === userId && guild.channels.cache.has(r.channelId));
  if (owned) return { room: owned, channel: guild.channels.cache.get(owned.channelId), staff, member };

  return { room: null, channel: null, staff, member };
}

/** A voice channel counts as a temporary room if it sits in the configured category and is not the trigger. */
function isAdoptableRoom(channel, cfg) {
  if (!channel || !channel.isVoiceBased || !channel.isVoiceBased()) return false;
  if (channel.id === cfg.joinChannelId) return false; // the trigger is NEVER a temporary room
  if (!cfg.categoryId) return false;
  return channel.parentId === cfg.categoryId;
}

const okEmbed = (t) => new EmbedBuilder().setColor(0x22c55e).setDescription(`✅ ${t}`);
const noEmbed = (t) => new EmbedBuilder().setColor(0xef4444).setDescription(`⛔ ${t}`);

/** Acknowledge immediately (ephemeral) so slow Discord calls can never time the interaction out. */
async function ack(interaction) {
  if (interaction.deferred || interaction.replied) return true;
  try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); return true; }
  catch (err) { logger.warn('TempRooms', 'Could not acknowledge interaction:', err.message); return false; }
}
const done = (interaction, embed) => interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});

/** True when this interaction belongs to the temporary room system. */
function owns(interaction) { return String(interaction.customId || '').startsWith(P); }

/** Actions that open a modal — a modal MUST be the first response, so they are never deferred. */
const MODAL_ACTIONS = new Set(['rename', 'limit']);

async function handleInteraction(interaction) {
  if (!owns(interaction)) return false;
  if (!interaction.inGuild() || !interaction.guild) {
    if (interaction.isRepliable()) await interaction.reply({ content: 'Temporary rooms only work inside a server.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  const id = interaction.customId;
  try {
    // ---------- modal submissions ----------
    if (interaction.isModalSubmit()) {
      await ack(interaction);
      const { room, channel } = await resolveRoom(interaction);
      if (!channel) return done(interaction, noEmbed(notInRoomMessage(interaction))) && true;
      if (!room) return done(interaction, noEmbed('You can only control your own temporary room.')) && true;
      const value = interaction.fields.getTextInputValue('value');
      if (id === CID.renameModal) {
        const name = String(value || '').trim().slice(0, 100);
        if (!name) return done(interaction, noEmbed('The room name cannot be empty.')) && true;
        await channel.setName(name, `Renamed by ${interaction.user.tag}`);
        return done(interaction, okEmbed(`Room renamed to **${name}**.`)) && true;
      }
      if (id === CID.limitModal) {
        const n = Math.max(0, Math.min(99, parseInt(value, 10) || 0));
        await channel.setUserLimit(n, `Limit set by ${interaction.user.tag}`);
        return done(interaction, okEmbed(n === 0 ? 'User limit removed.' : `User limit set to **${n}**.`)) && true;
      }
      return done(interaction, noEmbed('Unknown action.')) && true;
    }

    // ---------- member pickers (allow / deny / disconnect / transfer) ----------
    if (interaction.isUserSelectMenu()) {
      await ack(interaction);
      const { room, channel } = await resolveRoom(interaction);
      if (!channel) return done(interaction, noEmbed(notInRoomMessage(interaction))) && true;
      if (!room) return done(interaction, noEmbed('You can only control your own temporary room.')) && true;
      const target = interaction.users.first();
      if (!target) return done(interaction, noEmbed('No member selected.')) && true;
      const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);

      if (id === CID.allowPick) {
        await channel.permissionOverwrites.edit(target.id, { Connect: true, ViewChannel: true }, { reason: `Allowed by ${interaction.user.tag}` });
        return done(interaction, okEmbed(`<@${target.id}> can now join **${channel.name}**.`)) && true;
      }
      if (id === CID.denyPick) {
        if (target.id === room.ownerId) return done(interaction, noEmbed('You cannot deny the room owner.')) && true;
        await channel.permissionOverwrites.edit(target.id, { Connect: false }, { reason: `Denied by ${interaction.user.tag}` });
        if (targetMember && targetMember.voice.channelId === channel.id) await targetMember.voice.disconnect('Denied from temporary room').catch(() => {});
        return done(interaction, okEmbed(`<@${target.id}> can no longer join **${channel.name}**.`)) && true;
      }
      if (id === CID.kickPick) {
        if (!targetMember || targetMember.voice.channelId !== channel.id) return done(interaction, noEmbed('That member is not in your room.')) && true;
        await targetMember.voice.disconnect(`Disconnected by ${interaction.user.tag}`);
        return done(interaction, okEmbed(`<@${target.id}> was disconnected.`)) && true;
      }
      if (id === CID.claimPick) {
        if (!targetMember || targetMember.user.bot) return done(interaction, noEmbed('Pick a real member.')) && true;
        room.ownerId = target.id;
        store.markDirty('state', 'temprooms');
        await channel.permissionOverwrites.edit(target.id, { Connect: true, ViewChannel: true }).catch(() => {});
        return done(interaction, okEmbed(`Ownership of **${channel.name}** transferred to <@${target.id}>.`)) && true;
      }
      return done(interaction, noEmbed('Unknown action.')) && true;
    }

    if (!interaction.isButton()) return true;
    const LEGACY = { 'limit-up': 'limitUp', 'limit-down': 'limitDown' }; // panels published before the id fix
    const rawAction = id.slice(P.length);
    const action = LEGACY[rawAction] || rawAction;
    const cfg = cfgOf(interaction.guild.id);
    if (!cfg.enabled) { await ack(interaction); return done(interaction, noEmbed('The temporary room system is disabled on this server.')) && true; }

    // Modals must be the FIRST response — resolve the room before showing them.
    if (MODAL_ACTIONS.has(action)) {
      const { room, channel } = await resolveRoom(interaction);
      if (!channel || !room) {
        await ack(interaction);
        return done(interaction, noEmbed(channel ? 'You can only control your own temporary room.' : notInRoomMessage(interaction))) && true;
      }
      if (action === 'rename' && cfg.allowRename === false) {
        await ack(interaction);
        return done(interaction, noEmbed('Renaming is disabled on this server.')) && true;
      }
      const modal = action === 'rename'
        ? new ModalBuilder().setCustomId(CID.renameModal).setTitle('Rename your room')
          .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('New room name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(String(channel.name).slice(0, 100))))
        : new ModalBuilder().setCustomId(CID.limitModal).setTitle('Set user limit')
          .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('User limit (0 = unlimited, max 99)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2).setValue(String(channel.userLimit || 0))));
      await interaction.showModal(modal);
      return true;
    }

    await ack(interaction);
    const { room, channel, notOwner, ownerId } = await resolveRoom(interaction);
    if (!channel) return done(interaction, noEmbed(notInRoomMessage(interaction))) && true;
    if (!room) return done(interaction, noEmbed(notOwner ? `This room belongs to <@${ownerId}>. You can only control your own room.` : 'You can only control your own temporary room.')) && true;

    const everyone = interaction.guild.roles.everyone;
    const me = interaction.guild.members.me;
    if (me && !me.permissionsIn(channel).has(PermissionFlagsBits.ManageChannels)) {
      return done(interaction, noEmbed('I need the **Manage Channels** permission on that voice channel.')) && true;
    }

    switch (action) {
      case 'lock':
        await channel.permissionOverwrites.edit(everyone, { Connect: false }, { reason: `Locked by ${interaction.user.tag}` });
        room.locked = true; store.markDirty('state', 'temprooms');
        return done(interaction, okEmbed(`**${channel.name}** is locked — only allowed members can join.`)) && true;
      case 'unlock':
        await channel.permissionOverwrites.edit(everyone, { Connect: null }, { reason: `Unlocked by ${interaction.user.tag}` });
        room.locked = false; store.markDirty('state', 'temprooms');
        return done(interaction, okEmbed(`**${channel.name}** is unlocked.`)) && true;
      case 'hide':
        await channel.permissionOverwrites.edit(everyone, { ViewChannel: false }, { reason: `Hidden by ${interaction.user.tag}` });
        room.hidden = true; store.markDirty('state', 'temprooms');
        return done(interaction, okEmbed(`**${channel.name}** is hidden.`)) && true;
      case 'unhide':
        await channel.permissionOverwrites.edit(everyone, { ViewChannel: null }, { reason: `Unhidden by ${interaction.user.tag}` });
        room.hidden = false; store.markDirty('state', 'temprooms');
        return done(interaction, okEmbed(`**${channel.name}** is visible again.`)) && true;
      case 'limitUp': {
        const n = Math.min(99, (channel.userLimit || 0) + 1);
        await channel.setUserLimit(n);
        return done(interaction, okEmbed(`User limit: **${n}**.`)) && true;
      }
      case 'limitDown': {
        const n = Math.max(0, (channel.userLimit || 0) - 1);
        await channel.setUserLimit(n);
        return done(interaction, okEmbed(n === 0 ? 'User limit removed.' : `User limit: **${n}**.`)) && true;
      }
      case 'allow': case 'deny': case 'kick': case 'claim': {
        const pickId = { allow: CID.allowPick, deny: CID.denyPick, kick: CID.kickPick, claim: CID.claimPick }[action];
        const placeholder = { allow: 'Select a member to allow', deny: 'Select a member to deny', kick: 'Select a member to disconnect', claim: 'Select the new room owner' }[action];
        await interaction.editReply({
          content: placeholder,
          components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(pickId).setPlaceholder(placeholder.slice(0, 150)).setMaxValues(1))],
        });
        return true;
      }
      case 'remove': {
        const gs = gstate(interaction.guild.id);
        delete gs.rooms[channel.id];
        store.markDirty('state', 'temprooms');
        await done(interaction, okEmbed(`Deleting **${channel.name}**…`));
        await channel.delete(`Deleted by ${interaction.user.tag}`).catch(() => {});
        return true;
      }
      default:
        return done(interaction, noEmbed('Unknown action.')) && true;
    }
  } catch (err) {
    logger.error('TempRooms', 'Interaction failed:', err);
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: [noEmbed(`Something went wrong: ${err.message}`)], components: [] });
      else if (interaction.isRepliable()) await interaction.reply({ embeds: [noEmbed(`Something went wrong: ${err.message}`)], flags: MessageFlags.Ephemeral });
    } catch { /* ignore */ }
    return true;
  }
}

function notInRoomMessage(interaction) {
  const cfg = cfgOf(interaction.guild.id);
  const join = cfg.joinChannelId ? `<#${cfg.joinChannelId}>` : 'the Join-to-Create channel';
  return `You are not in a temporary room. Join ${join} to get your own room, then use these controls.`;
}

function status(guildId) {
  const cfg = cfgOf(guildId);
  const gs = gstate(guildId);
  const client = anyClient(guildId);
  const guild = client ? client.guilds.cache.get(guildId) : null;
  const warnings = [];
  const sender = botRegistry.availability(guildId)[cfg.panel.senderBot === 'ticket' ? 'ticket' : 'main'];
  if (!sender.ready) warnings.push(`${sender.label} is selected as the panel sender but is not connected.`);
  else if (!sender.inGuild) warnings.push(`${sender.label} is selected as the panel sender but is not in this server.`);
  if (guild) {
    if (cfg.joinChannelId && !guild.channels.cache.has(cfg.joinChannelId)) warnings.push('The configured Join-to-Create channel no longer exists.');
    if (cfg.categoryId && !guild.channels.cache.has(cfg.categoryId)) warnings.push('The configured temporary room category no longer exists.');
    if (cfg.panel.channelId && !guild.channels.cache.has(cfg.panel.channelId)) warnings.push('The configured control panel channel no longer exists.');
    if (cfg.logChannelId && !guild.channels.cache.has(cfg.logChannelId)) warnings.push('The configured log channel no longer exists.');
  }
  const rooms = Object.values(gs.rooms)
    .filter((r) => !guild || guild.channels.cache.has(r.channelId))
    .map((r) => {
      const ch = guild && guild.channels.cache.get(r.channelId);
      return { channelId: r.channelId, name: ch ? ch.name : '(unknown)', ownerId: r.ownerId, members: ch ? ch.members.size : 0, userLimit: ch ? ch.userLimit : 0, locked: Boolean(r.locked), hidden: Boolean(r.hidden), createdAt: r.createdAt };
    });
  return {
    published: Boolean(cfg.panel.messageId), publishedAt: cfg.panel.publishedAt || 0,
    active: rooms.length, rooms, warnings,
    bots: botRegistry.availability(guildId),
    panel: panelDelivery.info(guildId, 'temprooms'),
    actions: Object.entries(ROOM_ACTIONS).map(([action, meta]) => ({ action, ...meta })),
  };
}

module.exports = {
  setClient, onVoiceUpdate, handleInteraction, owns, publishPanel, reconcile, status,
  panelPayload, panelButtons, storedButtonList, resolveRoom,
  cleanupRoomChat, clearVoiceChat, messageCleanupConfig, cleanupStatus,
  runMessageCleanup, runChatCleanup, startChatCleanup, CID,
};

// loggingService is used indirectly by the main logging system; keep the reference so the
// module graph stays explicit and lint-clean.
void loggingService;
