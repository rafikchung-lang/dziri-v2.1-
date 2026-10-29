'use strict';
const mod = require('../../services/moderationService');

module.exports = {
  name: 'kick',
  label: 'Kick',
  category: 'moderation',
  description: 'Kick a member using a configured reason.',
  defaultAliases: ['طرد'],
  userPermissions: ['KickMembers'],
  botPermissions: ['KickMembers'],
  reasons: {
    durations: false,
    defaults: [
      { label: 'Breaking server rules', duration: '' },
      { label: 'Inappropriate profile', duration: '' },
      { label: 'Alt account', duration: '' },
    ],
  },
  options: [
    { name: 'user', type: 'member', required: true, description: 'Member to kick' },
    { name: 'reason', type: 'rest', description: 'Reason (leave empty to pick from the menu)' },
  ],
  async execute(ctx) {
    const target = ctx.args.user;
    const err = mod.hierarchyError(ctx.guild, ctx.member, target);
    if (err) return ctx.error(err);
    if (!target.kickable) return ctx.error('I cannot kick this member.');
    const r = await mod.pickReason(ctx, { usesDuration: false, title: `Kick — ${target.user.tag}` });
    if (!r) return;
    await mod.record(ctx.guild, { type: 'kick', target, moderator: ctx.member, reason: r.reason, logEvent: 'kick', cmdCfg: ctx.cfg });
    await target.kick(`${ctx.user.tag}: ${r.reason}`.slice(0, 500));
    return ctx.success(`**${target.user.tag}** has been kicked.`, [{ name: 'Reason', value: r.reason }]);
  },
};
