'use strict';
/**
 * Queued member messaging with per-recipient placeholders, attachments and two explicit
 * delivery modes:
 *   normal  → DM from the selected bot
 *   webhook → one personalised message per recipient in the selected text channel
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PermissionFlagsBits } = require('discord.js');
const store = require('../database/store');
const historyService = require('./historyService');
const botRegistry = require('./botRegistry');
const configService = require('./configService');
const logger = require('../utils/logger');

// Message format (normal vs embed, footer) — see config/defaults.js → messaging.
const MESSAGE_TYPES = ['normal', 'embed'];
const DEFAULT_FOOTER = 'Sent from {server} via {bot}';
const MAX_EMBEDS = 10;
const HEX6 = /^#[0-9a-f]{6}$/i;

/**
 * Resolve the effective message format: persisted guild settings first, then any explicit
 * per-campaign overrides from the dashboard. Missing/invalid values fall back safely, so
 * older configurations keep working. An empty footerText is preserved (= no footer).
 */
function resolveFormat(saved = {}, override = {}) {
  const pick = (key) => (override && override[key] !== undefined ? override[key] : saved ? saved[key] : undefined);
  const type = String(pick('messageType') || 'normal').toLowerCase();
  const color = String(pick('embedColor') || '');
  const footerText = pick('footerText');
  const footerEnabled = pick('footerEnabled');
  return {
    messageType: MESSAGE_TYPES.includes(type) ? type : 'normal',
    embedColor: HEX6.test(color) ? color : '#a855f7',
    footerEnabled: footerEnabled === undefined ? true : Boolean(footerEnabled),
    footerText: typeof footerText === 'string' ? footerText.trim().slice(0, 2048) : DEFAULT_FOOTER,
  };
}
/** The footer that will actually be sent ('' when disabled or empty — never auto-filled). */
function effectiveFooter(format) { return format.footerEnabled && format.footerText ? format.footerText : ''; }

const MAX_RECIPIENTS = 1000;
const MAX_ATTACHMENTS = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 20 * 1024 * 1024;
const ATTACH_DIR = path.join(store.DATA_DIR, 'uploads', 'broadcast');
const jobs = new Map();
const statusDoc = () => store.read('state', 'broadcasts', () => ({ jobs: {} }));

// `guild.members.fetch()` sends Gateway opcode 8 (Request Guild Members). A preview and the
// subsequent send previously each issued a full-guild request, and concurrent dashboard
// previews could issue several at once. Keep a short, per-guild snapshot and share one
// in-flight request so recipient filtering never multiplies those gateway requests.
const MEMBER_SNAPSHOT_TTL_MS = 30_000;
const memberSnapshots = new Map();
const memberFetches = new Map();
const memberFetchCooldowns = new Map();

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
};
const ALLOWED_MIME = new Set(Object.values(MIME));

function ensureAttachmentDir() { fs.mkdirSync(ATTACH_DIR, { recursive: true }); }
function safeName(name) { return String(name || 'attachment').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 100) || 'attachment'; }
function attachmentPrefix(guildId, id) { return `${guildId}-${id}-`; }

function findAttachment(guildId, id) {
  if (!/^[a-f0-9]{24}$/.test(String(id))) return null;
  ensureAttachmentDir();
  const prefix = attachmentPrefix(guildId, id);
  const name = fs.readdirSync(ATTACH_DIR).find((n) => n.startsWith(prefix));
  if (!name) return null;
  const filePath = path.join(ATTACH_DIR, name);
  const displayName = name.slice(prefix.length);
  const ext = path.extname(displayName).slice(1).toLowerCase();
  const stat = fs.statSync(filePath);
  return { id, name: displayName, type: MIME[ext] || 'application/octet-stream', size: stat.size, path: filePath };
}

