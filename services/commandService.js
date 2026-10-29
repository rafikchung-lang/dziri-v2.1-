'use strict';
/**
 * Central command registry + dispatcher (single source of truth).
 *
 * Every trigger path — /slash, prefix + name, prefix + alias, Arabic alias, empty-prefix
 * name/alias — ends in runCommand(), which performs ALL permission checks before calling
 * the command's single execute() handler. Aliases can never bypass permissions.
 *
 * Initialisation order is explicit: the registry Map is created at module load, commands are
 * registered by loadCommands() at startup, and nothing reads the registry before that.
 */
const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder,
  ChannelType, MessageFlags,
} = require('discord.js');
const configService = require('./configService');
const { buildTriggerMap, parseMessage } = require('../utils/commandParser');
const { normalizeToken, cleanAlias, isValidAlias } = require('../utils/normalize');
const { isDurationToken, normalizeDurationString } = require('../utils/duration');
const roleNames = require('../utils/roleNames');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');

/** @type {Map<string, any>} */
const registry = new Map();
const triggerCache = new Map(); // guildId -> Map<token, commandName>

configService.onChange((guildId, section) => {
  if (section === 'commands') triggerCache.delete(guildId); // hot reload aliases
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
function loadCommands(dir = path.join(__dirname, '..', 'commands')) {
  registry.clear();
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const def = require(full);
        if (!def || !def.name || typeof def.execute !== 'function') {
          logger.warn('Commands', `Skipping invalid command file ${entry.name}`);
          continue;
        }
        def.options = def.options || [];
        def.userPermissions = def.userPermissions || [];
        def.botPermissions = def.botPermissions || [];
        def.defaultAliases = def.defaultAliases || [];
        registry.set(def.name, def);
      }
    }
  };
  walk(dir);
  triggerCache.clear();
  return registry.size;
}

function getCommand(name) { return registry.get(name); }
function allCommands() { return [...registry.values()]; }

// ---------------------------------------------------------------------------
// Per-guild command configuration
// ---------------------------------------------------------------------------
function getCommandConfig(guildId, def) {
  const stored = (configService.getRaw(guildId).commands || {})[def.name] || {};
  const base = {
    enabled: true,
    aliases: [...def.defaultAliases],
    reasons: def.reasons ? def.reasons.defaults.map((r) => ({ ...r })) : [],
    allowedRoles: [],
    allowedChannels: [],
    log: true,
    deleteTrigger: false,
    ephemeral: false,
    dmTarget: true,
    defaultDuration: def.defaultDuration || '',
    useReasonMenu: Boolean(def.reasons),
  };
  for (const k of Object.keys(stored)) if (stored[k] !== undefined) base[k] = stored[k];
  if (!Array.isArray(base.aliases)) base.aliases = [];
  if (!Array.isArray(base.reasons)) base.reasons = [];
  if (!Array.isArray(base.allowedRoles)) base.allowedRoles = [];
  if (!Array.isArray(base.allowedChannels)) base.allowedChannels = [];
  return base;
}

function getTriggerMap(guildId) {
  let map = triggerCache.get(guildId);
  if (map) return map;
  const aliases = {};
  for (const def of registry.values()) {
    const cfg = getCommandConfig(guildId, def);
    aliases[def.name] = cfg.enabled ? cfg.aliases : [];
  }
  map = buildTriggerMap([...registry.keys()], aliases);
  triggerCache.set(guildId, map);
  return map;
}

/**
 * Validate & clean a command config coming from the dashboard.
 * Returns { ok: true, value } or { ok: false, error }.
 */
