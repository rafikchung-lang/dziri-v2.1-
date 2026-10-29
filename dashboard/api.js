'use strict';
/**
 * Dashboard JSON API. Every /guilds/:guildId/* route verifies access server-side.
 * Every PUT validates & sanitises input, persists synchronously to disk, and only then
 * returns { ok: true, ... } — so the UI never shows "saved" for unsaved data.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const configService = require('../services/configService');
const commandService = require('../services/commandService');
const historyService = require('../services/historyService');
const levelingService = require('../services/levelingService');
const moderationService = require('../services/moderationService');
const loggingService = require('../services/loggingService');
const broadcastService = require('../services/broadcastService');
const autoRoleService = require('../services/autoRoleService');
const ticketService = require('../services/ticketService');
const tempRoomService = require('../services/tempRoomService');
const roleNames = require('../utils/roleNames');
const { renderRankCard, UPLOAD_DIR } = require('../services/rankCardService');
const { defaultGuildConfig, defaultRankCard, defaultTickets, defaultTempRooms, ROOM_ACTIONS, ROOM_BUTTON_STYLES } = require('../config/defaults');
const botRegistry = require('../services/botRegistry');
const { normalizeDurationString } = require('../utils/duration');
const logger = require('../utils/logger');

const isId = (v) => /^\d{5,25}$/.test(String(v));
const SENDERS = ['main', 'ticket'];
const DELIVERIES = ['message', 'webhook'];
const isHttpUrl = (v) => !v || /^https:\/\/\S{3,500}$/i.test(String(v));
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Sanitise `input` against `template` (types & known keys only). Arrays of strings → id/word lists. */
function sanitize(template, input, current) {
  if (Array.isArray(template)) {
    if (!Array.isArray(input)) return current;
    return [...new Set(input.map((x) => String(x).trim()).filter(Boolean))].slice(0, 300).map((s) => s.slice(0, 200));
  }
  if (template !== null && typeof template === 'object') {
    const out = {};
    for (const k of Object.keys(template)) {
      const cur = current && current[k] !== undefined ? current[k] : template[k];
      out[k] = input && Object.prototype.hasOwnProperty.call(input, k) ? sanitize(template[k], input[k], cur) : cur;
    }
    return out;
  }
  if (typeof template === 'boolean') return typeof input === 'boolean' ? input : current;
  if (typeof template === 'number') { const n = Number(input); return Number.isFinite(n) ? n : current; }
  if (typeof template === 'string') return typeof input === 'string' ? input.slice(0, 2000) : current;
  return current;
}

const CH_TYPES = {
  [ChannelType.GuildText]: 'text', [ChannelType.GuildVoice]: 'voice', [ChannelType.GuildCategory]: 'category',
  [ChannelType.GuildAnnouncement]: 'announcement', [ChannelType.GuildStageVoice]: 'stage', [ChannelType.GuildForum]: 'forum', [ChannelType.GuildMedia]: 'media',
};

