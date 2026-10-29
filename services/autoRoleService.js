'use strict';
/**
 * AutoRole — guild-specific join-role assignment.
 *
 * Configuration lives in the existing guild config JSON:
 *   autoRole: { enabled: boolean, roleIds: string[] }
 *
 * Role IDs are the permanent references. The Discord role is never renamed and role names
 * are never used for assignment. Missing/managed/above-bot roles are skipped safely.
 */
const { PermissionFlagsBits } = require('discord.js');
const configService = require('./configService');
const logger = require('../utils/logger');

/**
 * Inspect configured roles against live Discord data.
 * @returns {{valid:any[], missing:string[], unmanageable:any[], botMissingPermission:boolean}}
 */
function inspect(guild, roleIds) {
  const ids = Array.isArray(roleIds) ? [...new Set(roleIds.map(String))] : [];
  const me = guild && guild.members ? guild.members.me : null;
  const botMissingPermission = !me || !me.permissions.has(PermissionFlagsBits.ManageRoles);
  const valid = [];
  const missing = [];
  const unmanageable = [];

  for (const id of ids) {
    const role = guild.roles.cache.get(id);
    if (!role) { missing.push(id); continue; }
    const reason = role.id === guild.id
      ? '@everyone cannot be assigned.'
      : role.managed
        ? 'This role is managed by an integration.'
        : !me
          ? 'The bot member is unavailable.'
          : role.position >= me.roles.highest.position
            ? 'This role is above or equal to the bot’s highest role.'
            : botMissingPermission
              ? 'The bot is missing Manage Roles.'
              : '';
    if (reason) unmanageable.push({ id: role.id, name: role.name, reason });
    else valid.push(role);
  }
  return { valid, missing, unmanageable, botMissingPermission };
}

/** Assign every currently valid configured role to a newly joined member. */
async function onMemberJoin(member) {
  if (!member || !member.guild || (member.user && member.user.bot)) return { assigned: [], skipped: [] };
  const cfg = configService.getGuildConfig(member.guild.id).autoRole;
  if (!cfg || cfg.enabled !== true || !Array.isArray(cfg.roleIds) || !cfg.roleIds.length) return { assigned: [], skipped: [] };

  const checked = inspect(member.guild, cfg.roleIds);
  const assigned = [];
  const skipped = [
    ...checked.missing.map((id) => ({ id, reason: 'Role no longer exists.' })),
    ...checked.unmanageable,
  ];

  // Assign one by one: one deleted/hierarchy-changed role must not block all the others.
  for (const role of checked.valid) {
    if (member.roles.cache.has(role.id)) continue;
    try {
      await member.roles.add(role.id, 'Dziri System AutoRole: member joined');
      assigned.push({ id: role.id, name: role.name });
    } catch (err) {
      skipped.push({ id: role.id, name: role.name, reason: err.message || 'Discord rejected the assignment.' });
      logger.warn('AutoRole', `Could not add ${role.name} (${role.id}) to ${member.user.tag}:`, err.message);
    }
  }

  if (skipped.length) logger.warn('AutoRole', `${member.guild.name}: assigned ${assigned.length}, skipped ${skipped.length} role(s) for ${member.user.tag}.`);
  else if (assigned.length) logger.info('AutoRole', `${member.guild.name}: assigned ${assigned.map((r) => r.name).join(', ')} to ${member.user.tag}.`);
  return { assigned, skipped };
}

/** Dashboard-safe status; contains no secrets and never throws on deleted roles. */
function status(guild, roleIds) {
  const checked = inspect(guild, roleIds);
  return {
    botMissingPermission: checked.botMissingPermission,
    roles: (Array.isArray(roleIds) ? roleIds : []).map((id) => {
      const role = guild.roles.cache.get(id);
      const blocked = checked.unmanageable.find((r) => r.id === id);
      return {
        id,
        name: role ? role.name : null,
        missing: !role,
        manageable: Boolean(role && !blocked && !checked.botMissingPermission),
        warning: !role ? 'This configured role no longer exists.' : blocked ? blocked.reason : checked.botMissingPermission ? 'The bot is missing Manage Roles.' : '',
      };
    }),
  };
}

module.exports = { inspect, onMemberJoin, status };
