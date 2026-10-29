'use strict';
const { PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'moveme',
  label: 'Move Me',
  category: 'utility',
  description: 'Move yourself into the voice channel of another member.',
  defaultAliases: ['انقلني'],
  userPermissions: [],
  botPermissions: ['MoveMembers'],
  options: [
    { name: 'user', type: 'member', required: true, description: 'Member whose voice channel you want to join' },
  ],
  async execute(ctx) {
    const target = ctx.args.user;
    if (!target.voice || !target.voice.channel) return ctx.error('The target user is not in a voice channel.');
    if (!ctx.member.voice || !ctx.member.voice.channel) return ctx.error('You must be in a voice channel first so I can move you.');
    const destination = target.voice.channel;
    if (ctx.member.voice.channelId === destination.id) return ctx.error(`You are already in **${destination.name}**.`);

    const me = ctx.guild.members.me;
    const source = ctx.member.voice.channel;
    if (!me || !me.permissionsIn(destination).has(PermissionFlagsBits.MoveMembers) || !me.permissionsIn(source).has(PermissionFlagsBits.MoveMembers)) {
      return ctx.error('I need **Move Members** permission in both voice channels.');
    }
    try {
      await ctx.member.voice.setChannel(destination, `${ctx.user.tag} used moveme`);
    } catch (err) {
      return ctx.error(`I could not move you: ${err.message}`);
    }
    return ctx.success(`Moved you to **${destination.name}** with **${target.user.tag}**.`);
  },
};
