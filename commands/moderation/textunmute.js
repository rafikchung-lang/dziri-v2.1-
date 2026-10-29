'use strict';
const mod = require('../../services/moderationService');

module.exports = {
  name: 'textunmute',
  label: 'Text Unmute',
  category: 'moderation',
  description: 'Remove a text mute (timeout or mute role) from a member.',
  defaultAliases: ['unmute', 'فككتم'],
  userPermissions: ['ModerateMembers'],
  botPermissions: ['ModerateMembers'],
  options: [
    { name: 'user', type: 'member', required: true, description: 'Member to unmute' },
    { name: 'reason', type: 'rest', description: 'Reason' },
  ],
  async execute(ctx) {
    const target = ctx.args.user;
    const err = mod.hierarchyError(ctx.guild, ctx.member, target);
    if (err) return ctx.error(err);
    const reason = ctx.args.reason || 'No reason provided';
    const ok = await mod.textUnmute(ctx.guild, target, ctx.member, { reason, cmdCfg: ctx.cfg });
    if (!ok) return ctx.error(`**${target.user.tag}** is not text-muted.`);
    return ctx.success(`**${target.user.tag}** has been text-unmuted.`, [{ name: 'Reason', value: reason }]);
  },
};
