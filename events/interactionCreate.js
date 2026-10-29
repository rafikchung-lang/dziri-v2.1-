'use strict';
const { Events } = require('discord.js');
const commandService = require('../services/commandService');
const tempRoomService = require('../services/tempRoomService');
const ticketService = require('../services/ticketService');
const logger = require('../utils/logger');

module.exports = {
  name: Events.InteractionCreate,
  async execute(client, interaction) {
    try {
      if (interaction.isAutocomplete()) { await commandService.handleAutocomplete(interaction); return; }
      if (interaction.isChatInputCommand()) { await commandService.handleSlash(interaction); return; }

      // Panels sent BY THIS BOT deliver their component interactions here — both systems are
      // registered so a panel always has a live handler, whichever bot published it.
      if (await ticketService.handleInteraction(interaction)) return;
      if (await tempRoomService.handleInteraction(interaction)) return;

      // Anything else (reason menus, leaderboard paging) is handled by per-message collectors.
    } catch (err) {
      logger.error('Events', 'interactionCreate failed:', err);
      try {
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Something went wrong handling that interaction.', ephemeral: true });
        }
      } catch { /* ignore */ }
    }
  },
};
