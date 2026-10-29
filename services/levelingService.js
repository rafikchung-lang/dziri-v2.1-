'use strict';
/**
 * Leveling: separate Text XP and Voice XP, level computed from total XP.
 * Data: data/levels/<guildId>.json  →  { users: { [id]: { t, v, m, vm, lt } } }
 *   t = text xp, v = voice xp, m = messages counted, vm = voice minutes, lt = last text xp timestamp
 *
 * Level-up messages are OFF by default (config.leveling.levelUpMessages = false).
 */
const store = require('../database/store');
const configService = require('./configService');
const historyService = require('./historyService');
const logger = require('../utils/logger');

const doc = (guildId) => {
  const d = store.read('levels', guildId, () => ({ users: {} }));
  if (!d.users) d.users = {};
  return d;
};

function xpForLevel(level) { return 5 * level * level + 50 * level + 100; }
function levelInfo(totalXp) {
  let level = 0; let xp = Math.max(0, Math.floor(totalXp));
  while (xp >= xpForLevel(level)) { xp -= xpForLevel(level); level++; if (level > 1000) break; }
  return { level, current: xp, needed: xpForLevel(level) };
}

function getUser(guildId, userId) {
  const d = doc(guildId);
  return d.users[userId] || { t: 0, v: 0, m: 0, vm: 0, lt: 0 };
}

function isIgnored(cfg, member, channel) {
  if (!channel) return true;
  if (cfg.ignoredChannels.includes(channel.id) || (channel.parentId && cfg.ignoredChannels.includes(channel.parentId))) return true;
  if (member && cfg.ignoredRoles.some((r) => member.roles.cache.has(r))) return true;
  return false;
}

async function addXp(guild, member, kind, amount, channel) {
  const d = doc(guild.id);
  const u = d.users[member.id] || (d.users[member.id] = { t: 0, v: 0, m: 0, vm: 0, lt: 0 });
  const before = levelInfo(u.t + u.v).level;
  if (kind === 'text') { u.t += amount; u.m += 1; u.lt = Date.now(); } else { u.v += amount; u.vm += 1; }
  store.markDirty('levels', guild.id);
  const after = levelInfo(u.t + u.v).level;
  if (after > before) await onLevelUp(guild, member, after, channel);
}

async function onMessage(message) {
  if (!message.guild || message.author.bot || !message.member) return;
  const cfg = configService.getGuildConfig(message.guild.id).leveling;
  if (!cfg.enabled) return;
  if (isIgnored(cfg, message.member, message.channel)) return;
  const u = getUser(message.guild.id, message.author.id);
  if (Date.now() - (u.lt || 0) < Math.max(0, Number(cfg.textCooldown) || 0) * 1000) return;
  const min = Math.max(0, Number(cfg.textXpMin) || 0);
  const max = Math.max(min, Number(cfg.textXpMax) || min);
  const amount = Math.floor(min + Math.random() * (max - min + 1));
  if (amount > 0) await addXp(message.guild, message.member, 'text', amount, message.channel);
}

async function onLevelUp(guild, member, level, channel) {
  const cfg = configService.getGuildConfig(guild.id).leveling;
  // Level rewards
  try {
    const rewards = (cfg.rewards || []).filter((r) => r.roleId && guild.roles.cache.has(r.roleId)).sort((a, b) => a.level - b.level);
    const earned = rewards.filter((r) => r.level <= level);
    const me = guild.members.me;
    if (earned.length && me && me.permissions.has('ManageRoles')) {
      const toAdd = cfg.stackRewards ? earned.map((r) => r.roleId) : [earned[earned.length - 1].roleId];
      const toRemove = cfg.stackRewards ? [] : earned.slice(0, -1).map((r) => r.roleId);
      for (const id of toAdd) {
        const role = guild.roles.cache.get(id);
        if (role && role.position < me.roles.highest.position && !member.roles.cache.has(id)) {
          await member.roles.add(id, `Dziri System: level ${level} reward`).catch(() => {});
          historyService.add(guild.id, { type: 'roleadd', targetId: member.id, targetTag: member.user.tag, moderatorTag: 'Dziri System', reason: `Level ${level} reward: ${role.name}` });
        }
      }
      for (const id of toRemove) if (member.roles.cache.has(id)) await member.roles.remove(id, 'Dziri System: reward replaced').catch(() => {});
    }
  } catch (err) { logger.warn('Leveling', 'Reward failed:', err.message); }

  // Level-up announcement — only if explicitly enabled (default OFF)
  if (cfg.levelUpMessages !== true) return;
  const target = (cfg.levelUpChannelId && guild.channels.cache.get(cfg.levelUpChannelId)) || channel;
  if (!target || !target.isTextBased || !target.isTextBased()) return;
  const text = String(cfg.levelUpTemplate || '{user} reached level {level}.')
    .replaceAll('{user}', `<@${member.id}>`).replaceAll('{username}', member.user.username)
    .replaceAll('{level}', String(level)).replaceAll('{server}', guild.name);
  await target.send({ content: text.slice(0, 1900), allowedMentions: { users: [member.id] } }).catch(() => {});
}

