'use strict';
const embeds = require('../../utils/embeds');
const crimeService = require('../../services/crimeService');

module.exports = {
  name: 'currentcrime',
  label: 'Current Crime',
  category: 'utility',
  description: 'Show a user’s currently active punishment, remaining time and moderator.',
  defaultAliases: ['activecrime', 'العقوبةالحالية'],
  userPermissions: ['ModerateMembers'],
  options: [
    { name: 'user', type: 'user', required: true, description: 'User whose active punishment to inspect' },
  ],
  async execute(ctx) {
    const user = ctx.args.user;
    await ctx.defer();
    const active = await crimeService.activePunishments(ctx.guild, user.id);
    if (!active.length) return ctx.success(`No active punishment for **${user.tag}**.`);

    // Most recently started active punishment is the current one. If a member is subject to
    // multiple simultaneous punishments, report the others in the same message.
    const current = active[0];
    const fields = [
      { name: 'Current punishment', value: current.label, inline: true },
      { name: 'Status', value: 'Active', inline: true },
      { name: 'Reason', value: current.reason || '—', inline: false },
      { name: 'Started', value: `<t:${Math.floor(current.startAt / 1000)}:F>`, inline: true },
      { name: 'Remaining', value: crimeService.remainingText(current), inline: true },
      { name: 'Ends', value: current.endAt ? `<t:${Math.floor(current.endAt / 1000)}:F> (<t:${Math.floor(current.endAt / 1000)}:R>)` : 'Permanent / manually removed', inline: false },
      { name: 'Moderator', value: current.moderatorId ? `<@${current.moderatorId}>` : (current.moderatorTag || '—'), inline: true },
    ];
    if (active.length > 1) fields.push({ name: 'Other active punishments', value: active.slice(1).map((a) => `${a.label} — ${crimeService.remainingText(a)}`).join('\n'), inline: false });
    const e = embeds.base(embeds.COLORS.warn)
      .setTitle(`Current Crime — ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ size: 128 }))
      .addFields(fields);
    return ctx.respond({ embeds: [e] });
  },
};
