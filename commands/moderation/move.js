'use strict';
const { PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'move',
  label: 'Move',
  category: 'moderation',
  description: 'Move another member into the voice channel you are currently in.',
  defaultAliases: ['نقل'],
  userPermissions: ['MoveMembers'],
  botPermissions: ['MoveMembers'],
  options: [
    { name: 'user', type: 'member', required: true, description: 'Member to move (or reply to their message)' },
  ],
  async execute(ctx) {
    const target = ctx.args.user;
    const destination = ctx.member && ctx.member.voice ? ctx.member.voice.channel : null;
    if (!destination) return ctx.error('You must be in a voice channel first.');
    if (target.id === ctx.member.id) return ctx.error('Use **moveme** when you want to move yourself to another member.');
    if (!target.voice || !target.voice.channel) return ctx.error('The target user is not in a voice channel.');
    if (target.voice.channelId === destination.id) return ctx.error(`**${target.user.tag}** is already in **${destination.name}**.`);

    const me = ctx.guild.members.me;
    const source = target.voice.channel;
    if (!me || !me.permissionsIn(destination).has(PermissionFlagsBits.MoveMembers) || !me.permissionsIn(source).has(PermissionFlagsBits.MoveMembers)) {
      return ctx.error('I need **Move Members** permission in both voice channels.');
    }
    try {
      await target.voice.setChannel(destination, `${ctx.user.tag} used move`);
    } catch (err) {
      return ctx.error(`I could not move **${target.user.tag}**: ${err.message}`);
    }
    return ctx.success(`Moved **${target.user.tag}** to **${destination.name}**.`);
  },
};