function saveAttachment(guildId, { name, type, dataUrl }) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!match) throw new Error('Invalid attachment upload.');
  const mime = String(match[1]).toLowerCase();
  const declared = String(type || mime).toLowerCase();
  if (declared && declared !== mime) throw new Error('Attachment type does not match the uploaded file data.');
  if (!ALLOWED_MIME.has(mime)) throw new Error(`Unsupported attachment type: ${mime}.`);
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('The attachment is empty.');
  if (buffer.length > MAX_FILE_SIZE) throw new Error('Each attachment must be 10 MB or smaller.');
  ensureAttachmentDir();
  const id = crypto.randomBytes(12).toString('hex');
  const filename = safeName(name);
  fs.writeFileSync(path.join(ATTACH_DIR, `${attachmentPrefix(guildId, id)}${filename}`), buffer);
  return { id, name: filename, type: mime, size: buffer.length };
}

function removeAttachment(guildId, id) {
  const attachment = findAttachment(guildId, id);
  if (!attachment) return false;
  try { fs.unlinkSync(attachment.path); return true; } catch { return false; }
}

function pruneAttachments() {
  ensureAttachmentDir();
  const cutoff = Date.now() - 7 * 86_400_000;
  for (const name of fs.readdirSync(ATTACH_DIR)) {
    const file = path.join(ATTACH_DIR, name);
    try { if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file); } catch { /* ignore */ }
  }
}
pruneAttachments();

function persist(job) {
  const d = statusDoc();
  const list = d.jobs[job.guildId] || (d.jobs[job.guildId] = []);
  const i = list.findIndex((j) => j.id === job.id);
  const snap = {
    id: job.id, status: job.status, createdAt: job.createdAt, finishedAt: job.finishedAt || 0,
    by: job.by, message: job.message.slice(0, 200), counts: { ...job.counts }, filters: job.filters,
    delivery: job.delivery, selectedBot: job.selectedBot, attachmentCount: job.attachments.length,
    messageType: job.format ? job.format.messageType : 'normal',
    lastError: job.lastError || '',
  };
  if (i === -1) list.unshift(snap); else list[i] = snap;
  d.jobs[job.guildId] = list.slice(0, 10);
  store.markDirty('state', 'broadcasts');
}

function rateLimitDelayMs(err) {
  const match = /retry after\s+([\d.]+)\s*(?:seconds?|s)?/i.exec(String(err && err.message || err));
  if (match) return Math.ceil(Number(match[1]) * 1000);
  const retryAfter = Number(err && (err.retry_after || err.retryAfter));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter * 1000) : 0;
}

function memberRateLimitError(retryAt) {
  const seconds = Math.max(0.001, (retryAt - Date.now()) / 1000).toFixed(3).replace(/\.0+$/, '');
  return new Error(`Discord is temporarily rate limiting member data. Retry after ${seconds} seconds.`);
}

function snapshotFromCache(guild) {
  const cache = guild.members && guild.members.cache;
  const memberCount = Number(guild.memberCount);
  // A cache with every known guild member is sufficient for all broadcast filters and does
  // not require an Opcode 8 request. Do not treat an unknown or partial cache as complete.
  if (!cache || !Number.isFinite(memberCount) || memberCount < 1 || cache.size < memberCount) return null;
  return [...cache.values()];
}

async function membersForRecipients(guild) {
  const now = Date.now();
  const snapshot = memberSnapshots.get(guild.id);
  if (snapshot && snapshot.expiresAt > now) return snapshot.members;

  const cachedMembers = snapshotFromCache(guild);
  if (cachedMembers) {
    memberSnapshots.set(guild.id, { members: cachedMembers, expiresAt: now + MEMBER_SNAPSHOT_TTL_MS });
    return cachedMembers;
  }

  const cooldownUntil = memberFetchCooldowns.get(guild.id) || 0;
  if (cooldownUntil > now) throw memberRateLimitError(cooldownUntil);

  const activeFetch = memberFetches.get(guild.id);
  if (activeFetch) return activeFetch;

  const fetch = guild.members.fetch()
    .then((members) => {
      const list = [...members.values()];
      memberSnapshots.set(guild.id, { members: list, expiresAt: Date.now() + MEMBER_SNAPSHOT_TTL_MS });
      memberFetchCooldowns.delete(guild.id);
      return list;
    })
    .catch((err) => {
      const delay = rateLimitDelayMs(err);
      if (delay) {
        const retryAt = Date.now() + delay;
        memberFetchCooldowns.set(guild.id, retryAt);
        throw memberRateLimitError(retryAt);
      }
      throw err;
    })
    .finally(() => memberFetches.delete(guild.id));
  memberFetches.set(guild.id, fetch);
  return fetch;
}

