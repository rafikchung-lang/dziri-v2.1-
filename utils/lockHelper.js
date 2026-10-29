'use strict';
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const configService = require('../services/configService');
const historyService = require('../services/historyService');
const loggingService = require('../services/loggingService');
const mod = require('../services/moderationService');

/** Shared lock/unlock implementation. lock=true denies SendMessages/Connect, lock=false resets to neutral. */
async function setLock(ctx, lock) {
  const channel = ctx.args.channel || ctx.channel;
  if (!channel || !channel.permissionOverwrites) return ctx.error('That channel cannot be locked.');
  const cfgRoles = configService.getGuildConfig(ctx.guild.id).moderation.lockRoles || [];
  const roles = ctx.args.role ? [ctx.args.role] : (cfgRoles.length ? cfgRoles.map((id) => ctx.guild.roles.cache.get(id)).filter(Boolean) : [ctx.guild.roles.everyone]);
  const isVoice = channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;
  const reason = ctx.args.reason || 'No reason provided';
  const value = lock ? false : null;
  const perms = isVoice ? { Connect: value, Speak: value } : { SendMessages: value, SendMessagesInThreads: value, CreatePublicThreads: value, AddReactions: value };
  const me = ctx.guild.members.me;
  if (!me.permissionsIn(channel).has(PermissionFlagsBits.ManageChannels)) return ctx.error('I need **Manage Channels** in that channel.');
  for (const role of roles) {
    await channel.permissionOverwrites.edit(role, perms, { reason: `${ctx.user.tag}: ${reason}`.slice(0, 500) });
  }
  const type = lock ? 'lock' : 'unlock';
  historyService.add(ctx.guild.id, { type, targetId: channel.id, targetTag: `#${channel.name}`, moderatorId: ctx.user.id, moderatorTag: ctx.user.tag, reason, details: roles.map((r) => r.name).join(', ') });
  if (ctx.cfg.log) {
    await loggingService.log(ctx.guild, 'moderation', {
      title: mod.LABELS[type], user: ctx.user,
      fields: [{ name: 'Channel', value: `<#${channel.id}>` }, { name: 'Roles', value: roles.map((r) => (r.id === ctx.guild.id ? '@everyone' : `<@&${r.id}>`)).join(', ') }, { name: 'Reason', value: reason, inline: false }],
    });
  }
  return ctx.success(`${lock ? '🔒 Locked' : '🔓 Unlocked'} <#${channel.id}> for ${roles.map((r) => (r.id === ctx.guild.id ? '@everyone' : r.name)).join(', ')}.`, [{ name: 'Reason', value: reason }]);
}

module.exports = { setLock };
