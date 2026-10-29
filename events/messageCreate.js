'use strict';
const { Events } = require('discord.js');
const commandService = require('../services/commandService');
const automodService = require('../services/automodService');
const levelingService = require('../services/levelingService');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(client, message) {
    try {
      if (!message.guild || message.author.bot || message.webhookId) return;
      if (await automodService.onMessage(message)) return; // message removed by AutoMod
      const wasCommand = await commandService.handleMessage(message);
      if (!wasCommand) await levelingService.onMessage(message);
    } catch (err) {
      logger.error('Events', 'messageCreate failed:', err);
    }
  },
};
