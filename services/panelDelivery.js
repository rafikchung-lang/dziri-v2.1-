'use strict';
/**
 * Shared panel publishing for the Ticket and Temporary Room systems.
 *
 * Two delivery modes, both able to carry an image AND interactive components:
 *   message → a normal message from the selected bot (author = that bot, no webhook created)
 *   webhook → an APPLICATION-OWNED webhook created by the selected bot.
 *             Discord only routes component interactions from a webhook message to the
 *             application that owns the webhook, so the sender still handles its own panel.
 *
 * Webhook credentials live in data/state/panels.json (server-side only) and are never
 * returned to the browser.
 */
const path = require('path');
const fs = require('fs');
const { EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const store = require('../database/store');
const botRegistry = require('./botRegistry');
const logger = require('../utils/logger');

const UPLOAD_DIR = path.join(store.DATA_DIR, 'uploads');

function state() {
  const s = store.read('state', 'panels', () => ({ guilds: {} }));
  if (!s.guilds) s.guilds = {};
  return s;
}
function slot(guildId, system) {
  const s = state();
  if (!s.guilds[guildId]) s.guilds[guildId] = {};
  if (!s.guilds[guildId][system]) s.guilds[guildId][system] = {};
  return s.guilds[guildId][system];
}
function save() { store.flushNow('state', 'panels'); }

const hex = (c) => { const n = parseInt(String(c || '#a855f7').replace('#', '').slice(0, 6), 16); return Number.isNaN(n) ? 0xa855f7 : n; };
const isHttp = (u) => /^https?:\/\/\S+$/i.test(String(u || ''));

/**
 * Build the embed + files for a panel. Works identically in message and webhook mode,
 * so an uploaded image never forces the user into webhook mode.
 */
function buildEmbed(panel, { nameHint = 'panel' } = {}) {
  const embed = new EmbedBuilder().setColor(hex(panel.color));
  if (panel.title) embed.setTitle(String(panel.title).slice(0, 256));
  if (panel.description) embed.setDescription(String(panel.description).slice(0, 4000));
  if (panel.footer) embed.setFooter({ text: String(panel.footer).slice(0, 2048) });
  if (isHttp(panel.thumbnailUrl)) embed.setThumbnail(panel.thumbnailUrl);

  const files = [];
  if (panel.image) {
    const file = path.join(UPLOAD_DIR, path.basename(panel.image));
    if (fs.existsSync(file)) {
      const ext = (path.extname(file).slice(1) || 'png').toLowerCase();
      const name = `${nameHint}.${ext}`;
      files.push(new AttachmentBuilder(file, { name }));
      embed.setImage(`attachment://${name}`);
    } else {
      logger.warn('Panels', `Configured image ${panel.image} is missing on disk — sending without it.`);
      if (isHttp(panel.imageUrl)) embed.setImage(panel.imageUrl);
    }
  } else if (isHttp(panel.imageUrl)) {
    embed.setImage(panel.imageUrl);
  }
  return { embed, files };
}

function checkPerms(guild, channel, client, mode) {
  const me = guild.members.me;
  if (!me) return null;
  const need = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles];
  if (mode === 'webhook') need.push(PermissionFlagsBits.ManageWebhooks);
  const missing = need.filter((p) => !me.permissionsIn(channel).has(p));
  if (!missing.length) return null;
  const names = { [PermissionFlagsBits.ViewChannel]: 'View Channel', [PermissionFlagsBits.SendMessages]: 'Send Messages', [PermissionFlagsBits.EmbedLinks]: 'Embed Links', [PermissionFlagsBits.AttachFiles]: 'Attach Files', [PermissionFlagsBits.ManageWebhooks]: 'Manage Webhooks' };
  return `${client.user.tag} is missing ${missing.map((p) => `**${names[p]}**`).join(', ')} in that channel.`;
}

/** Find (or create) a webhook in this channel owned by THIS application. */
async function getOwnWebhook(channel, client, { name, avatar }) {
  const hooks = await channel.fetchWebhooks();
  const mine = hooks.find((w) => w.owner && w.owner.id === client.user.id && w.token);
  if (mine) return mine;
  return channel.createWebhook({ name: name.slice(0, 80), avatar, reason: 'Dziri System panel (webhook delivery)' });
}

