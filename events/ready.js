'use strict';
const { Events, ActivityType } = require('discord.js');
const commandService = require('../services/commandService');
const moderationService = require('../services/moderationService');
const levelingService = require('../services/levelingService');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info('Discord', `Connected as ${client.user.tag} — ${client.guilds.cache.size} guild(s).`);
    client.user.setPresence({ activities: [{ name: 'Dziri System', type: ActivityType.Watching }], status: 'online' });
    try {
      const defs = commandService.slashDefinitions();
      const devGuild = process.env.DEV_GUILD_ID && client.guilds.cache.get(process.env.DEV_GUILD_ID);
      if (devGuild) { await devGuild.commands.set(defs); logger.info('Commands', `Registered ${defs.length} slash command(s) in ${devGuild.name}.`); }
      else { await client.application.commands.set(defs); logger.info('Commands', `Registered ${defs.length} global slash command(s).`); }
    } catch (err) { logger.error('Commands', 'Slash registration failed:', err.message); }
    moderationService.startScheduler(client);
    levelingService.startVoiceTracker(client);
    require('../services/loggingService').startRetention(client);
    try {
      const tempRoomService = require('../services/tempRoomService');
      require('../services/botRegistry').register('main', client);
      tempRoomService.setClient(client);
      await tempRoomService.reconcile(client); // clean up stale temp rooms, never duplicate them
      tempRoomService.startChatCleanup(client); // clear only tracked room chats according to retention
    } catch (err) { logger.warn('TempRooms', 'Reconcile failed:', err.message); }
    logger.info('Startup', 'Dziri System is ready.');
  },
};
