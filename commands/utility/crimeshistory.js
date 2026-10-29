'use strict';
const crimeService = require('../../services/crimeService');
const { sendLongEmbeds } = require('../../utils/discordOutput');

module.exports = {
  name: 'crimeshistory',
  label: 'Crimes History',
  category: 'utility',
  description: 'Show the complete recorded punishment history of a user in as few Discord messages as possible.',
  defaultAliases: ['crimes', 'سجلالعقوبات'],
  userPermissions: ['ModerateMembers'],
  options: [
    { name: 'user', type: 'user', required: true, description: 'User whose punishment history to show' },
  ],
  async execute(ctx) {
    const user = ctx.args.user;
    await ctx.defer();
    const all = crimeService.allTargetRecords(ctx.guild.id, user.id);
    const crimes = all.filter((e) => crimeService.PUNISHMENT_TYPES.has(e.type));
    if (!crimes.length) return ctx.success(`No recorded punishments for **${user.tag}**.`);
    const active = await crimeService.activePunishments(ctx.guild, user.id);
    const text = crimes.map((record, i) => crimeService.formatRecord(record, i, all, active)).join('\n\n');
    return sendLongEmbeds(ctx, {
      title: `Crimes History — ${user.tag}`,
      text,
      thumbnail: user.displayAvatarURL({ size: 128 }),
      footer: `Dziri System • ${crimes.length} recorded punishment${crimes.length === 1 ? '' : 's'}`,
    });
  },
};