/** Best-effort removal of a previously published panel when the bot/mode/channel changes. */
async function removeOld(prev, guild) {
  if (!prev || !prev.messageId) return;
  try {
    if (prev.mode === 'webhook' && prev.webhookId && prev.webhookToken) {
      const client = botRegistry.get(prev.botKey) || botRegistry.get('main');
      if (!client) return;
      const wh = await client.fetchWebhook(prev.webhookId, prev.webhookToken).catch(() => null);
      if (wh) await wh.deleteMessage(prev.messageId).catch(() => {});
      return;
    }
    const client = botRegistry.get(prev.botKey);
    if (!client || !client.isReady()) return;
    const g = client.guilds.cache.get(guild.id);
    const ch = g && g.channels.cache.get(prev.channelId);
    if (!ch || !ch.isTextBased()) return;
    const msg = await ch.messages.fetch(prev.messageId).catch(() => null);
    if (msg && msg.deletable) await msg.delete().catch(() => {});
  } catch { /* never block publishing */ }
}

/**
 * Publish or update a panel.
 * @param {object} o
 * @param {string} o.guildId
 * @param {'tickets'|'temprooms'} o.system
 * @param {string} o.channelId
 * @param {'main'|'ticket'} o.senderBot
 * @param {'message'|'webhook'} o.delivery
 * @param {() => {embeds:any[],components:any[],files:any[]}} o.buildPayload fresh payload per attempt
 * @param {string} o.webhookName
 */
async function publish({ guildId, system, channelId, senderBot, delivery, buildPayload, webhookName }) {
  if (!channelId) throw new Error('Select a channel for this panel first.');
  const { key, client } = botRegistry.resolveSender(senderBot, guildId);
  const guild = client.guilds.cache.get(guildId);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('The configured panel channel no longer exists.');
  const mode = delivery === 'webhook' ? 'webhook' : 'message';
  const permError = checkPerms(guild, channel, client, mode);
  if (permError) throw new Error(permError);

  const prev = { ...slot(guildId, system) };
  const sameTarget = prev.messageId && prev.channelId === channel.id && prev.botKey === key && prev.mode === mode;
  let message = null;
  let authorTag = client.user.tag;

  if (mode === 'webhook') {
    let webhook;
    try {
      webhook = await getOwnWebhook(channel, client, { name: webhookName || 'Dziri System', avatar: client.user.displayAvatarURL({ extension: 'png', size: 128 }) });
    } catch (err) {
      throw new Error(`Could not create a webhook in that channel: ${err.message}. ${client.user.tag} needs the **Manage Webhooks** permission.`);
    }
    if (sameTarget && prev.webhookId === webhook.id) {
      message = await webhook.editMessage(prev.messageId, { ...buildPayload(), attachments: [] }).catch(() => null);
    }
    if (!message) {
      if (!sameTarget) await removeOld(prev, guild);
      // Application-owned webhooks may always send interactive components.
      message = await webhook.send({ ...buildPayload(), withComponents: true });
    }
    authorTag = webhook.name;
    const s = slot(guildId, system);
    Object.assign(s, { messageId: message.id, channelId: channel.id, botKey: key, mode, webhookId: webhook.id, webhookToken: webhook.token, at: Date.now() });
    save();
    return { messageId: message.id, channelId: channel.id, botKey: key, botTag: client.user.tag, authorTag, mode, url: `https://discord.com/channels/${guildId}/${channel.id}/${message.id}` };
  }

  // ---- normal bot message (no webhook is created or used) ----
  if (sameTarget) {
    const old = await channel.messages.fetch(prev.messageId).catch(() => null);
    if (old && old.editable) message = await old.edit({ ...buildPayload(), attachments: [] }).catch(() => null);
  }
  if (!message) {
    if (!sameTarget) await removeOld(prev, guild);
    message = await channel.send(buildPayload());
  }
  const s = slot(guildId, system);
  Object.assign(s, { messageId: message.id, channelId: channel.id, botKey: key, mode, webhookId: '', webhookToken: '', at: Date.now() });
  save();
  return { messageId: message.id, channelId: channel.id, botKey: key, botTag: client.user.tag, authorTag, mode, url: message.url };
}

/** Public (token-free) publish state for the dashboard. */
function info(guildId, system) {
  const s = slot(guildId, system);
  return {
    published: Boolean(s.messageId),
    messageId: s.messageId || '',
    channelId: s.channelId || '',
    botKey: s.botKey || '',
    botLabel: s.botKey ? botRegistry.LABELS[s.botKey] : '',
    mode: s.mode || '',
    at: s.at || 0,
    url: s.messageId && s.channelId ? `https://discord.com/channels/${guildId}/${s.channelId}/${s.messageId}` : '',
  };
}

module.exports = { publish, info, buildEmbed, UPLOAD_DIR };
