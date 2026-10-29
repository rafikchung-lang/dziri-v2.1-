'use strict';
/**
 * Lightweight AutoMod: anti-spam, anti-link, anti-invite, bad words, mention spam,
 * excessive caps, duplicate messages. Per-user sliding windows are kept in small in-memory
 * arrays that are pruned on every message and swept every 5 minutes (no memory growth).
 */
const { PermissionFlagsBits } = require('discord.js');
const configService = require('./configService');
const historyService = require('./historyService');
const loggingService = require('./loggingService');
const { parseDuration } = require('../utils/duration');
const logger = require('../utils/logger');

const windows = new Map(); // `${guild}:${user}` -> [{ t, c }]
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [k, arr] of windows) { const f = arr.filter((x) => x.t > cutoff); if (f.length) windows.set(k, f); else windows.delete(k); }
}, 300_000).unref();

const INVITE_RE = /(discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg)\/[\w-]+/i;
const LINK_RE = /https?:\/\/([^\s/<>]+)/gi;

const RULE_LABELS = {
  antiSpam: 'Anti-Spam', antiLink: 'Anti-Link', antiInvite: 'Anti-Invite', badWords: 'Bad Words',
  mentionSpam: 'Mention Spam', caps: 'Excessive Caps', duplicates: 'Duplicate Messages',
};

function exempt(message, cfg) {
  const m = message.member;
  if (!m) return true;
  if (m.permissions.has(PermissionFlagsBits.Administrator) || m.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  if (cfg.exemptRoles.some((r) => m.roles.cache.has(r))) return true;
  if (cfg.exemptChannels.includes(message.channel.id) || (message.channel.parentId && cfg.exemptChannels.includes(message.channel.parentId))) return true;
  return false;
}

function detect(message, rules) {
  const content = message.content || '';
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const arr = windows.get(key) || [];
  arr.push({ t: now, c: content.toLowerCase().trim() });
  const pruned = arr.filter((x) => now - x.t < 120_000).slice(-30);
  windows.set(key, pruned);

  const r = rules;
  if (r.antiInvite.enabled && INVITE_RE.test(content)) return ['antiInvite', 'Posted a Discord invite'];
  if (r.antiLink.enabled) {
    const allowed = (r.antiLink.allowedDomains || []).map((d) => String(d).toLowerCase().replace(/^www\./, ''));
    let m; LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(content))) {
      const host = m[1].toLowerCase().replace(/^www\./, '');
      if (!allowed.some((d) => host === d || host.endsWith(`.${d}`))) return ['antiLink', `Posted a link (${host})`];
    }
  }
  if (r.badWords.enabled && r.badWords.words.length) {
    const lc = content.normalize('NFC').toLowerCase();
    const hit = r.badWords.words.find((w) => w && lc.includes(String(w).normalize('NFC').toLowerCase()));
    if (hit) return ['badWords', 'Used a blocked word'];
  }
  if (r.mentionSpam.enabled) {
    const count = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
    if (count >= Math.max(1, r.mentionSpam.threshold)) return ['mentionSpam', `${count} mentions in one message`];
  }
  if (r.caps.enabled) {
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= Math.max(1, r.caps.minLength)) {
      const upper = letters.replace(/[^A-Z]/g, '').length;
      if ((upper / letters.length) * 100 >= r.caps.threshold) return ['caps', `${Math.round((upper / letters.length) * 100)}% capital letters`];
    }
  }
  if (r.duplicates.enabled && content.trim()) {
    const within = pruned.filter((x) => now - x.t < r.duplicates.interval * 1000 && x.c === content.toLowerCase().trim());
    if (within.length >= Math.max(2, r.duplicates.threshold)) return ['duplicates', `Sent the same message ${within.length} times`];
  }
  if (r.antiSpam.enabled) {
    const within = pruned.filter((x) => now - x.t < r.antiSpam.interval * 1000);
    if (within.length >= Math.max(2, r.antiSpam.threshold)) { windows.set(key, []); return ['antiSpam', `${within.length} messages in ${r.antiSpam.interval}s`]; }
  }
  return null;
}

async function onMessage(message) {
  if (!message.guild || message.author.bot || !message.member) return false;
  const cfg = configService.getGuildConfig(message.guild.id).automod;
  if (!cfg.enabled || exempt(message, cfg)) return false;
  const hit = detect(message, cfg.rules);
  if (!hit) return false;
  const [ruleKey, why] = hit;
  const rule = cfg.rules[ruleKey];
  await act(message, ruleKey, rule, why, cfg);
  return true;
}

async function act(message, ruleKey, rule, why, cfg) {
  const member = message.member;
  const label = RULE_LABELS[ruleKey];
  const reason = `AutoMod (${label}): ${why}`;
  const action = rule.action || 'delete';
  try {
    await message.delete().catch(() => {});
    if (action === 'warn') {
      const w = await message.channel.send({ content: `⚠️ <@${member.id}>, your message was removed: **${label}**.`, allowedMentions: { users: [member.id] } }).catch(() => null);
      if (w) setTimeout(() => w.delete().catch(() => {}), 6000);
    } else if (action === 'timeout' && member.moderatable) {
      const ms = parseDuration(rule.duration) || 300_000;
      await member.timeout(Math.min(ms, 28 * 86_400_000), reason);
    } else if (action === 'kick' && member.kickable) {
      await member.kick(reason);
    } else if (action === 'ban' && member.bannable) {
      await member.ban({ reason, deleteMessageSeconds: 3600 });
    }
  } catch (err) { logger.warn('AutoMod', 'Action failed:', err.message); }

  historyService.add(message.guild.id, {
    type: 'automod', targetId: member.id, targetTag: member.user.tag, moderatorTag: 'AutoMod',
    reason, duration: action === 'timeout' ? rule.duration : '', details: `Action: ${action}`,
  });
  const fields = [
    { name: 'Member', value: `<@${member.id}> (${member.user.tag})` },
    { name: 'Rule', value: label }, { name: 'Action', value: action },
    { name: 'Channel', value: `<#${message.channel.id}>` },
    { name: 'Content', value: (message.content || '—').slice(0, 1000), inline: false },
  ];
  if (cfg.logChannelId) {
    const ch = message.guild.channels.cache.get(cfg.logChannelId);
    if (ch && ch.isTextBased()) {
      const { EmbedBuilder } = require('discord.js');
      ch.send({ embeds: [new EmbedBuilder().setColor(0xe11d48).setTitle('🛡️ AutoMod').addFields(fields).setTimestamp().setFooter({ text: 'Dziri System • AutoMod' })], allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }
  }
  await loggingService.log(message.guild, 'automod', { title: '🛡️ AutoMod', user: member.user, fields });
}

module.exports = { onMessage, RULE_LABELS };