async function resolveRecipients(guild, filters) {
  const members = await membersForRecipients(guild);
  const roles = filters.roles || [];
  const exclude = filters.excludeRoles || [];
  const days = Number(filters.joinedWithinDays) || 0;
  const minDays = Number(filters.joinedBeforeDays) || 0;
  const now = Date.now();
  const out = []; let skipped = 0;
  for (const m of members) {
    if (m.user.bot) { skipped++; continue; }
    if (filters.target === 'roles' && !roles.some((r) => m.roles.cache.has(r))) continue;
    if (exclude.some((r) => m.roles.cache.has(r))) { skipped++; continue; }
    if (days && (!m.joinedTimestamp || now - m.joinedTimestamp > days * 86_400_000)) continue;
    if (minDays && (!m.joinedTimestamp || now - m.joinedTimestamp < minDays * 86_400_000)) continue;
    out.push(m);
  }
  return { recipients: out, skipped };
}

const PLACEHOLDERS = ['user', 'username', 'displayname', 'userid', 'server', 'serverid', 'membercount', 'bot'];
function expand(template, member, guild, botUser) {
  const values = {
    user: `<@${member.id}>`,
    username: member.user.username || '',
    displayname: member.displayName || member.user.globalName || member.user.username || '',
    userid: member.id,
    server: guild.name || '',
    serverid: guild.id,
    membercount: String(guild.memberCount || 0),
    bot: botUser ? (botUser.username || botUser.tag || '') : '',
  };
  return String(template || '').replace(/\{([a-z]+)\}/gi, (all, key) => Object.prototype.hasOwnProperty.call(values, key.toLowerCase()) ? values[key.toLowerCase()] : all);
}

async function ownWebhook(channel, client) {
  const hooks = await channel.fetchWebhooks();
  const existing = hooks.find((w) => w.owner && w.owner.id === client.user.id && w.token);
  if (existing) return existing;
  return channel.createWebhook({ name: `${client.user.username || 'Dziri'} Messaging`.slice(0, 80), avatar: client.user.displayAvatarURL({ extension: 'png', size: 128 }), reason: 'Dziri System member messaging' });
}

