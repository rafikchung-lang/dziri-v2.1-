'use strict';
/** Deleted / edited message logs (registered as two events by index.js via the `events` array). */
const { Events } = require('discord.js');
const loggingService = require('../services/loggingService');

module.exports = {
  events: [
    {
      name: Events.MessageDelete,
      async execute(client, message) {
        if (!message.guild || (message.author && message.author.bot)) return;
        await loggingService.log(message.guild, 'messageDelete', {
          title: '🗑️ Message deleted',
          user: message.author || undefined,
          channelId: message.channelId,
          fields: [
            { name: 'Author', value: message.author ? `<@${message.author.id}>` : 'Unknown (not cached)' },
            { name: 'Channel', value: `<#${message.channelId}>` },
            { name: 'Content', value: message.content ? message.content.slice(0, 1000) : (message.partial ? '*Not cached*' : '*No text content*'), inline: false },
            ...(message.attachments && message.attachments.size ? [{ name: 'Attachments', value: [...message.attachments.values()].map((a) => a.name).join(', ').slice(0, 1000), inline: false }] : []),
          ],
        });
      },
    },
    {
      name: Events.MessageUpdate,
      async execute(client, oldMsg, newMsg) {
        if (!newMsg.guild || (newMsg.author && newMsg.author.bot)) return;
        if (oldMsg.content === newMsg.content) return; // embed resolution etc.
        await loggingService.log(newMsg.guild, 'messageEdit', {
          title: '✏️ Message edited',
          user: newMsg.author || undefined,
          channelId: newMsg.channelId,
          description: `[Jump to message](${newMsg.url})`,
          fields: [
            { name: 'Author', value: newMsg.author ? `<@${newMsg.author.id}>` : 'Unknown' },
            { name: 'Channel', value: `<#${newMsg.channelId}>` },
            { name: 'Before', value: oldMsg.content ? oldMsg.content.slice(0, 1000) : '*Not cached*', inline: false },
            { name: 'After', value: newMsg.content ? newMsg.content.slice(0, 1000) : '*Empty*', inline: false },
          ],
        });
      },
    },
  ],
};