function validateCommandConfig(guildId, commandName, input) {
  const def = registry.get(commandName);
  if (!def) return { ok: false, error: 'Unknown command.' };
  const current = getCommandConfig(guildId, def);
  const out = { ...current };

  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  for (const k of ['log', 'deleteTrigger', 'ephemeral', 'dmTarget', 'useReasonMenu']) {
    if (typeof input[k] === 'boolean') out[k] = input[k];
  }

  if (Array.isArray(input.aliases)) {
    const seen = new Set();
    const aliases = [];
    for (const raw of input.aliases) {
      const a = cleanAlias(String(raw));
      if (!isValidAlias(a)) return { ok: false, error: `Invalid alias "${raw}". Aliases cannot be empty, contain spaces, or exceed 32 characters.` };
      const key = normalizeToken(a);
      if (seen.has(key)) continue;
      seen.add(key);
      // collision with another command's canonical name or alias
      for (const other of registry.values()) {
        if (other.name === commandName) continue;
        if (normalizeToken(other.name) === key) return { ok: false, error: `This alias is already assigned to another command. ("${a}" is the name of /${other.name})`, alias: a };
        const oc = getCommandConfig(guildId, other);
        if (oc.aliases.some((x) => normalizeToken(x) === key)) {
          return { ok: false, error: `This alias is already assigned to another command. ("${a}" belongs to /${other.name})`, alias: a };
        }
      }
      if (key === normalizeToken(commandName)) continue; // canonical name always works anyway
      aliases.push(a);
    }
    if (aliases.length > 25) return { ok: false, error: 'A command can have at most 25 aliases.' };
    out.aliases = aliases;
  }

  if (Array.isArray(input.reasons)) {
    if (input.reasons.length > 25) return { ok: false, error: 'Discord select menus support at most 25 reasons.' };
    const reasons = [];
    for (const r of input.reasons) {
      const label = String((r && r.label) || '').trim();
      if (!label) return { ok: false, error: 'Every reason needs a label.' };
      if (label.length > 100) return { ok: false, error: 'Reason labels must be at most 100 characters.' };
      const d = normalizeDurationString(r.duration);
      if (d === null) return { ok: false, error: `Invalid duration "${r.duration}" for reason "${label}". Use e.g. 10m, 1h, 7d or permanent.` };
      reasons.push({ label, duration: d });
    }
    out.reasons = reasons;
  }

  if (input.defaultDuration !== undefined) {
    const d = normalizeDurationString(input.defaultDuration);
    if (d === null) return { ok: false, error: 'Invalid default duration.' };
    out.defaultDuration = d;
  }

  const idList = (v) => (Array.isArray(v) ? [...new Set(v.map(String).filter((x) => /^\d{5,25}$/.test(x)))] : null);
  const roles = idList(input.allowedRoles); if (roles) out.allowedRoles = roles;
  const channels = idList(input.allowedChannels); if (channels) out.allowedChannels = channels;

  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Slash command definitions (generated from the same option spec used by prefix parsing)
// ---------------------------------------------------------------------------
function buildSlash(def) {
  const b = new SlashCommandBuilder().setName(def.name).setDescription(def.description.slice(0, 100)).setDMPermission(false);
  for (const o of def.options) {
    const desc = (o.description || o.name).slice(0, 100);
    const req = Boolean(o.required);
    switch (o.type) {
      case 'member': case 'user': b.addUserOption((x) => x.setName(o.name).setDescription(desc).setRequired(req)); break;
      case 'integer': b.addIntegerOption((x) => { x.setName(o.name).setDescription(desc).setRequired(req); if (o.min !== undefined) x.setMinValue(o.min); if (o.max !== undefined) x.setMaxValue(o.max); return x; }); break;
      case 'channel': b.addChannelOption((x) => x.setName(o.name).setDescription(desc).setRequired(req).addChannelTypes(...(o.channelTypes || [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildStageVoice]))); break;
      case 'role': b.addRoleOption((x) => x.setName(o.name).setDescription(desc).setRequired(req)); break;
      case 'choice': b.addStringOption((x) => x.setName(o.name).setDescription(desc).setRequired(req).addChoices(...o.choices.map((c) => ({ name: c.label || c.value, value: c.value })))); break;
      // Custom role names (e.g. "ods" / "أوديسي") are not real Discord roles, so this option is a
      // string with autocomplete that lists the REAL guild roles plus their configured custom names.
      case 'rolename': b.addStringOption((x) => x.setName(o.name).setDescription(desc).setRequired(req).setAutocomplete(true).setMaxLength(100)); break;
      case 'snowflake': case 'duration': case 'string': case 'rest':
      default: b.addStringOption((x) => x.setName(o.name).setDescription(desc).setRequired(req).setMaxLength(o.type === 'rest' ? 512 : 100)); break;
    }
  }
  return b.toJSON();
}

function slashDefinitions() { return allCommands().map(buildSlash); }

// ---------------------------------------------------------------------------
// Context shared by slash & prefix invocations
// ---------------------------------------------------------------------------
class CommandContext {
  constructor({ source, client, guild, channel, member, user, interaction, message, def, cfg, trigger }) {
    Object.assign(this, { source, client, guild, channel, member, user, interaction, message, def, cfg, trigger });
    this.args = {};
    this.botMessage = null;
    this.pendingComponent = null;
  }

  get guildConfig() { return configService.getGuildConfig(this.guild.id); }

  async defer() {
    if (this.source === 'slash' && !this.interaction.deferred && !this.interaction.replied) {
      await this.interaction.deferReply(this.cfg.ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    } else if (this.source === 'prefix') {
      this.channel.sendTyping().catch(() => {});
    }
  }

  /** Send or update the single response message for this invocation. */
  async respond(payload) {
    const p = typeof payload === 'string' ? { content: payload } : { ...payload };
    if (!p.components) p.components = [];
    p.allowedMentions = p.allowedMentions || { parse: [] };
    try {
      if (this.pendingComponent) {
        const ci = this.pendingComponent; this.pendingComponent = null;
        await ci.update(p);
        return;
      }
      if (this.source === 'slash') {
        if (this.interaction.deferred || this.interaction.replied) { await this.interaction.editReply(p); return; }
        const flags = this.cfg.ephemeral ? MessageFlags.Ephemeral : undefined;
        await this.interaction.reply({ ...p, flags });
        return;
      }
      if (this.botMessage) { await this.botMessage.edit(p); return; }
      this.botMessage = await this.message.reply({ ...p, allowedMentions: { repliedUser: false, parse: [] } });
    } catch (err) {
      logger.warn('Commands', 'Failed to respond:', err.message);
    }
  }

  async error(text) { return this.respond({ embeds: [embeds.error(text)], content: '' }); }
  async success(text, fields) { return this.respond({ embeds: [embeds.success(text, fields)], content: '' }); }

  /**
   * Show a Discord select menu with the reasons configured for THIS command in the dashboard.
   * Resolves with { label, duration } or null (timeout / cancelled).
   */
  async chooseReason(title) {
    const reasons = (this.cfg.reasons || []).slice(0, 25);
    if (!reasons.length || this.cfg.useReasonMenu === false) return { label: 'No reason provided', duration: '' };
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`dz-reason-${Date.now()}`)
      .setPlaceholder('Select a reason')
      .addOptions(reasons.map((r, i) => ({
        label: r.label.slice(0, 100),
        description: r.duration ? (r.duration === 'permanent' ? 'Permanent' : `Duration: ${r.duration}`) : (this.def.reasons && this.def.reasons.durations ? 'Default duration' : undefined),
        value: String(i),
      })));
    const row = new ActionRowBuilder().addComponents(menu);
    const payload = { embeds: [embeds.info(title || 'Select a reason', 'Choose a reason from the menu below. This menu expires in 60 seconds.')], components: [row] };

    let msg;
    if (this.source === 'slash') {
      if (this.interaction.deferred || this.interaction.replied) await this.interaction.editReply(payload);
      else await this.interaction.reply({ ...payload, flags: this.cfg.ephemeral ? MessageFlags.Ephemeral : undefined });
      msg = await this.interaction.fetchReply();
    } else {
      this.botMessage = await this.message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
      msg = this.botMessage;
    }
    try {
      const sel = await msg.awaitMessageComponent({
        filter: (i) => i.user.id === this.user.id && i.customId === menu.data.custom_id,
        time: 60_000,
      });
      this.pendingComponent = sel;
      return reasons[Number(sel.values[0])] || null;
    } catch {
      await this.respond({ embeds: [embeds.error('No reason selected — action cancelled.')], components: [] });
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Permission checks (shared by EVERY trigger path)
// ---------------------------------------------------------------------------
function checkAccess(ctx) {
  const { member, def, cfg, guild, channel } = ctx;
  if (!guild || !member) return 'This command can only be used inside a server.';
  if (!cfg.enabled) return 'This command is disabled on this server.';
  const perms = member.permissions;
  const isAdmin = perms.has(PermissionFlagsBits.Administrator) || guild.ownerId === member.id;

  if (!isAdmin && cfg.allowedChannels.length && !cfg.allowedChannels.includes(channel.id) && !cfg.allowedChannels.includes(channel.parentId)) {
    return 'This command cannot be used in this channel.';
  }
  if (!isAdmin) {
    const roleIds = member.roles.cache;
    const hasAllowedRole = cfg.allowedRoles.some((r) => roleIds.has(r));
    if (def.userPermissions.length) {
      const hasPerms = perms.has(def.userPermissions.map((p) => PermissionFlagsBits[p]));
      const modRoles = (ctx.guildConfig.moderation.modRoles || []);
      const hasModRole = def.category === 'moderation' && modRoles.some((r) => roleIds.has(r));
      if (!hasPerms && !hasAllowedRole && !hasModRole) {
        return `You need the **${def.userPermissions.join(', ')}** permission (or an allowed role) to use this command.`;
      }
    } else if (cfg.allowedRoles.length && !hasAllowedRole) {
      return 'You do not have an allowed role for this command.';
    }
  }
  const me = guild.members.me;
  if (def.botPermissions.length && me) {
    const missing = def.botPermissions.filter((p) => !me.permissionsIn(channel).has(PermissionFlagsBits[p]));
    if (missing.length) return `I am missing the **${missing.join(', ')}** permission.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Argument resolution
// ---------------------------------------------------------------------------
const ID = (s, re) => { const m = String(s || '').match(re); return m ? m[1] : null; };
const USER_RE = /^<@!?(\d{15,25})>$|^(\d{15,25})$/;
const userIdFrom = (s) => { const m = String(s || '').match(USER_RE); return m ? (m[1] || m[2]) : null; };

/**
 * Author of the message this command replies to (cached per invocation).
 * Used ONLY when no explicit user/member argument was given — explicit targets always win.
 */
async function replyAuthor(ctx) {
  const { message } = ctx;
  if (!message || !message.reference || !message.reference.messageId) return null;
  if (ctx._replyAuthor !== undefined) return ctx._replyAuthor;
  const ref = await message.fetchReference().catch(() => null);
  ctx._replyAuthor = ref && ref.author && !ref.author.system ? ref.author : null;
  return ctx._replyAuthor;
}

async function resolvePrefixArgs(ctx, tokens, rest) {
  const { guild, message } = ctx;
  const args = {};
  let i = 0;
  let restStr = rest;
  const consume = () => { const t = tokens[i++]; restStr = restStr.slice(restStr.indexOf(t) + t.length).trim(); return t; };

  for (const o of ctx.def.options) {
    const tok = tokens[i];
    let val = null;
    switch (o.type) {
      case 'member': case 'user': {
        // Target priority: 1) explicit mention/ID  2) replied-to message author  3) none → error
        const id = tok !== undefined ? userIdFrom(tok) : null;
        if (id) {
          consume();
          val = o.type === 'member' ? await guild.members.fetch(id).catch(() => null) : await ctx.client.users.fetch(id).catch(() => null);
          if (!val) return { error: `Could not find that ${o.type === 'member' ? 'member in this server' : 'user'}.` };
        } else if (o.reply !== false) {
          const author = await replyAuthor(ctx);
          if (author) {
            val = o.type === 'member' ? await guild.members.fetch(author.id).catch(() => null) : author;
            if (!val) return { error: 'The author of that message is no longer a member of this server.' };
            ctx.fromReply = true;
          }
        }
        break;
      }
      case 'rolename': {
        if (tok === undefined) break;
        // Try the whole remaining text first (role names may contain spaces), then a single token.
        const whole = restStr.trim();
        let role = whole ? roleNames.resolveRole(guild, whole) : null;
        if (role) { i = tokens.length; restStr = ''; val = role; break; }
        role = roleNames.resolveRole(guild, tok);
        if (role) { consume(); val = role; break; }
        if (roleNames.isDeletedRoleName(guild, tok) || roleNames.isDeletedRoleName(guild, whole)) {
          return { error: `The custom role name **${tok}** points to a Discord role that no longer exists. Update it in the dashboard (Commands → Role).` };
        }
        return { error: `I could not find a role called **${tok}**. Use the role name, a mention, its ID, or a custom role name configured in the dashboard.` };
      }
      case 'snowflake': { const id = tok !== undefined ? userIdFrom(tok) : null; if (id) { consume(); val = id; } break; }
      case 'integer': { if (tok !== undefined && /^-?\d+$/.test(tok)) { const n = Number(consume()); val = n; if ((o.min !== undefined && n < o.min) || (o.max !== undefined && n > o.max)) return { error: `**${o.name}** must be between ${o.min} and ${o.max}.` }; } break; }
      case 'duration': { if (tok !== undefined && isDurationToken(tok)) val = consume(); break; }
      case 'channel': { const id = ID(tok, /^<#(\d+)>$|^(\d{15,25})$/) || (tok && (tok.match(/^(\d{15,25})$/) || [])[1]); const ch = id ? guild.channels.cache.get(id) : null; if (ch) { consume(); val = ch; } break; }
      case 'role': {
        if (tok === undefined) break;
        const id = (tok.match(/^<@&(\d+)>$/) || tok.match(/^(\d{15,25})$/) || [])[1];
        let role = id ? guild.roles.cache.get(id) : null;
        if (!role && o.byName !== false) role = guild.roles.cache.find((r) => r.name.toLowerCase() === tok.toLowerCase());
        if (role) { consume(); val = role; }
        break;
      }
      case 'choice': {
        if (tok === undefined) break;
        const k = normalizeToken(tok);
        const c = o.choices.find((ch) => normalizeToken(ch.value) === k || (ch.aliases || []).some((a) => normalizeToken(a) === k));
        if (c) { consume(); val = c.value; }
        break;
      }
      case 'string': { if (tok !== undefined) val = consume(); break; }
      case 'rest': { if (restStr) { val = restStr; i = tokens.length; restStr = ''; } break; }
      default: break;
    }
    if ((val === null || val === undefined) && o.required) {
      const hint = (o.type === 'member' || o.type === 'user')
        ? `\nMention a member, use their ID, or **reply to their message** and type \`${configService.getPrefix(guild.id)}${ctx.trigger}\`.`
        : '';
      return { error: `Missing or invalid **${o.name}**.\nUsage: \`${usage(ctx)}\`${hint}` };
    }
    if (val !== null && val !== undefined) args[o.name] = val;
  }
  return { args };
}

function resolveSlashArgs(ctx) {
  const opt = ctx.interaction.options;
  const args = {};
  for (const o of ctx.def.options) {
    let v = null;
    switch (o.type) {
      case 'member': v = opt.getMember(o.name); if (!v && opt.getUser(o.name) && o.required) return { error: 'That user is not a member of this server.' }; break;
      case 'user': v = opt.getUser(o.name); break;
      case 'integer': v = opt.getInteger(o.name); break;
      case 'channel': v = opt.getChannel(o.name); if (v) v = ctx.guild.channels.cache.get(v.id) || v; break;
      case 'role': v = opt.getRole(o.name); break;
      case 'snowflake': { const s = opt.getString(o.name); v = s ? userIdFrom(s) : null; if (s && !v) return { error: `**${o.name}** must be a user ID or mention.` }; break; }
      case 'duration': { const s = opt.getString(o.name); if (s && !isDurationToken(s)) return { error: `Invalid duration "${s}". Use e.g. 10m, 1h, 7d or permanent.` }; v = s; break; }
      case 'rolename': {
        const s = opt.getString(o.name);
        if (!s) break;
        v = roleNames.resolveRole(ctx.guild, s);
        if (!v) {
          if (roleNames.isDeletedRoleName(ctx.guild, s)) return { error: `The custom role name **${s}** points to a Discord role that no longer exists. Update it in the dashboard (Commands → Role).` };
          return { error: `I could not find a role called **${s}**. Pick one from the suggestions, or add a custom role name in the dashboard.` };
        }
        break;
      }
      default: v = opt.getString(o.name); break;
    }
    if (v !== null && v !== undefined) args[o.name] = v;
  }
  return { args };
}

function usage(ctx) {
  const prefix = configService.getPrefix(ctx.guild.id);
  const parts = ctx.def.options.map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`));
  return `${prefix}${ctx.trigger || ctx.def.name} ${parts.join(' ')}`.trim();
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------
async function runCommand(ctx) {
  const denied = checkAccess(ctx);
  if (denied) { await ctx.error(denied); return; }
  try {
    await ctx.def.execute(ctx);
  } catch (err) {
    logger.error('Commands', `/${ctx.def.name} failed:`, err);
    await ctx.error(`Something went wrong: ${err.message || 'unknown error'}`);
  }
}

async function handleMessage(message) {
  if (!message.guild || message.author.bot || message.webhookId || !message.content) return false;
  const guildId = message.guild.id;
  const prefix = configService.getPrefix(guildId); // may be "" — that is valid
  const parsed = parseMessage(message.content, prefix, getTriggerMap(guildId));
  if (!parsed) return false; // ordinary chat message (e.g. "hello everyone") → ignored

  const def = registry.get(parsed.commandName);
  if (!def) return false;
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  const ctx = new CommandContext({
    source: 'prefix', client: message.client, guild: message.guild, channel: message.channel,
    member, user: message.author, message, def, cfg: getCommandConfig(guildId, def), trigger: parsed.trigger,
  });

  const denied = checkAccess(ctx);
  if (denied) { await ctx.error(denied); return true; }
  const res = await resolvePrefixArgs(ctx, parsed.args, parsed.rest);
  if (res.error) { await ctx.error(res.error); return true; }
  ctx.args = res.args;
  if (ctx.cfg.deleteTrigger) message.delete().catch(() => {});
  try { await def.execute(ctx); } catch (err) {
    logger.error('Commands', `${parsed.trigger} failed:`, err);
    await ctx.error(`Something went wrong: ${err.message || 'unknown error'}`);
  }
  return true;
}

async function handleSlash(interaction) {
  const def = registry.get(interaction.commandName);
  if (!def) return;
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'Dziri System commands only work inside servers.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  const member = interaction.member && interaction.member.permissions && typeof interaction.member.permissions.has === 'function'
    ? interaction.member : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const ctx = new CommandContext({
    source: 'slash', client: interaction.client, guild: interaction.guild, channel: interaction.channel,
    member, user: interaction.user, interaction, def, cfg: getCommandConfig(interaction.guild.id, def), trigger: def.name,
  });
  const res = resolveSlashArgs(ctx);
  if (res.error) { await ctx.error(res.error); return; }
  ctx.args = res.args;
  await runCommand(ctx);
}

/** Autocomplete for "rolename" options: real guild roles + their custom Dziri System names. */
async function handleAutocomplete(interaction) {
  try {
    const def = registry.get(interaction.commandName);
    if (!def || !interaction.guild) return interaction.respond([]).catch(() => {});
    const focused = interaction.options.getFocused(true);
    const opt = def.options.find((o) => o.name === focused.name);
    if (!opt || opt.type !== 'rolename') return interaction.respond([]).catch(() => {});
    return interaction.respond(roleNames.autocompleteChoices(interaction.guild, focused.value)).catch(() => {});
  } catch (err) {
    logger.warn('Commands', 'Autocomplete failed:', err.message);
    return interaction.respond([]).catch(() => {});
  }
}

module.exports = {
  loadCommands, getCommand, allCommands, getCommandConfig, validateCommandConfig, getTriggerMap,
  slashDefinitions, handleMessage, handleSlash, handleAutocomplete, checkAccess, CommandContext,
};
