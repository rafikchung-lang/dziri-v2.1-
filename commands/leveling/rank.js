'use strict';
const { AttachmentBuilder } = require('discord.js');
const levelingService = require('../../services/levelingService');
const { renderRankCard } = require('../../services/rankCardService');
const configService = require('../../services/configService');

module.exports = {
  name: 'rank',
  label: 'Rank',
  category: 'leveling',
  description: 'Show the Dziri System rank card for you or another member.',
  defaultAliases: ['level', 'مستوى'],
  options: [{ name: 'user', type: 'member', description: 'Member to show (default: you)' }],
  async execute(ctx) {
    const member = ctx.args.user || ctx.member;
    if (member.user.bot) return ctx.error('Bots do not earn XP.');
    await ctx.defer();
    const s = levelingService.stats(ctx.guild.id, member.id);
    const cfg = configService.getGuildConfig(ctx.guild.id).rankCard;
    const png = await renderRankCard({
      username: member.displayName || member.user.username,
      tag: member.user.username,
      avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
      rank: s.rank, level: s.level, current: s.current, needed: s.needed,
      textXp: s.textXp, voiceXp: s.voiceXp, totalXp: s.totalXp,
    }, cfg);
    return ctx.respond({ content: '', embeds: [], files: [new AttachmentBuilder(png, { name: 'rank.png' })] });
  },
};
