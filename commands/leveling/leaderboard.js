'use strict';
const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const levelingService = require('../../services/levelingService');
const { renderLeaderboard } = require('../../services/rankCardService');
const configService = require('../../services/configService');

async function build(ctx, type, page) {
  const lb = levelingService.leaderboard(ctx.guild.id, { type, page, pageSize: 10 });
  const rows = await Promise.all(lb.items.map(async (it) => {
    const m = ctx.guild.members.cache.get(it.userId) || await ctx.guild.members.fetch(it.userId).catch(() => null);
    const u = m ? m.user : await ctx.client.users.fetch(it.userId).catch(() => null);
    return {
      ...it,
      username: m ? m.displayName : u ? u.username : `Unknown (${it.userId})`,
      avatarUrl: u ? u.displayAvatarURL({ extension: 'png', size: 64, forceStatic: true }) : '',
      value: type === 'text' ? it.textXp : type === 'voice' ? it.voiceXp : it.totalXp,
    };
  }));
  const label = type === 'text' ? 'Text XP' : type === 'voice' ? 'Voice XP' : 'Total XP';
  const png = await renderLeaderboard(rows, { title: `${ctx.guild.name} Leaderboard`.slice(0, 40), subtitle: label, page: lb.page, pages: lb.pages, cfg: configService.getGuildConfig(ctx.guild.id).rankCard });
  const id = `dz-lb-${Date.now()}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${id}-prev`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(lb.page <= 1),
    new ButtonBuilder().setCustomId(`${id}-next`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(lb.page >= lb.pages),
  );
  return { payload: { content: '', embeds: [], files: [new AttachmentBuilder(png, { name: 'leaderboard.png' })], components: [row] }, page: lb.page, id };
}

module.exports = {
  name: 'leaderboard',
  label: 'Leaderboard',
  category: 'leveling',
  description: 'Show the server XP leaderboard (total, text or voice).',
  defaultAliases: ['lb', 'top', 'الترتيب'],
  options: [
    { name: 'type', type: 'choice', description: 'Which XP to rank by', choices: [
      { value: 'total', label: 'Total XP', aliases: ['all', 'الكل'] },
      { value: 'text', label: 'Text XP', aliases: ['chat', 'كتابي'] },
      { value: 'voice', label: 'Voice XP', aliases: ['vc', 'صوتي'] },
    ] },
    { name: 'page', type: 'integer', min: 1, max: 1000, description: 'Page number' },
  ],
  async execute(ctx) {
    const type = ctx.args.type || 'total';
    let page = ctx.args.page || 1;
    await ctx.defer();
    let built = await build(ctx, type, page);
    page = built.page;
    await ctx.respond(built.payload);
    const msg = ctx.source === 'slash' ? await ctx.interaction.fetchReply() : ctx.botMessage;
    if (!msg) return;
    const collector = msg.createMessageComponentCollector({ time: 120_000 });
    collector.on('collect', async (i) => {
      if (i.user.id !== ctx.user.id) { await i.reply({ content: 'Only the command author can change pages.', ephemeral: true }).catch(() => {}); return; }
      page += i.customId.endsWith('-next') ? 1 : -1;
      await i.deferUpdate().catch(() => {});
      built = await build(ctx, type, page);
      page = built.page;
      await i.editReply({ ...built.payload, attachments: [] }).catch(() => {});
    });
    collector.on('end', () => { msg.edit({ components: [] }).catch(() => {}); });
  },
};
