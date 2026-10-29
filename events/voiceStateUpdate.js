'use strict';
const { Events, AuditLogEvent } = require('discord.js');
const loggingService = require('../services/loggingService');
const moderationService = require('../services/moderationService');
const tempRoomService = require('../services/tempRoomService');
const { auditEntry } = require('./memberLogs');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(client, oldS, newS) {
    const member = newS.member || oldS.member;
    if (!member || member.user.bot) return;
    // Temporary voice rooms: join-to-create + empty-room cleanup (never blocks the logs below).
    await tempRoomService.onVoiceUpdate(oldS, newS).catch(() => {});
    const guild = newS.guild;
    const user = member.user;

    if (!oldS.channelId && newS.channelId) {
      await moderationService.onVoiceJoin(member);
      await loggingService.log(guild, 'voiceJoinLeave', { title: '🔊 Joined voice', user, fields: [{ name: 'Member', value: `<@${member.id}>` }, { name: 'Channel', value: `<#${newS.channelId}>` }] });
      return;
    }
    if (oldS.channelId && !newS.channelId) {
      const dc = await auditEntry(guild, AuditLogEvent.MemberDisconnect, null, 5000);
      await loggingService.log(guild, 'voiceJoinLeave', {
        title: dc ? '⛔ Disconnected from voice' : '🔈 Left voice', user,
        fields: [{ name: 'Member', value: `<@${member.id}>` }, { name: 'Channel', value: `<#${oldS.channelId}>` }, ...(dc && dc.executor ? [{ name: 'Disconnected by', value: `<@${dc.executor.id}>` }] : [])],
      });
      return;
    }
    if (oldS.channelId !== newS.channelId) {
      const mv = await auditEntry(guild, AuditLogEvent.MemberMove, null, 5000);
      await loggingService.log(guild, 'voiceMove', {
        title: '🔀 Moved voice channel', user,
        fields: [{ name: 'Member', value: `<@${member.id}>` }, { name: 'From', value: `<#${oldS.channelId}>` }, { name: 'To', value: `<#${newS.channelId}>` }, ...(mv && mv.executor ? [{ name: 'Moved by', value: `<@${mv.executor.id}>` }] : [])],
      });
      return;
    }
    const changes = [];
    if (oldS.serverMute !== newS.serverMute) changes.push(`Server mute: **${newS.serverMute ? 'on' : 'off'}**`);
    if (oldS.serverDeaf !== newS.serverDeaf) changes.push(`Server deafen: **${newS.serverDeaf ? 'on' : 'off'}**`);
    if (oldS.selfMute !== newS.selfMute) changes.push(`Self mute: **${newS.selfMute ? 'on' : 'off'}**`);
    if (oldS.selfDeaf !== newS.selfDeaf) changes.push(`Self deafen: **${newS.selfDeaf ? 'on' : 'off'}**`);
    if (changes.length) {
      await loggingService.log(guild, 'voiceState', { title: '🎙️ Voice state changed', user, description: changes.join('\n'), fields: [{ name: 'Member', value: `<@${member.id}>` }, { name: 'Channel', value: newS.channelId ? `<#${newS.channelId}>` : '—' }] });
    }
  },
};
