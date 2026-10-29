'use strict';
const historyService = require('../../services/historyService');
const { sendLongEmbeds } = require('../../utils/discordOutput');
const mod = require('../../services/moderationService');

module.exports = {
  name: 'history',
  label: 'History',
  category: 'utility',
  description: 'Show a member’s complete recorded moderation, role and nickname history without artificial pagination.',
  defaultAliases: ['سجل'],
  userPermissions: ['ModerateMembers'],
  options: [
    { name: 'user', type: 'user', required: true, description: 'Member to inspect' },
  ],
  async execute(ctx) {
    const user = ctx.args.user;
    await ctx.defer();
    const items = historyService.query(ctx.guild.id, { page: 1, pageSize: 5000 }).items.filter((e) => e.targetId === user.id);
    if (!items.length) return ctx.success(`No history recorded for **${user.tag}**.`);
    const text = items.map((it, i) => {
      const moderator = it.moderatorId ? `<@${it.moderatorId}>` : (it.moderatorTag || '—');
      return [
        `**${i + 1}. ${mod.LABELS[it.type] || it.type}**`,
        `Date: <t:${Math.floor(it.at / 1000)}:F>`,
        `Moderator: ${moderator}`,
        it.reason ? `Reason: ${it.reason}` : '',
        it.duration ? `Duration: ${it.duration}` : '',
        it.details ? `Details: ${it.details}` : '',
      ].filter(Boolean).join('\n');
    }).join('\n\n');
    return sendLongEmbeds(ctx, {
      title: `Member History — ${user.tag}`,
      text,
      thumbnail: user.displayAvatarURL({ size: 128 }),
      footer: `Dziri System • ${items.length} entr${items.length === 1 ? 'y' : 'ies'}`,
    });
  },
};
