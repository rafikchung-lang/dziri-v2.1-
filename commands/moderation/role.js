'use strict';
const mod = require('../../services/moderationService');
const configService = require('../../services/configService');
const roleNames = require('../../utils/roleNames');

module.exports = {
  name: 'role',
  label: 'Role',
  category: 'moderation',
  description: 'Add or remove a role from a member (supports custom role names like "ods").',
  defaultAliases: ['رتبة'],
  userPermissions: ['ManageRoles'],
  botPermissions: ['ManageRoles'],
  options: [
    // Optional: when omitted the command toggles the role (add if missing, remove if present).
    { name: 'action', type: 'choice', description: 'add or remove (leave empty to toggle)', choices: [
      { value: 'add', label: 'Add', aliases: ['+', 'give', 'اضافة', 'إضافة', 'اعطاء'] },
      { value: 'remove', label: 'Remove', aliases: ['-', 'take', 'ازالة', 'إزالة', 'سحب'] },
    ] },
    { name: 'user', type: 'member', required: true, description: 'Target member (or reply to their message)' },
    // "rolename" accepts a real role (mention / ID / name) OR a custom Dziri System role name.
    { name: 'role', type: 'rolename', required: true, description: 'Role — name, mention, ID or custom name (e.g. ods)' },
  ],
  async execute(ctx) {
    const { user: target, role } = ctx.args;
    let action = ctx.args.action;
    if (role.managed || role.id === ctx.guild.id) return ctx.error('That role cannot be assigned manually.');
    const me = ctx.guild.members.me;
    if (role.position >= me.roles.highest.position) return ctx.error('That role is above or equal to my highest role.');
    if (ctx.member.id !== ctx.guild.ownerId && role.position >= ctx.member.roles.highest.position) return ctx.error('That role is above or equal to your highest role.');
    const prot = configService.getGuildConfig(ctx.guild.id).moderation.protectedRoles || [];
    if (prot.includes(role.id) && !ctx.member.permissions.has('Administrator')) return ctx.error('That role is protected.');

    const has = target.roles.cache.has(role.id);
    if (!action) action = has ? 'remove' : 'add'; // toggle when no action was given
    const reason = `${ctx.user.tag} via /role`;
    if (action === 'add') {
      if (has) return ctx.error(`**${target.user.tag}** already has **${role.name}**.`);
      await target.roles.add(role, reason);
    } else {
      if (!has) return ctx.error(`**${target.user.tag}** does not have **${role.name}**.`);
      await target.roles.remove(role, reason);
    }
    const custom = roleNames.namesFor(ctx.guild.id, role.id);
    await mod.record(ctx.guild, {
      type: action === 'add' ? 'roleadd' : 'roleremove', target, moderator: ctx.member, reason: `Role: ${role.name}`,
      logEvent: 'moderation', cmdCfg: ctx.cfg, dm: false, extra: [{ name: 'Role', value: `<@&${role.id}>` }],
    });
    return ctx.success(`${action === 'add' ? 'Added' : 'Removed'} **${role.name}** ${action === 'add' ? 'to' : 'from'} **${target.user.tag}**.`, [
      ...(custom.length ? [{ name: 'Custom names', value: custom.join(', ') }] : []),
      ...(ctx.fromReply ? [{ name: 'Target', value: 'Taken from the replied-to message' }] : []),
    ]);
  },
};
