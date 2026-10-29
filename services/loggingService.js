'use strict';
/**
 * Discord-side logging: posts embeds into the configured log channels.
 * Each event type can be toggled and routed to its own channel, falling back to the default.
 */
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const configService = require('./configService');
const logger = require('../utils/logger');

const COLORS = {
  messageDelete: 0xef4444, messageEdit: 0xf59e0b, memberJoin: 0x22c55e, memberLeave: 0x64748b,
  nicknameChange: 0x8b5cf6, roleChange: 0x8b5cf6, voiceJoinLeave: 0x06b6d4, voiceMove: 0x0ea5e9,
  voiceState: 0x14b8a6, ban: 0xdc2626, unban: 0x16a34a, kick: 0xf97316, moderation: 0xa855f7, automod: 0xe11d48,
};

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} event key from config.logging.events
 * @param {{title:string, description?:string, fields?:any[], user?:import('discord.js').User, channelId?:string}} data
 */
async function log(guild, event, data) {
  try {
    if (!guild) return;
    const cfg = configService.getGuildConfig(guild.id).logging;
    if (!cfg.enabled) return;
    const ev = cfg.events[event];
    if (!ev || !ev.enabled) return;
    if (data.channelId && cfg.ignoredChannels.includes(data.channelId)) return;
    const targetId = ev.channelId || cfg.defaultChannelId;
    if (!targetId) return;
    const channel = guild.channels.cache.get(targetId);
    if (!channel || !channel.isTextBased()) return;
    const me = guild.members.me;
    if (me && !me.permissionsIn(channel).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return;

    const embed = new EmbedBuilder()
      .setColor(COLORS[event] || 0xa855f7)
      .setTitle(data.title)
      .setTimestamp()
      .setFooter({ text: 'Dziri System • Logs' });
    if (data.description) embed.setDescription(String(data.description).slice(0, 4000));
    if (data.fields && data.fields.length) embed.addFields(data.fields.slice(0, 25).map((f) => ({ name: String(f.name).slice(0, 256), value: String(f.value || '—').slice(0, 1024), inline: f.inline !== false })));
    if (data.user) embed.setAuthor({ name: data.user.tag || data.user.username, iconURL: data.user.displayAvatarURL({ size: 64 }) });
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    logger.warn('Logs', `Failed to log ${event}:`, err.message);
  }
}

function channelIds(cfg) {
  return [...new Set([
    cfg.defaultChannelId,
    ...Object.values(cfg.events || {}).map((e) => e && e.channelId),
  ].filter(Boolean))];
}

function isDziriLogMessage(message, botId) {
  if (!message || !message.author || message.author.id !== botId) return false;
  return (message.embeds || []).some((e) => {
    const text = (e.footer && e.footer.text) || (e.data && e.data.footer && e.data.footer.text) || '';
    return text.startsWith('Dziri System • Logs');
  });
}

/** Delete only messages produced by this logging service from configured log channels. */
async function clearDiscordLogs(guild, { olderThan = 0 } = {}) {
  const cfg = configService.getGuildConfig(guild.id).logging;
  const result = { deleted: 0, failed: 0, channels: 0 };
  const me = guild.members.me;
  if (!me) return result;
  for (const id of channelIds(cfg)) {
    const channel = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
    if (!channel || !channel.isTextBased() || !channel.messages) continue;
    if (!me.permissionsIn(channel).has([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory])) continue;
    result.channels++;
    let before;
    while (true) {
      const fetched = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
      if (!fetched || !fetched.size) break;
      const page = [...fetched.values()];
      before = page[page.length - 1].id;
      const matches = page.filter((m) => isDziriLogMessage(m, me.id) && (!olderThan || m.createdTimestamp < olderThan));
      const bulkCutoff = Date.now() - 14 * 86_400_000 + 60_000;
      const recent = matches.filter((m) => m.createdTimestamp > bulkCutoff);
      const old = matches.filter((m) => m.createdTimestamp <= bulkCutoff);
      if (recent.length && typeof channel.bulkDelete === 'function') {
        try {
          const deleted = await channel.bulkDelete(recent, true);
          result.deleted += deleted ? deleted.size : 0;
          result.failed += recent.length - (deleted ? deleted.size : 0);
        } catch {
          for (const m of recent) { try { await m.delete(); result.deleted++; } catch { result.failed++; } }
        }
      } else {
        for (const m of recent) { try { await m.delete(); result.deleted++; } catch { result.failed++; } }
      }
      for (const m of old) { try { await m.delete(); result.deleted++; } catch { result.failed++; } }
      if (fetched.size < 100) break;
    }
  }
  return result;
}

async function clearLogs(guild) {
  const discord = await clearDiscordLogs(guild);
  const local = logger.clearFiles();
  return { discord, local };
}

let cleanupTimer = null;
async function runRetention(client) {
  if (!client || !client.guilds) return;
  const localDays = [];
  for (const guild of client.guilds.cache.values()) {
    const days = Number(configService.getGuildConfig(guild.id).logging.retentionDays) || 0;
    if (days <= 0) continue;
    localDays.push(days);
    await clearDiscordLogs(guild, { olderThan: Date.now() - days * 86_400_000 }).catch((err) => logger.warn('Logs', `${guild.name} retention failed:`, err.message));
  }
  // Process logs are global rather than guild-specific; obey the shortest enabled retention.
  if (localDays.length) logger.retainDays(Math.min(...localDays));
}

function startRetention(client) {
  if (cleanupTimer) return;
  runRetention(client).catch((err) => logger.warn('Logs', 'Initial retention cleanup failed:', err.message));
  cleanupTimer = setInterval(() => runRetention(client).catch((err) => logger.warn('Logs', 'Retention cleanup failed:', err.message)), 6 * 60 * 60_000);
  cleanupTimer.unref();
}

function storageInfo() { return logger.storageInfo(); }

module.exports = { log, clearDiscordLogs, clearLogs, runRetention, startRetention, storageInfo, isDziriLogMessage };
