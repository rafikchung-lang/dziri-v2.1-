'use strict';
/** Joins, leaves (incl. external kicks), nickname & role changes, external bans/unbans. */
const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const loggingService = require('../services/loggingService');
const historyService = require('../services/historyService');
const moderationService = require('../services/moderationService');
const autoRoleService = require('../services/autoRoleService');

async function auditEntry(guild, type, targetId, maxAgeMs = 8000) {
  const me = guild.members.me;
  if (!me || !me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
  const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
  if (!logs) return null;
  return logs.entries.find((e) => (!targetId || (e.target && e.target.id === targetId)) && Date.now() - e.createdTimestamp < maxAgeMs) || null;
}

module.exports = {
  auditEntry,
  events: [
    {
      name: Events.GuildMemberAdd,
      async execute(client, member) {
        await loggingService.log(member.guild, 'memberJoin', {
          title: '📥 Member joined', user: member.user,
          fields: [
            { name: 'Member', value: `<@${member.id}> (${member.user.tag})` },
            { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
            { name: 'Member count', value: String(member.guild.memberCount) },
          ],
        });
        await autoRoleService.onMemberJoin(member);
      },
    },
    {
      name: Events.GuildMemberRemove,
      async execute(client, member) {
        const guild = member.guild;
        const kick = await auditEntry(guild, AuditLogEvent.MemberKick, member.id);
        if (kick && kick.executor && kick.executor.id !== client.user.id) {
          historyService.add(guild.id, { type: 'kick', targetId: member.id, targetTag: member.user ? member.user.tag : '', moderatorId: kick.executor.id, moderatorTag: kick.executor.tag, reason: kick.reason || 'No reason provided', source: 'external' });
          await loggingService.log(guild, 'kick', {
            title: '👢 Member kicked', user: member.user,
            fields: [{ name: 'Member', value: `<@${member.id}>` }, { name: 'Moderator', value: `<@${kick.executor.id}>` }, { name: 'Reason', value: kick.reason || '—', inline: false }],
          });
        }
        await loggingService.log(guild, 'memberLeave', {
          title: '📤 Member left', user: member.user || undefined,
          fields: [
            { name: 'Member', value: `<@${member.id}>${member.user ? ` (${member.user.tag})` : ''}` },
            ...(member.joinedTimestamp ? [{ name: 'Joined', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` }] : []),
            { name: 'Roles', value: member.roles ? (member.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.name).join(', ') || 'None').slice(0, 1000) : '—', inline: false },
          ],
        });
      },
    },
    {
      name: Events.GuildMemberUpdate,
      async execute(client, oldM, newM) {
        const guild = newM.guild;
        if (oldM.partial) return;
        if (oldM.nickname !== newM.nickname) {
          historyService.add(guild.id, { type: 'nickname', targetId: newM.id, targetTag: newM.user.tag, reason: `${oldM.nickname || oldM.user.username} → ${newM.nickname || newM.user.username}` });
          await loggingService.log(guild, 'nicknameChange', {
            title: '🏷️ Nickname changed', user: newM.user,
            fields: [{ name: 'Member', value: `<@${newM.id}>` }, { name: 'Before', value: oldM.nickname || '*None*' }, { name: 'After', value: newM.nickname || '*None*' }],
          });
        }
        const added = newM.roles.cache.filter((r) => !oldM.roles.cache.has(r.id));
        const removed = oldM.roles.cache.filter((r) => !newM.roles.cache.has(r.id));
        if (added.size || removed.size) {
          const entry = await auditEntry(guild, AuditLogEvent.MemberRoleUpdate, newM.id);
          const byBot = entry && entry.executor && entry.executor.id === client.user.id;
          if (!byBot) {
            for (const r of added.values()) historyService.add(guild.id, { type: 'roleadd', targetId: newM.id, targetTag: newM.user.tag, moderatorId: entry && entry.executor ? entry.executor.id : '', moderatorTag: entry && entry.executor ? entry.executor.tag : '', reason: `Role: ${r.name}`, source: 'external' });
            for (const r of removed.values()) historyService.add(guild.id, { type: 'roleremove', targetId: newM.id, targetTag: newM.user.tag, moderatorId: entry && entry.executor ? entry.executor.id : '', moderatorTag: entry && entry.executor ? entry.executor.tag : '', reason: `Role: ${r.name}`, source: 'external' });
          }
          await loggingService.log(guild, 'roleChange', {
            title: '🎭 Roles updated', user: newM.user,
            fields: [
              { name: 'Member', value: `<@${newM.id}>` },
              ...(entry && entry.executor ? [{ name: 'By', value: `<@${entry.executor.id}>` }] : []),
              ...(added.size ? [{ name: 'Added', value: added.map((r) => `<@&${r.id}>`).join(' '), inline: false }] : []),
              ...(removed.size ? [{ name: 'Removed', value: removed.map((r) => `<@&${r.id}>`).join(' '), inline: false }] : []),
            ],
          });
        }
        // external timeouts (applied outside the bot)
        const was = oldM.communicationDisabledUntilTimestamp || 0;
        const now = newM.communicationDisabledUntilTimestamp || 0;
        if (now > Date.now() && now !== was) {
          const entry = await auditEntry(guild, AuditLogEvent.MemberUpdate, newM.id);
          if (entry && entry.executor && entry.executor.id !== client.user.id) {
            historyService.add(guild.id, { type: 'textmute', targetId: newM.id, targetTag: newM.user.tag, moderatorId: entry.executor.id, moderatorTag: entry.executor.tag, reason: entry.reason || 'Timeout (applied manually)', duration: moderationService.formatDuration(now - Date.now()), source: 'external' });
            await loggingService.log(guild, 'moderation', { title: '🔇 Member timed out', user: newM.user, fields: [{ name: 'Member', value: `<@${newM.id}>` }, { name: 'Moderator', value: `<@${entry.executor.id}>` }, { name: 'Until', value: `<t:${Math.floor(now / 1000)}:F>` }] });
          }
        }
      },
    },
    {
      name: Events.GuildBanAdd,
      async execute(client, ban) {
        const entry = await auditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
        if (entry && entry.executor && entry.executor.id === client.user.id) return; // already recorded by the command
        historyService.add(ban.guild.id, { type: 'ban', targetId: ban.user.id, targetTag: ban.user.tag, moderatorId: entry && entry.executor ? entry.executor.id : '', moderatorTag: entry && entry.executor ? entry.executor.tag : '', reason: (entry && entry.reason) || ban.reason || 'No reason provided', source: 'external' });
        await loggingService.log(ban.guild, 'ban', { title: '🔨 Member banned', user: ban.user, fields: [{ name: 'User', value: `<@${ban.user.id}> (${ban.user.tag})` }, ...(entry && entry.executor ? [{ name: 'Moderator', value: `<@${entry.executor.id}>` }] : []), { name: 'Reason', value: (entry && entry.reason) || '—', inline: false }] });
      },
    },
    {
      name: Events.GuildBanRemove,
      async execute(client, ban) {
        const entry = await auditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
        if (entry && entry.executor && entry.executor.id === client.user.id) return;
        historyService.add(ban.guild.id, { type: 'unban', targetId: ban.user.id, targetTag: ban.user.tag, moderatorId: entry && entry.executor ? entry.executor.id : '', moderatorTag: entry && entry.executor ? entry.executor.tag : '', reason: (entry && entry.reason) || 'No reason provided', source: 'external' });
        await loggingService.log(ban.guild, 'unban', { title: '♻️ Member unbanned', user: ban.user, fields: [{ name: 'User', value: `<@${ban.user.id}> (${ban.user.tag})` }, ...(entry && entry.executor ? [{ name: 'Moderator', value: `<@${entry.executor.id}>` }] : [])] });
      },
    },
  ],
};