module.exports = function createApi(client, { canAccessGuild, ticketBot }) {
  const r = express.Router();
  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    logger.error('API', `${req.method} ${req.originalUrl}:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Internal error' });
  });

  r.get('/me', (req, res) => res.json({ user: req.session.user, mode: req.session.mode }));

  r.get('/bot', (req, res) => res.json({
    ready: client.isReady(),
    ticketBot: (() => {
      const tc = ticketBot && ticketBot.getClient && ticketBot.getClient();
      return { configured: Boolean(process.env.TICKET_DISCORD_TOKEN), ready: Boolean(tc && tc.isReady()), tag: tc && tc.isReady() ? tc.user.tag : null };
    })(),
    tag: client.isReady() ? client.user.tag : null,
    avatar: client.isReady() ? client.user.displayAvatarURL({ size: 128 }) : null,
    ping: client.isReady() ? client.ws.ping : null,
    guilds: client.isReady() ? client.guilds.cache.size : 0,
    uptime: client.isReady() ? client.uptime : 0,
    memory: Math.round(process.memoryUsage().rss / 1048576),
    inviteUrl: process.env.CLIENT_ID ? `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=1099780156438&scope=bot%20applications.commands` : null,
  }));

  r.get('/guilds', asyncH(async (req, res) => {
    if (!client.isReady()) return res.status(503).json({ error: 'The bot is not connected to Discord right now.' });
    const out = [];
    for (const g of client.guilds.cache.values()) {
      if (await canAccessGuild(client, req.session, g.id)) out.push({ id: g.id, name: g.name, icon: g.iconURL({ size: 64 }), memberCount: g.memberCount });
    }
    res.json({ guilds: out });
  }));

  // ---- guild guard -------------------------------------------------------
  r.use('/guilds/:guildId', asyncH(async (req, res, next) => {
    if (!client.isReady()) return res.status(503).json({ error: 'The bot is not connected to Discord right now. Try again in a moment.' });
    const { guildId } = req.params;
    if (!isId(guildId)) return res.status(400).json({ error: 'Invalid guild id.' });
    if (!client.guilds.cache.has(guildId)) return res.status(404).json({ error: 'The bot is not in this server.' });
    if (!(await canAccessGuild(client, req.session, guildId))) return res.status(403).json({ error: 'You need Manage Server permission in this server.' });
    req.guild = client.guilds.cache.get(guildId);
    next();
  }));

  r.get('/guilds/:guildId/overview', asyncH(async (req, res) => {
    const g = req.guild;
    const day = 86_400_000;
    res.json({
      guild: { id: g.id, name: g.name, icon: g.iconURL({ size: 128 }), memberCount: g.memberCount, channels: g.channels.cache.filter((c) => !c.isThread()).size, roles: g.roles.cache.size - 1, boosts: g.premiumSubscriptionCount || 0, createdAt: g.createdTimestamp, voiceActive: g.voiceStates.cache.filter((v) => v.channelId).size },
      bot: { ready: client.isReady(), ping: client.ws.ping, uptime: client.uptime, memory: Math.round(process.memoryUsage().rss / 1048576) },
      commands: { total: commandService.allCommands().length, enabled: commandService.allCommands().filter((d) => commandService.getCommandConfig(g.id, d).enabled).length },
      prefix: configService.getPrefix(g.id),
      moderation: { last24h: historyService.stats(g.id, day), last7d: historyService.stats(g.id, 7 * day), active: moderationService.activeCounts(g.id) },
      leveling: levelingService.summary(g.id),
      recent: historyService.recent(g.id, 10),
    });
  }));

  r.get('/guilds/:guildId/roles', asyncH(async (req, res) => {
    const roles = await req.guild.roles.fetch();
    const me = req.guild.members.me;
    res.json({ roles: [...roles.values()].sort((a, b) => b.position - a.position).map((x) => ({ id: x.id, name: x.id === req.guild.id ? '@everyone' : x.name, color: x.hexColor === '#000000' ? null : x.hexColor, position: x.position, managed: x.managed, everyone: x.id === req.guild.id, assignable: !x.managed && x.id !== req.guild.id && me && x.position < me.roles.highest.position })) });
  }));

  r.get('/guilds/:guildId/channels', asyncH(async (req, res) => {
    const chans = await req.guild.channels.fetch();
    const list = [...chans.values()].filter((c) => c && !c.isThread());
    const cats = new Map(list.filter((c) => c.type === ChannelType.GuildCategory).map((c) => [c.id, c]));
    const sortKey = (c) => { const p = c.parentId ? cats.get(c.parentId) : (c.type === ChannelType.GuildCategory ? c : null); return [(p ? p.rawPosition : -1), c.type === ChannelType.GuildCategory ? -1 : c.rawPosition]; };
    list.sort((a, b) => { const ka = sortKey(a); const kb = sortKey(b); return ka[0] - kb[0] || ka[1] - kb[1]; });
    const me = req.guild.members.me;
    res.json({ channels: list.map((c) => ({ id: c.id, name: c.name, type: CH_TYPES[c.type] || 'other', parentId: c.parentId || null, parentName: c.parentId && cats.get(c.parentId) ? cats.get(c.parentId).name : null, canSend: me ? me.permissionsIn(c).has(PermissionFlagsBits.SendMessages) : false })) });
  }));

  r.get('/guilds/:guildId/config', (req, res) => res.json({ config: configService.getGuildConfig(req.guild.id) }));

  // ---- commands ----------------------------------------------------------
  r.get('/guilds/:guildId/commands', (req, res) => {
    const gid = req.guild.id;
    res.json({
      prefix: configService.getPrefix(gid),
      commands: commandService.allCommands().map((d) => ({
        name: d.name, label: d.label || d.name, description: d.description, category: d.category,
        userPermissions: d.userPermissions, botPermissions: d.botPermissions, defaultAliases: d.defaultAliases,
        supportsReasons: Boolean(d.reasons), reasonDurations: Boolean(d.reasons && d.reasons.durations), supportsDuration: Boolean(d.defaultDuration),
        options: d.options.map((o) => ({ name: o.name, type: o.type, required: Boolean(o.required) })),
        config: commandService.getCommandConfig(gid, d),
      })),
    });
  });

  r.put('/guilds/:guildId/commands/:name', (req, res) => {
    const result = commandService.validateCommandConfig(req.guild.id, req.params.name, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error, alias: result.alias });
    const ok = configService.saveCommandConfig(req.guild.id, req.params.name, result.value);
    if (!ok) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    res.json({ ok: true, config: commandService.getCommandConfig(req.guild.id, commandService.getCommand(req.params.name)) });
  });

  // ---- settings (prefix etc.) -------------------------------------------
  r.put('/guilds/:guildId/settings', (req, res) => {
    const body = req.body || {};
    const gid = req.guild.id;
    if (Object.prototype.hasOwnProperty.call(body, 'prefix')) {
      if (typeof body.prefix !== 'string') return res.status(400).json({ error: 'Prefix must be a string (it may be empty).' });
      const p = body.prefix.normalize('NFC');
      if (p.length > 10) return res.status(400).json({ error: 'Prefix must be at most 10 characters.' });
      if (/\s/.test(p)) return res.status(400).json({ error: 'Prefix cannot contain spaces.' });
      // "" is VALID and stored as "" — never replaced by a default
      if (!configService.saveSection(gid, 'prefix', p)) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    }
    if (body.dashboard) {
      const cur = configService.getGuildConfig(gid).dashboard;
      const next = sanitize(defaultGuildConfig().dashboard, body.dashboard, cur);
      if (!HEX.test(next.accent)) next.accent = cur.accent;
      configService.saveSection(gid, 'dashboard', next);
    }
    res.json({ ok: true, prefix: configService.getPrefix(gid), dashboard: configService.getGuildConfig(gid).dashboard });
  });

  // ---- generic sections --------------------------------------------------
  const sectionSave = (section, post) => (req, res) => {
    const gid = req.guild.id;
    const current = configService.getGuildConfig(gid)[section];
    let next = sanitize(defaultGuildConfig()[section], req.body || {}, current);
    if (post) { const e = post(next, req.body || {}, current, req); if (typeof e === 'string') return res.status(400).json({ error: e }); if (e && typeof e === 'object') next = e; }
    if (!configService.saveSection(gid, section, next)) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    res.json({ ok: true, [section]: configService.getGuildConfig(gid)[section] });
  };

  const ACTIONS = ['delete', 'warn', 'timeout', 'kick', 'ban'];
  r.put('/guilds/:guildId/automod', sectionSave('automod', (next, body, current, req) => {
    // If this guild predates AutoMod messageCleanup, preserve its existing Temp Rooms
    // cleanup interval instead of replacing it with the new default on the first AutoMod save.
    const rawAutoMod = configService.getRaw(req.guild.id).automod || {};
    if (!rawAutoMod.messageCleanup) next.messageCleanup = tempRoomService.messageCleanupConfig(req.guild.id);
    for (const [k, rule] of Object.entries(next.rules)) {
      if (!ACTIONS.includes(rule.action)) return `Invalid action for ${k}.`;
      if (rule.duration !== undefined && normalizeDurationString(rule.duration) === null) return `Invalid duration for ${k}.`;
      for (const nk of ['threshold', 'interval', 'minLength']) if (rule[nk] !== undefined) rule[nk] = Math.max(1, Math.min(1000, Math.round(rule[nk])));
    }
    next.rules.caps.threshold = Math.min(100, next.rules.caps.threshold);
    next.exemptRoles = next.exemptRoles.filter(isId); next.exemptChannels = next.exemptChannels.filter(isId);
    if (next.logChannelId && !isId(next.logChannelId)) next.logChannelId = '';
    return next;
  }));

  r.get('/guilds/:guildId/automod/message-cleanup', (req, res) => {
    res.json({
      config: tempRoomService.messageCleanupConfig(req.guild.id),
      status: tempRoomService.cleanupStatus(req.guild.id),
    });
  });

  r.put('/guilds/:guildId/automod/message-cleanup', asyncH(async (req, res) => {
    const body = req.body || {};
    const currentAutoMod = configService.getGuildConfig(req.guild.id).automod;
    const current = tempRoomService.messageCleanupConfig(req.guild.id);
    const normalise = (value, fallback, withChannels) => {
      const input = value && typeof value === 'object' ? value : {};
      const unit = input.intervalUnit === 'days' ? 'days' : 'hours';
      const max = unit === 'days' ? 30 : 720;
      const out = {
        enabled: typeof input.enabled === 'boolean' ? input.enabled : fallback.enabled,
        intervalValue: Math.max(1, Math.min(max, Math.round(Number(input.intervalValue) || fallback.intervalValue || 24))),
        intervalUnit: unit,
      };
      if (withChannels) out.channelIds = [...new Set((Array.isArray(input.channelIds) ? input.channelIds : fallback.channelIds || []).map(String).filter(isId))].slice(0, 100);
      return out;
    };
    const next = {
      temporaryRooms: normalise(body.temporaryRooms, current.temporaryRooms, false),
      publicVoice: normalise(body.publicVoice, current.publicVoice, true),
    };

    await req.guild.channels.fetch().catch(() => null);
    const me = req.guild.members.me;
    for (const id of next.publicVoice.channelIds) {
      const channel = req.guild.channels.cache.get(id);
      if (!channel || channel.type !== ChannelType.GuildVoice) return res.status(400).json({ error: `Selected channel ${id} is not a Discord voice channel.` });
      if (me && !me.permissionsIn(channel).has([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory])) {
        return res.status(400).json({ error: `I need Manage Messages and Read Message History in “${channel.name}”.` });
      }
    }
    if (next.publicVoice.enabled && !next.publicVoice.channelIds.length) return res.status(400).json({ error: 'Select at least one public voice channel before enabling public cleanup.' });

    const saved = { ...currentAutoMod, messageCleanup: next };
    if (!configService.saveSection(req.guild.id, 'automod', saved)) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    res.json({ ok: true, config: next, status: tempRoomService.cleanupStatus(req.guild.id) });
  }));

  r.post('/guilds/:guildId/automod/message-cleanup/:scope/clear', asyncH(async (req, res) => {
    if (!req.body || req.body.confirm !== true) return res.status(400).json({ error: 'Confirmation is required before messages can be deleted.' });
    const scope = req.params.scope;
    if (!['temporaryRooms', 'publicVoice'].includes(scope)) return res.status(400).json({ error: 'Unknown cleanup channel type.' });
    try {
      const result = await tempRoomService.runMessageCleanup(req.guild, scope, { manual: true });
      res.json({ ok: true, result, status: tempRoomService.cleanupStatus(req.guild.id) });
    } catch (err) { res.status(409).json({ error: err.message }); }
  }));

  r.put('/guilds/:guildId/logging', sectionSave('logging', (next) => {
    next.ignoredChannels = next.ignoredChannels.filter(isId);
    if (next.defaultChannelId && !isId(next.defaultChannelId)) next.defaultChannelId = '';
    for (const ev of Object.values(next.events)) if (ev.channelId && !isId(ev.channelId)) ev.channelId = '';
    const allowedRetention = [0, 1, 3, 7, 14, 30, 90];
    next.retentionDays = allowedRetention.includes(Number(next.retentionDays)) ? Number(next.retentionDays) : 0;
    return next;
  }));

  r.get('/guilds/:guildId/logging/storage', (req, res) => {
    res.json({ local: loggingService.storageInfo(), retentionDays: configService.getGuildConfig(req.guild.id).logging.retentionDays });
  });

  r.post('/guilds/:guildId/logging/clear', asyncH(async (req, res) => {
    if (!req.body || req.body.confirm !== true) return res.status(400).json({ error: 'Confirmation is required before logs can be deleted.' });
    const result = await loggingService.clearLogs(req.guild);
    res.json({ ok: true, ...result });
  }));

  r.put('/guilds/:guildId/moderation', sectionSave('moderation', (next) => {
    if (!['timeout', 'role'].includes(next.muteMode)) return 'Invalid mute mode.';
    if (next.muteMode === 'role' && !isId(next.muteRoleId)) return 'Select a mute role when using role-based mutes.';
    for (const k of ['defaultMuteDuration', 'defaultVoiceMuteDuration']) { const d = normalizeDurationString(next[k]); if (d === null) return `Invalid ${k}.`; next[k] = d; }
    for (const k of ['modRoles', 'lockRoles', 'protectedRoles']) next[k] = next[k].filter(isId);
    return next;
  }));

  r.put('/guilds/:guildId/leveling', sectionSave('leveling', (next, body, current) => {
    next.textXpMin = Math.max(0, Math.min(1000, Math.round(next.textXpMin)));
    next.textXpMax = Math.max(next.textXpMin, Math.min(1000, Math.round(next.textXpMax)));
    next.textCooldown = Math.max(0, Math.min(86400, Math.round(next.textCooldown)));
    next.voiceXpPerMinute = Math.max(0, Math.min(1000, Math.round(next.voiceXpPerMinute)));
    next.ignoredChannels = next.ignoredChannels.filter(isId); next.ignoredRoles = next.ignoredRoles.filter(isId);
    if (next.levelUpChannelId && !isId(next.levelUpChannelId)) next.levelUpChannelId = '';
    next.levelUpTemplate = next.levelUpTemplate.slice(0, 500) || '{user} reached level {level}.';
    if (Array.isArray(body.rewards)) {
      const rewards = [];
      for (const rw of body.rewards.slice(0, 50)) {
        const level = Math.round(Number(rw && rw.level));
        if (!Number.isFinite(level) || level < 1 || level > 1000) return 'Reward levels must be between 1 and 1000.';
        if (!isId(rw.roleId)) return 'Every level reward needs a role.';
        rewards.push({ level, roleId: String(rw.roleId) });
      }
      next.rewards = rewards.sort((a, b) => a.level - b.level);
    } else next.rewards = current.rewards;
    return next;
  }));

  const sanitizeRankCard = (input, current) => {
    const next = sanitize(defaultRankCard(), input || {}, current);
    const def = defaultRankCard();
    for (const k of ['backgroundColor', 'gradientFrom', 'gradientTo', 'accentColor', 'accentColor2', 'textColor', 'subTextColor', 'trackColor']) if (!HEX.test(next[k])) next[k] = HEX.test(current[k]) ? current[k] : def[k];
    if (!['gradient', 'color', 'image'].includes(next.backgroundType)) next.backgroundType = 'gradient';
    if (!['circle', 'rounded', 'square'].includes(next.avatarShape)) next.avatarShape = 'circle';
    if (!['left', 'right'].includes(next.layout)) next.layout = 'left';
    if (!['rounded', 'sharp'].includes(next.progressStyle)) next.progressStyle = 'rounded';
    next.overlayOpacity = Math.max(0, Math.min(0.95, next.overlayOpacity));
    next.panelOpacity = Math.max(0, Math.min(0.9, next.panelOpacity));
    next.title = next.title.slice(0, 40);
    next.backgroundImage = current.backgroundImage; // only changed through the upload endpoint
    return next;
  };

  r.put('/guilds/:guildId/rankcard', (req, res) => {
    const gid = req.guild.id;
    const next = sanitizeRankCard(req.body, configService.getGuildConfig(gid).rankCard);
    if (next.backgroundType === 'image' && !next.backgroundImage) return res.status(400).json({ error: 'Upload a background image first.' });
    if (!configService.saveSection(gid, 'rankCard', next)) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    res.json({ ok: true, rankCard: configService.getGuildConfig(gid).rankCard });
  });

  r.post('/guilds/:guildId/rankcard/background', (req, res) => {
    const gid = req.guild.id;
    const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/s.exec(String((req.body && req.body.dataUrl) || ''));
    if (!m) return res.status(400).json({ error: 'Upload a PNG, JPEG, WEBP or GIF image.' });
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Image must be at most 5 MB.' });
    const magicOk = (buf[0] === 0x89 && buf[1] === 0x50) || (buf[0] === 0xff && buf[1] === 0xd8) || buf.slice(0, 4).toString() === 'RIFF' || buf.slice(0, 3).toString() === 'GIF';
    if (!magicOk) return res.status(400).json({ error: 'File is not a valid image.' });
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    const file = `${gid}-${Date.now()}.${ext}`;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    const cfg = configService.getGuildConfig(gid).rankCard;
    const old = cfg.backgroundImage;
    const next = { ...cfg, backgroundImage: file, backgroundType: 'image' };
    if (!configService.saveSection(gid, 'rankCard', next)) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    if (old && old !== file) fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(old))).catch(() => {});
    res.json({ ok: true, rankCard: configService.getGuildConfig(gid).rankCard });
  });

  r.delete('/guilds/:guildId/rankcard/background', (req, res) => {
    const gid = req.guild.id;
    const cfg = configService.getGuildConfig(gid).rankCard;
    if (cfg.backgroundImage) fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(cfg.backgroundImage))).catch(() => {});
    const next = { ...cfg, backgroundImage: '', backgroundType: cfg.backgroundType === 'image' ? 'gradient' : cfg.backgroundType };
    if (!configService.saveSection(gid, 'rankCard', next)) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    res.json({ ok: true, rankCard: configService.getGuildConfig(gid).rankCard });
  });

  r.get('/guilds/:guildId/rankcard/background', (req, res) => {
    const cfg = configService.getGuildConfig(req.guild.id).rankCard;
    const f = cfg.backgroundImage && path.join(UPLOAD_DIR, path.basename(cfg.backgroundImage));
    if (!f || !fs.existsSync(f)) return res.status(404).json({ error: 'No background uploaded.' });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.sendFile(f);
  });

  r.post('/guilds/:guildId/rankcard/preview', asyncH(async (req, res) => {
    const gid = req.guild.id;
    const current = configService.getGuildConfig(gid).rankCard;
    const cfg = sanitizeRankCard(req.body || {}, current);
    let member = null;
    if (req.session.mode === 'oauth') member = await req.guild.members.fetch(req.session.user.id).catch(() => null);
    const user = member ? member.user : client.user;
    const s = levelingService.stats(gid, user.id);
    const sample = s.totalXp > 0 ? s : { ...s, level: 7, current: 640, needed: 795, textXp: 4210, voiceXp: 1380, totalXp: 5590, rank: 3 };
    const png = await renderRankCard({
      username: member ? member.displayName : user.username, tag: user.username,
      avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
      rank: sample.rank, level: sample.level, current: sample.current, needed: sample.needed, textXp: sample.textXp, voiceXp: sample.voiceXp, totalXp: sample.totalXp,
    }, cfg);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.end(png);
  }));

  // ---- history / leaderboard ----------------------------------------------
  r.get('/guilds/:guildId/history', (req, res) => {
    const q = req.query;
    const out = historyService.query(req.guild.id, { page: Number(q.page) || 1, pageSize: Math.min(100, Number(q.pageSize) || 20), userId: isId(q.userId) ? String(q.userId) : '', type: String(q.type || '').slice(0, 30), search: String(q.search || '').slice(0, 100) });
    res.json(out);
  });

  r.get('/guilds/:guildId/leaderboard', asyncH(async (req, res) => {
    const type = ['text', 'voice', 'total'].includes(req.query.type) ? req.query.type : 'total';
    const lb = levelingService.leaderboard(req.guild.id, { type, page: Number(req.query.page) || 1, pageSize: 15 });
    const items = await Promise.all(lb.items.map(async (it) => {
      const m = req.guild.members.cache.get(it.userId) || await req.guild.members.fetch(it.userId).catch(() => null);
      return { ...it, username: m ? m.displayName : `Former member (${it.userId})`, avatar: m ? m.displayAvatarURL({ size: 64 }) : null };
    }));
    res.json({ ...lb, items });
  }));

  r.delete('/guilds/:guildId/leveling/users/:userId', (req, res) => {
    if (!isId(req.params.userId)) return res.status(400).json({ error: 'Invalid user id.' });
    levelingService.resetUser(req.guild.id, req.params.userId);
    res.json({ ok: true });
  });

  // ---- AutoRole -------------------------------------------------------------
  r.get('/guilds/:guildId/autorole', asyncH(async (req, res) => {
    // Refresh roles so deleted/renamed/hierarchy-changed roles are reported accurately.
    await req.guild.roles.fetch().catch(() => null);
    const autoRole = configService.getGuildConfig(req.guild.id).autoRole;
    res.json({ autoRole, status: autoRoleService.status(req.guild, autoRole.roleIds) });
  }));

  r.put('/guilds/:guildId/autorole', asyncH(async (req, res) => {
    const current = configService.getGuildConfig(req.guild.id).autoRole;
    const body = req.body || {};
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled;
    if (!Array.isArray(body.roleIds)) return res.status(400).json({ error: 'Select one or more roles using the Discord role selector.' });
    const roleIds = [...new Set(body.roleIds.map(String))];
    if (roleIds.length > 25) return res.status(400).json({ error: 'AutoRole supports at most 25 roles.' });
    if (roleIds.some((id) => !isId(id))) return res.status(400).json({ error: 'Invalid Discord role ID.' });

    await req.guild.roles.fetch().catch(() => null);
    const checked = autoRoleService.inspect(req.guild, roleIds);
    if (checked.missing.length) {
      return res.status(400).json({ error: `A selected role no longer exists: ${checked.missing.join(', ')}. Remove it and save again.` });
    }
    if (checked.unmanageable.length) {
      const first = checked.unmanageable[0];
      return res.status(400).json({ error: `I cannot assign “${first.name}”: ${first.reason} Move my highest role above it, then try again.` });
    }
    if (enabled && checked.botMissingPermission) {
      return res.status(400).json({ error: 'I need the Manage Roles permission before AutoRole can be enabled.' });
    }

    const next = { enabled, roleIds };
    if (!configService.saveSection(req.guild.id, 'autoRole', next)) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    res.json({ ok: true, autoRole: next, status: autoRoleService.status(req.guild, roleIds) });
  }));

  // ---- custom role names (separate from command aliases) --------------------
  r.get('/guilds/:guildId/rolenames', (req, res) => {
    const entries = roleNames.getEntries(req.guild.id).map((e) => {
      const role = req.guild.roles.cache.get(e.roleId);
      return { ...e, roleName: role ? role.name : null, missing: !role, color: role && role.hexColor !== '#000000' ? role.hexColor : null };
    });
    res.json({ entries });
  });

  r.put('/guilds/:guildId/rolenames', (req, res) => {
    const result = roleNames.validateEntries((req.body && req.body.entries) || []);
    if (!result.ok) return res.status(400).json({ error: result.error, name: result.name });
    // Keep rows whose role was deleted out of the active config but never crash on them.
    if (!configService.saveSection(req.guild.id, 'roleNames', result.value)) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    res.json({ ok: true, entries: roleNames.getEntries(req.guild.id) });
  });

  // ---- shared image upload for ticket / temp-room panels --------------------
  const IMAGE_SCOPES = { tickets: 'tickets', temprooms: 'tempRooms' };
  function saveImage(gid, section, dataUrl) {
    const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/s.exec(String(dataUrl || ''));
    if (!m) return { error: 'Upload a PNG, JPEG, WEBP or GIF image.' };
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 5 * 1024 * 1024) return { error: 'Image must be at most 5 MB.' };
    const magicOk = (buf[0] === 0x89 && buf[1] === 0x50) || (buf[0] === 0xff && buf[1] === 0xd8) || buf.slice(0, 4).toString() === 'RIFF' || buf.slice(0, 3).toString() === 'GIF';
    if (!magicOk) return { error: 'File is not a valid image.' };
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    const file = `${section}-${gid}-${Date.now()}.${ext}`;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    return { file };
  }

  r.post('/guilds/:guildId/:scope/panel-image', (req, res) => {
    const section = IMAGE_SCOPES[req.params.scope];
    if (!section) return res.status(404).json({ error: 'Unknown panel.' });
    const gid = req.guild.id;
    const out = saveImage(gid, req.params.scope, req.body && req.body.dataUrl);
    if (out.error) return res.status(400).json({ error: out.error });
    const cur = configService.getGuildConfig(gid)[section];
    const old = cur.panel.image;
    if (!configService.saveSection(gid, section, { ...cur, panel: { ...cur.panel, image: out.file } })) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    if (old && old !== out.file) fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(old))).catch(() => {});
    res.json({ ok: true, image: out.file });
  });

  r.delete('/guilds/:guildId/:scope/panel-image', (req, res) => {
    const section = IMAGE_SCOPES[req.params.scope];
    if (!section) return res.status(404).json({ error: 'Unknown panel.' });
    const gid = req.guild.id;
    const cur = configService.getGuildConfig(gid)[section];
    if (cur.panel.image) fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(cur.panel.image))).catch(() => {});
    if (!configService.saveSection(gid, section, { ...cur, panel: { ...cur.panel, image: '' } })) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    res.json({ ok: true, image: '' });
  });

  r.get('/guilds/:guildId/:scope/panel-image', (req, res) => {
    const section = IMAGE_SCOPES[req.params.scope];
    if (!section) return res.status(404).json({ error: 'Unknown panel.' });
    const cur = configService.getGuildConfig(req.guild.id)[section];
    const f = cur.panel.image && path.join(UPLOAD_DIR, path.basename(cur.panel.image));
    if (!f || !fs.existsSync(f)) return res.status(404).json({ error: 'No image uploaded.' });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.sendFile(f);
  });

  // ---- tickets --------------------------------------------------------------
  r.get('/guilds/:guildId/tickets', (req, res) => {
    res.json({
      tickets: configService.getGuildConfig(req.guild.id).tickets, // never contains webhook tokens
      status: ticketService.status(req.guild.id),
      bots: botRegistry.availability(req.guild.id),
    });
  });

  r.put('/guilds/:guildId/tickets', (req, res) => {
    const gid = req.guild.id;
    const current = configService.getGuildConfig(gid).tickets;
    const body = req.body || {};
    const next = sanitize(defaultTickets(), { ...body, types: undefined, panel: body.panel ? { ...body.panel, image: undefined } : undefined }, current);
    next.panel.image = current.panel.image;          // only the upload endpoint changes the image
    next.panel.messageId = current.panel.messageId;  // publishing state is server-owned
    next.panel.publishedChannelId = current.panel.publishedChannelId;
    next.panel.publishedAt = current.panel.publishedAt;
    next.supportRoles = next.supportRoles.filter(isId);
    next.notifications.mentionRoles = next.notifications.mentionRoles.filter(isId);
    for (const [k, v] of [['categoryId', next.categoryId], ['logChannelId', next.logChannelId]]) if (v && !isId(v)) next[k] = '';
    if (next.panel.channelId && !isId(next.panel.channelId)) next.panel.channelId = '';
    if (next.notifications.channelId && !isId(next.notifications.channelId)) next.notifications.channelId = '';
    if (!HEX.test(next.panel.color)) next.panel.color = current.panel.color;
    if (!SENDERS.includes(next.panel.senderBot)) return res.status(400).json({ error: 'Invalid panel sender bot.' });
    if (!DELIVERIES.includes(next.panel.delivery)) return res.status(400).json({ error: 'Invalid panel delivery mode.' });
    if (!isHttpUrl(next.panel.imageUrl)) return res.status(400).json({ error: 'Panel image URL must be a https:// link.' });
    if (!isHttpUrl(next.panel.thumbnailUrl)) return res.status(400).json({ error: 'Thumbnail URL must be a https:// link.' });
    next.maxOpenPerUser = Math.max(1, Math.min(10, Math.round(next.maxOpenPerUser) || 1));
    if (!next.namingFormat.trim()) next.namingFormat = 'ticket-{username}';

    if (Array.isArray(body.types)) {
      if (body.types.length > 25) return res.status(400).json({ error: 'Discord select menus allow at most 25 ticket types.' });
      const types = []; const ids = new Set();
      for (const t of body.types) {
        const name = String((t && t.name) || '').trim();
        if (!name) return res.status(400).json({ error: 'Every ticket type needs a name.' });
        if (name.length > 100) return res.status(400).json({ error: 'Ticket type names must be at most 100 characters.' });
        let id = String(t.id || '').replace(/[^a-z0-9_-]/gi, '').toLowerCase().slice(0, 32) || `type${types.length + 1}`;
        while (ids.has(id)) id = `${id}-${types.length + 1}`;
        ids.add(id);
        types.push({
          id, name,
          description: String(t.description || '').slice(0, 100),
          emoji: String(t.emoji || '').slice(0, 8),
          categoryId: isId(t.categoryId) ? String(t.categoryId) : '',
          supportRoles: Array.isArray(t.supportRoles) ? t.supportRoles.filter(isId) : [],
          namingFormat: String(t.namingFormat || '').slice(0, 100),
          welcome: String(t.welcome || '').slice(0, 1500),
        });
      }
      next.types = types;
    } else next.types = current.types;

    if (!configService.saveSection(gid, 'tickets', next)) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    ticketService.syncNotificationPermissions(gid).catch(() => {});
    res.json({ ok: true, tickets: configService.getGuildConfig(gid).tickets, status: ticketService.status(gid) });
  });

  r.post('/guilds/:guildId/tickets/publish', asyncH(async (req, res) => {
    try { res.json({ ok: true, ...(await ticketService.publishPanel(req.guild.id)), status: ticketService.status(req.guild.id) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  }));

  r.post('/guilds/:guildId/tickets/sync-permissions', asyncH(async (req, res) => {
    const done = await ticketService.syncNotificationPermissions(req.guild.id);
    res.json({ ok: done, error: done ? undefined : 'Nothing to sync — enable notifications, pick a channel, and make sure the Ticket Bot has Manage Channels there.' });
  }));

  // ---- temporary rooms -------------------------------------------------------
  r.get('/guilds/:guildId/temprooms', (req, res) => {
    const cfg = configService.getGuildConfig(req.guild.id).tempRooms;
    // Normalise (and migrate) the button list so the dashboard always edits the real thing.
    const panel = { ...cfg.panel, buttons: tempRoomService.storedButtonList(req.guild.id, cfg.panel).filter((b) => b && ROOM_ACTIONS[b.action]) };
    delete panel.buttonLabels;
    res.json({
      tempRooms: { ...cfg, panel },
      status: tempRoomService.status(req.guild.id),
      actions: Object.entries(ROOM_ACTIONS).map(([action, meta]) => ({ action, ...meta })),
      styles: ROOM_BUTTON_STYLES,
      bots: botRegistry.availability(req.guild.id),
    });
  });

  r.put('/guilds/:guildId/temprooms', (req, res) => {
    const gid = req.guild.id;
    const current = configService.getGuildConfig(gid).tempRooms;
    const body = req.body || {};
    const next = sanitize(defaultTempRooms(), { ...body, panel: body.panel ? { ...body.panel, image: undefined } : undefined }, current);
    next.panel.image = current.panel.image;
    next.panel.messageId = current.panel.messageId;
    next.panel.publishedChannelId = current.panel.publishedChannelId;
    next.panel.publishedAt = current.panel.publishedAt;
    next.staffRoles = next.staffRoles.filter(isId);
    for (const k of ['joinChannelId', 'categoryId', 'logChannelId']) if (next[k] && !isId(next[k])) next[k] = '';
    if (next.panel.channelId && !isId(next.panel.channelId)) next.panel.channelId = '';
    if (!HEX.test(next.panel.color)) next.panel.color = current.panel.color;
    if (!SENDERS.includes(next.panel.senderBot)) return res.status(400).json({ error: 'Invalid panel sender bot.' });
    if (!DELIVERIES.includes(next.panel.delivery)) return res.status(400).json({ error: 'Invalid panel delivery mode.' });
    if (!isHttpUrl(next.panel.imageUrl)) return res.status(400).json({ error: 'Panel image URL must be a https:// link.' });
    if (!isHttpUrl(next.panel.thumbnailUrl)) return res.status(400).json({ error: 'Thumbnail URL must be a https:// link.' });
    next.defaultUserLimit = Math.max(0, Math.min(99, Math.round(next.defaultUserLimit) || 0));
    next.emptyGraceSeconds = Math.max(0, Math.min(300, Math.round(next.emptyGraceSeconds) || 0));
    next.maxRoomsPerUser = Math.max(1, Math.min(5, Math.round(next.maxRoomsPerUser) || 1));
    next.chatCleanup.retentionHours = Math.max(1, Math.min(720, Math.round(next.chatCleanup.retentionHours) || 24));
    if (!next.nameFormat.trim()) next.nameFormat = "{username}'s Room";
    // Control panel buttons: only actions the backend can really execute are accepted.
    const inButtons = body.panel && body.panel.buttons;
    if (Array.isArray(inButtons)) {
      if (inButtons.length > 25) return res.status(400).json({ error: 'Discord allows at most 25 buttons (5 rows × 5).' });
      const buttons = []; const ids = new Set();
      for (const b of inButtons) {
        const action = String((b && b.action) || '');
        if (!ROOM_ACTIONS[action]) return res.status(400).json({ error: `"${action || 'unknown'}" is not an implemented control panel action.` });
        const label = String((b.label !== undefined ? b.label : ROOM_ACTIONS[action].label)).trim();
        if (!label) return res.status(400).json({ error: 'Every button needs a label.' });
        if (label.length > 80) return res.status(400).json({ error: 'Button labels must be at most 80 characters.' });
        const style = ROOM_BUTTON_STYLES.includes(b.style) ? b.style : 'secondary';
        let id = String(b.id || `b-${action}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || `b-${action}`;
        while (ids.has(id)) id = `${id}-${buttons.length}`;
        ids.add(id);
        buttons.push({ id, action, label, emoji: String(b.emoji || '').trim().slice(0, 16), style, enabled: b.enabled !== false });
      }
      next.panel.buttons = buttons;
    } else next.panel.buttons = tempRoomService.storedButtonList(gid, current.panel);
    delete next.panel.buttonLabels;
    if (next.enabled && !next.joinChannelId) return res.status(400).json({ error: 'Select a Join-to-Create voice channel before enabling temporary rooms.' });
    if (!configService.saveSection(gid, 'tempRooms', next)) return res.status(500).json({ error: 'Could not write configuration to disk.' });
    res.json({ ok: true, tempRooms: configService.getGuildConfig(gid).tempRooms, status: tempRoomService.status(gid) });
  });

  r.post('/guilds/:guildId/temprooms/publish', asyncH(async (req, res) => {
    try { res.json({ ok: true, ...(await tempRoomService.publishPanel(req.guild.id)), status: tempRoomService.status(req.guild.id) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  }));

  // ---- member messaging ----------------------------------------------------
  r.get('/guilds/:guildId/broadcast/bots', (req, res) => {
    res.json({ bots: botRegistry.availability(req.guild.id), placeholders: broadcastService.PLACEHOLDERS, messaging: configService.getGuildConfig(req.guild.id).messaging });
  });

  // Persisted message format: normal vs embed, footer on/off + text, embed colour.
  // Stored in the guild config like every other section, so it survives reloads and restarts.
  r.put('/guilds/:guildId/messaging', sectionSave('messaging', (next) => {
    if (!broadcastService.MESSAGE_TYPES.includes(next.messageType)) return 'Invalid message type.';
    if (!/^#[0-9a-fA-F]{6}$/.test(next.embedColor)) return 'Invalid embed colour.';
    next.footerText = String(next.footerText || '').trim().slice(0, 2048); // '' is valid and means "no footer"
    return next;
  }));

  r.post('/guilds/:guildId/broadcast/attachments', (req, res) => {
    try {
      const attachment = broadcastService.saveAttachment(req.guild.id, req.body || {});
      res.json({ ok: true, attachment });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  r.get('/guilds/:guildId/broadcast/attachments/:id', (req, res) => {
    const attachment = broadcastService.findAttachment(req.guild.id, req.params.id);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found or expired.' });
    res.type(attachment.type).setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(attachment.path);
  });

  r.delete('/guilds/:guildId/broadcast/attachments/:id', (req, res) => {
    res.json({ ok: broadcastService.removeAttachment(req.guild.id, req.params.id) });
  });

  const cleanFilters = (f = {}) => ({
    target: f.target === 'roles' ? 'roles' : 'all',
    roles: Array.isArray(f.roles) ? f.roles.filter(isId) : [],
    excludeRoles: Array.isArray(f.excludeRoles) ? f.excludeRoles.filter(isId) : [],
    joinedWithinDays: Math.max(0, Math.min(3650, Number(f.joinedWithinDays) || 0)),
    joinedBeforeDays: Math.max(0, Math.min(3650, Number(f.joinedBeforeDays) || 0)),
  });
  r.post('/guilds/:guildId/broadcast/preview', asyncH(async (req, res) => {
    const f = cleanFilters(req.body && req.body.filters);
    if (f.target === 'roles' && !f.roles.length) return res.status(400).json({ error: 'Select at least one role.' });
    res.json(await broadcastService.preview(req.guild, f));
  }));
  r.post('/guilds/:guildId/broadcast', asyncH(async (req, res) => {
    const body = req.body || {};
    if (body.confirm !== true) return res.status(400).json({ error: 'Confirmation required.' });
    const f = cleanFilters(body.filters);
    if (f.target === 'roles' && !f.roles.length) return res.status(400).json({ error: 'Select at least one role.' });
    try {
      const job = await broadcastService.start(req.guild, {
        content: body.message,
        embed: body.embed,
        format: body.format, // { messageType, footerEnabled, footerText, embedColor } — falls back to saved settings
        attachmentIds: body.attachmentIds,
        selectedBot: body.selectedBot,
        delivery: body.delivery,
        channelId: isId(body.channelId) ? String(body.channelId) : '',
        filters: f,
        delayMs: body.delayMs,
        by: req.session.user.username,
      });
      res.json({ ok: true, job: { id: job.id, counts: job.counts } });
    } catch (err) { res.status(400).json({ error: err.message }); }
  }));
  r.get('/guilds/:guildId/broadcast', (req, res) => res.json(broadcastService.status(req.guild.id)));
  r.post('/guilds/:guildId/broadcast/cancel', (req, res) => res.json({ ok: broadcastService.cancel(req.guild.id) }));

  return r;
};
