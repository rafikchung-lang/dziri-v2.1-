'use strict';
const mod = require('../../services/moderationService');

module.exports = {
  name: 'unban',
  label: 'Unban',
  category: 'moderation',
  description: 'Unban a user by ID.',
  defaultAliases: ['فكحظر'],
  userPermissions: ['BanMembers'],
  botPermissions: ['BanMembers'],
  reasons: { durations: false, defaults: [{ label: 'Appeal accepted', duration: '' }, { label: 'Ban expired / mistake', duration: '' }] },
  options: [
    { name: 'user', type: 'snowflake', required: true, description: 'User ID to unban' },
    { name: 'reason', type: 'rest', description: 'Reason (leave empty to pick from the menu)' },
  ],
  async execute(ctx) {
    const id = ctx.args.user;
    const ban = await ctx.guild.bans.fetch(id).catch(() => null);
    if (!ban) return ctx.error('That user is not banned.');
    const r = await mod.pickReason(ctx, { usesDuration: false, title: `Unban — ${ban.user.tag}` });
    if (!r) return;
    await ctx.guild.members.unban(id, `${ctx.user.tag}: ${r.reason}`.slice(0, 500));
    mod.cancelUnban(ctx.guild.id, id);
    await mod.record(ctx.guild, { type: 'unban', target: ban.user, moderator: ctx.member, reason: r.reason, logEvent: 'unban', cmdCfg: ctx.cfg, dm: false });
    return ctx.success(`**${ban.user.tag}** has been unbanned.`, [{ name: 'Reason', value: r.reason }]);
  },
};
