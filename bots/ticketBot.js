'use strict';
/**
 * Second Discord bot — its own application, token and client.
 *
 * It handles EVERY component interaction that belongs to a panel it sent: ticket panels and,
 * when selected as the sender, temporary room control panels. Discord delivers component
 * interactions only to the application that owns the message, so "the bot that sends the panel
 * handles the panel" is guaranteed by registering both handlers on both clients.
 *
 * Intents: Guilds (channels/roles) + GuildVoiceStates (needed to resolve a member's voice
 * channel for temporary room controls). Neither is privileged.
 */
const { Client, GatewayIntentBits, Options, ActivityType, Events } = require('discord.js');
const ticketService = require('../services/ticketService');
const tempRoomService = require('../services/tempRoomService');
const botRegistry = require('../services/botRegistry');
const logger = require('../utils/logger');

let client = null;

function getClient() { return client; }

function start() {
  const token = process.env.TICKET_DISCORD_TOKEN;
  if (!token) {
    logger.warn('Tickets', 'TICKET_DISCORD_TOKEN is not set — the Ticket Bot is disabled. The main bot and dashboard keep running, and panels can still be sent by Dziri System.');
    return null;
  }
  if (process.env.DISCORD_TOKEN && token === process.env.DISCORD_TOKEN) {
    logger.warn('Tickets', 'TICKET_DISCORD_TOKEN is identical to the main bot token. Use a SECOND Discord application for the ticket bot, otherwise both clients share one identity.');
  }
  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0, PresenceManager: 0, ReactionManager: 0, GuildMemberManager: 100,
    }),
  });
  botRegistry.register('ticket', client);

  client.once(Events.ClientReady, async () => {
    logger.info('Tickets', `Ticket Bot connected as ${client.user.tag} — ${client.guilds.cache.size} guild(s).`);
    client.user.setPresence({ activities: [{ name: 'tickets', type: ActivityType.Listening }], status: 'online' });
    try { ticketService.reconcile(client); } catch (err) { logger.warn('Tickets', 'Reconcile failed:', err.message); }
  });

  // This client handles the panels IT sent — both systems.
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (await ticketService.handleInteraction(interaction)) return;
      await tempRoomService.handleInteraction(interaction);
    } catch (err) {
      logger.error('Tickets', 'Interaction error:', err);
    }
  });

  client.on(Events.ChannelDelete, (channel) => {
    try { if (channel.guild) ticketService.reconcile(client); } catch { /* ignore */ }
  });
  client.on('error', (err) => logger.error('Tickets', err));

  logger.info('Tickets', 'Connecting Ticket Bot to Discord...');
  client.login(token).catch((err) => {
    logger.error('Tickets', `Ticket Bot login failed: ${err.message}`);
    botRegistry.register('ticket', null);
    client = null;
  });
  return client;
}

function destroy() { return client ? client.destroy() : Promise.resolve(); }

module.exports = { start, getClient, destroy };