async function start(guild, {
  message, content, filters = {}, delayMs = 1500, by = 'dashboard', selectedBot = 'main',
  delivery = 'normal', channelId = '', attachmentIds = [], embed = {}, format = {},
}) {
  if (jobs.has(guild.id) && jobs.get(guild.id).status === 'running') throw new Error('A messaging job is already running for this server.');
  embed = embed && typeof embed === 'object' ? embed : {};
  // Persisted dashboard settings + explicit per-campaign overrides (what the dashboard previewed).
  const fmt = resolveFormat((configService.getGuildConfig(guild.id) || {}).messaging, {
    ...(format && typeof format === 'object' ? format : {}),
    // Legacy clients sent the colour inside `embed`; honour it when no explicit format colour is given.
    ...(format && format.embedColor === undefined && HEX6.test(String(embed.color || '')) ? { embedColor: embed.color } : {}),
  });
  let text = String(content !== undefined ? content : message || '').trim();
  // Legacy payloads carried a separate embed.description; in embed mode the message text IS the description.
  if (fmt.messageType === 'embed' && !text && embed.description) text = String(embed.description).trim();
  const cleanEmbed = {
    title: fmt.messageType === 'embed' ? String(embed.title || '').trim().slice(0, 256) : '',
    contentAbove: fmt.messageType === 'embed' ? String(embed.contentAbove || '').trim().slice(0, 1800) : '',
    color: fmt.embedColor,
  };
  const ids = [...new Set((Array.isArray(attachmentIds) ? attachmentIds : []).map(String))].slice(0, MAX_ATTACHMENTS);
  const attachments = ids.map((id) => findAttachment(guild.id, id));
  if (attachments.some((a) => !a)) throw new Error('One or more attachments are missing or expired. Remove them and upload again.');
  const totalSize = attachments.reduce((n, a) => n + a.size, 0);
  if (totalSize > MAX_TOTAL_SIZE) throw new Error('Combined attachments must be 20 MB or smaller.');
  if (!text && !cleanEmbed.title && !attachments.length) throw new Error(fmt.messageType === 'embed' ? 'Add message text, an embed title, or an attachment.' : 'Add message text or an attachment.');
  const maxLen = fmt.messageType === 'embed' ? 4000 : 1800;
  if (text.length > maxLen) throw new Error(`Message template must be at most ${maxLen} characters.`);

  const { key, client } = botRegistry.resolveSender(selectedBot, guild.id);
  const mode = delivery === 'webhook' ? 'webhook' : 'normal';
  let webhook = null;
  let deliveryChannel = null;
  if (mode === 'webhook') {
    if (!channelId) throw new Error('Select a Discord text channel for webhook delivery.');
    const senderGuild = client.guilds.cache.get(guild.id);
    deliveryChannel = senderGuild.channels.cache.get(channelId) || await senderGuild.channels.fetch(channelId).catch(() => null);
    if (!deliveryChannel || !deliveryChannel.isTextBased()) throw new Error('The selected webhook delivery channel no longer exists.');
    const me = senderGuild.members.me;
    if (!me || !me.permissionsIn(deliveryChannel).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageWebhooks])) {
      throw new Error(`${client.user.tag} needs View Channel, Send Messages, Embed Links, Attach Files and Manage Webhooks in the delivery channel.`);
    }
    webhook = await ownWebhook(deliveryChannel, client);
  }

  const { recipients, skipped } = await resolveRecipients(guild, filters);
  if (!recipients.length) throw new Error('No members match these filters.');
  const capped = recipients.slice(0, MAX_RECIPIENTS);
  const job = {
    id: `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
    guildId: guild.id, status: 'running', createdAt: Date.now(), by, message: text, embed: cleanEmbed, format: fmt,
    filters, selectedBot: key, delivery: mode, channelId, attachments, client, webhook, deliveryChannel,
    counts: { queued: capped.length, sent: 0, failed: 0, skipped: skipped + (recipients.length - capped.length) },
    cancelled: false, lastError: '',
  };
  jobs.set(guild.id, job);
  persist(job);
  historyService.add(guild.id, { type: 'broadcast', moderatorTag: by, reason: `Member messaging: ${capped.length} recipient(s) via ${mode} (${fmt.messageType})`, details: text.slice(0, 200) });
  run(job, capped, guild, Math.max(1000, Number(delayMs) || 1500)).catch((err) => { job.lastError = err.message; logger.error('Broadcast', err); });
  return job;
}

/**
 * Build the exact Discord payload for one recipient. Shared by DM and webhook delivery.
 *
 * normal → `content` = text (+ optional footer as Discord sub-text lines). Uploads are plain
 *          attachments, which Discord always renders BELOW the content.
 * embed  → text lives in `embeds[0].description`; the first image upload is referenced through
 *          `attachment://` as the embed image (so it renders BELOW the description, once), extra
 *          images become image-only embeds under it, other files stay plain attachments.
 *          Footer → `embeds[0].footer` only when enabled and non-empty.
 */
function payloadFor(job, member, guild) {
  const bot = job.client.user;
  const format = job.format || resolveFormat();
  const embedCfg = job.embed || {};
  const ex = (t) => expand(t, member, guild, bot);
  const text = ex(job.message);
  const footer = ex(effectiveFooter(format)).trim();
  const payload = { allowedMentions: { parse: [], users: [member.id], roles: [] }, files: [] };

  if (format.messageType !== 'embed') {
    // Discord renders content first, then attachments — no embed, nothing hidden is appended.
    const parts = [];
    if (text) parts.push(text);
    if (footer) parts.push(footer.split('\n').map((l) => `-# ${l}`).join('\n'));
    payload.content = parts.length ? parts.join('\n\n').slice(0, 2000) : undefined;
    payload.files = job.attachments.map((a) => ({ attachment: a.path, name: a.name }));
    return payload;
  }

  const color = parseInt(String(embedCfg.color || format.embedColor || '#a855f7').slice(1), 16);
  const main = { color };
  const title = ex(embedCfg.title);
  if (title) main.title = title.slice(0, 256);
  if (text) main.description = text.slice(0, 4096);
  if (footer) main.footer = { text: footer.slice(0, 2048) };
  const embeds = [main];
  let imageIndex = 0;
  for (const a of job.attachments) {
    const isImage = /^image\//.test(String(a.type || ''));
    const hasSlot = isImage && (!main.image || embeds.length < MAX_EMBEDS);
    if (!hasSlot) { payload.files.push({ attachment: a.path, name: a.name }); continue; } // non-image files (or >10 images) stay plain uploads
    // Unique ASCII-safe file name so `attachment://` resolves reliably (Arabic/space names are fine as plain uploads).
    const name = `image-${++imageIndex}${path.extname(a.name).toLowerCase() || '.png'}`;
    payload.files.push({ attachment: a.path, name });
    if (!main.image) main.image = { url: `attachment://${name}` };           // first image: inside the main embed, below the text
    else embeds.push({ color, image: { url: `attachment://${name}` } });     // further images: image-only embeds stacked below
  }
  const above = ex(embedCfg.contentAbove).trim();
  payload.content = above ? above.slice(0, 2000) : undefined;
  payload.embeds = embeds;
  return payload;
}

async function run(job, recipients, guild, delay) {
  for (const member of recipients) {
    if (job.cancelled) break;
    try {
      const payload = payloadFor(job, member, guild);
      if (job.delivery === 'webhook') await job.webhook.send(payload);
      else {
        const recipient = await job.client.users.fetch(member.id);
        await recipient.send(payload);
      }
      job.counts.sent++;
    } catch (err) {
      job.counts.failed++;
      job.lastError = String(err.message || err).slice(0, 500);
    }
    job.counts.queued--;
    if (job.counts.queued % 10 === 0) persist(job);
    if (!job.cancelled && job.counts.queued > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  job.status = job.cancelled ? 'cancelled' : 'completed';
  if (job.cancelled) { job.counts.skipped += job.counts.queued; job.counts.queued = 0; }
  job.finishedAt = Date.now();
  persist(job); store.flushNow('state', 'broadcasts');
  // Campaign uploads are no longer needed after all sends have completed.
  for (const attachment of job.attachments) removeAttachment(guild.id, attachment.id);
}

function cancel(guildId) { const job = jobs.get(guildId); if (job && job.status === 'running') { job.cancelled = true; return true; } return false; }

function status(guildId) {
  const live = jobs.get(guildId);
  const list = (statusDoc().jobs[guildId] || []).map((j) => (live && j.id === live.id
    ? { ...j, status: live.status, counts: { ...live.counts }, lastError: live.lastError }
    : (j.status === 'running' && (!live || live.id !== j.id) ? { ...j, status: 'interrupted' } : j)));
  return { active: live && live.status === 'running' ? { id: live.id, counts: live.counts, lastError: live.lastError } : null, jobs: list };
}

async function preview(guild, filters) {
  const { recipients, skipped } = await resolveRecipients(guild, filters);
  return { count: Math.min(recipients.length, MAX_RECIPIENTS), matched: recipients.length, skipped, cap: MAX_RECIPIENTS };
}

module.exports = {
  start, cancel, status, preview, expand, payloadFor, resolveRecipients, membersForRecipients, resolveFormat, effectiveFooter,
  saveAttachment, findAttachment, removeAttachment, pruneAttachments,
  PLACEHOLDERS, MESSAGE_TYPES, DEFAULT_FOOTER, MAX_ATTACHMENTS, MAX_FILE_SIZE, MAX_TOTAL_SIZE, ATTACH_DIR,
};
