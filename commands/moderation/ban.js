'use strict';
const mod = require('../../services/moderationService');

module.exports = {
  name: 'ban',
  label: 'Ban',
  category: 'moderation',
  description: 'Ban a user (permanently or temporarily) using a configured reason.',
  defaultAliases: ['حظر'],
  userPermissions: ['BanMembers'],
  botPermissions: ['BanMembers'],
  defaultDuration: 'permanent',
  reasons: {
    durations: true,
    defaults: [
      { label: 'Severe abuse', duration: 'permanent' },
      { label: 'Advertising', duration: '7d' },
      { label: 'Raiding', duration: 'permanent' },
    ],
  },
  options: [
    { name: 'user', type: 'user', required: true, description: 'User to ban (mention or ID)' },
    { name: 'duration', type: 'duration', description: 'Temporary ban duration (e.g. 7d) — empty = reason default' },
    { name: 'reason', type: 'rest', description: 'Reason (leave empty to pick from the menu)' },
  ],
  async execute(ctx) {
    const user = ctx.args.user;
    const member = await ctx.guild.members.fetch(user.id).catch(() => null);
    if (member) {
      const err = mod.hierarchyError(ctx.guild, ctx.member, member);
      if (err) return ctx.error(err);
      if (!member.bannable) return ctx.error('I cannot ban this member.');
    }
    const r = await mod.pickReason(ctx, { usesDuration: true, title: `Ban — ${user.tag}` });
    if (!r) return;
    // DM before the ban so the user can still receive it
    await mod.record(ctx.guild, { type: 'ban', target: user, moderator: ctx.member, reason: r.reason, duration: r.durationStr, logEvent: 'ban', cmdCfg: ctx.cfg });
    await ctx.guild.members.ban(user.id, { reason: `${ctx.user.tag}: ${r.reason}`.slice(0, 500) });
    if (r.durationMs > 0) mod.scheduleUnban(ctx.guild.id, user.id, Date.now() + r.durationMs);
    return ctx.success(`**${user.tag}** has been banned.`, [
      { name: 'Reason', value: r.reason, inline: true },
      { name: 'Duration', value: r.durationStr === 'permanent' ? 'Permanent' : r.durationStr, inline: true },
    ]);
  },
};