// Voice XP: one 60 s timer for all guilds, iterates the in-memory voice-state cache only.
let voiceTimer = null;
function startVoiceTracker(client) {
  if (voiceTimer) return;
  voiceTimer = setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      let cfg;
      try { cfg = configService.getGuildConfig(guild.id).leveling; } catch { continue; }
      if (!cfg.enabled || !(Number(cfg.voiceXpPerMinute) > 0)) continue;
      for (const vs of guild.voiceStates.cache.values()) {
        try {
          const member = vs.member;
          if (!member || member.user.bot || !vs.channel) continue;
          if (guild.afkChannelId && vs.channelId === guild.afkChannelId) continue;
          if (vs.selfDeaf || vs.serverDeaf) continue;
          if (isIgnored(cfg, member, vs.channel)) continue;
          if (cfg.voiceRequireOthers && vs.channel.members.filter((m) => !m.user.bot).size < 2) continue;
          await addXp(guild, member, 'voice', Math.floor(Number(cfg.voiceXpPerMinute)), null);
        } catch { /* ignore single member */ }
      }
    }
  }, 60_000);
  voiceTimer.unref();
}

function sortedIds(guildId, type = 'total') {
  const users = doc(guildId).users;
  const score = (u) => (type === 'text' ? u.t : type === 'voice' ? u.v : u.t + u.v);
  return Object.keys(users).filter((id) => score(users[id]) > 0).sort((a, b) => score(users[b]) - score(users[a]));
}

function getRank(guildId, userId, type = 'total') {
  const ids = sortedIds(guildId, type);
  const idx = ids.indexOf(userId);
  return idx === -1 ? ids.length + 1 : idx + 1;
}

function stats(guildId, userId) {
  const u = getUser(guildId, userId);
  const total = u.t + u.v;
  return { textXp: u.t, voiceXp: u.v, totalXp: total, messages: u.m, voiceMinutes: u.vm, ...levelInfo(total), rank: getRank(guildId, userId) };
}

function leaderboard(guildId, { type = 'total', page = 1, pageSize = 10 } = {}) {
  const ids = sortedIds(guildId, type);
  const pages = Math.max(1, Math.ceil(ids.length / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const users = doc(guildId).users;
  const items = ids.slice((p - 1) * pageSize, p * pageSize).map((id, i) => {
    const u = users[id];
    return { userId: id, position: (p - 1) * pageSize + i + 1, textXp: u.t, voiceXp: u.v, totalXp: u.t + u.v, messages: u.m, voiceMinutes: u.vm, ...levelInfo(u.t + u.v) };
  });
  return { items, page: p, pages, total: ids.length };
}

function summary(guildId) {
  const users = Object.values(doc(guildId).users);
  return {
    trackedMembers: users.length,
    totalTextXp: users.reduce((a, u) => a + u.t, 0),
    totalVoiceXp: users.reduce((a, u) => a + u.v, 0),
    totalMessages: users.reduce((a, u) => a + u.m, 0),
    totalVoiceMinutes: users.reduce((a, u) => a + u.vm, 0),
  };
}

function resetUser(guildId, userId) { const d = doc(guildId); delete d.users[userId]; store.markDirty('levels', guildId); }

module.exports = { onMessage, startVoiceTracker, stats, leaderboard, getRank, levelInfo, xpForLevel, summary, resetUser };
