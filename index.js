'use strict';
/**
 * Dziri System — entry point.  Start with:  node index.js
 *
 * Initialisation order is strictly linear (no circular imports):
 *   env → storage → commands registry → client → events → dashboard → Discord login
 */
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const logger = require('./utils/logger');

logger.raw('====================================');
logger.raw('            DZIRI SYSTEM');
logger.raw('====================================\n');
logger.info('Startup', `Node.js version: ${process.version}`);

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) logger.warn('Startup', 'Node.js 20 or newer is required.');

logger.info('Startup', 'Loading configuration...');
logger.info('Startup', 'Initializing storage...');
const store = require('./database/store');
store.init();

logger.info('Startup', 'Loading commands...');
const commandService = require('./services/commandService');
const count = commandService.loadCommands();
logger.info('Commands', `Loaded ${count} command(s).`);

const { Client, GatewayIntentBits, Partials, Options } = require('discord.js');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User],
  // Keep memory low on the Wispbyte free plan
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 120,
    PresenceManager: 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    GuildStickerManager: 0,
    GuildScheduledEventManager: 0,
    StageInstanceManager: 0,
    ThreadMemberManager: 0,
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 900, lifetime: 3600 },
    users: { interval: 3600, filter: () => (u) => u.bot && u.id !== client.user?.id },
  },
});

// Register the main client before any service touches the registry.
require('./services/botRegistry').register('main', client);

logger.info('Startup', 'Loading events...');
const eventsDir = path.join(__dirname, 'events');
let evCount = 0;
for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
  const mod = require(path.join(eventsDir, file));
  const list = Array.isArray(mod.events) ? mod.events : (mod.name ? [mod] : []);
  for (const ev of list) {
    const handler = (...args) => Promise.resolve(ev.execute(client, ...args)).catch((err) => logger.error('Events', `${ev.name} failed:`, err));
    if (ev.once) client.once(ev.name, handler); else client.on(ev.name, handler);
    evCount++;
  }
}
logger.info('Events', `Registered ${evCount} event handler(s).`);

client.on('error', (err) => logger.error('Discord', err));
client.on('shardDisconnect', () => logger.warn('Discord', 'Disconnected — discord.js will reconnect automatically.'));

// Backwards compatible env names: MAIN_* is preferred, the original names still work.
process.env.DISCORD_TOKEN = process.env.MAIN_DISCORD_TOKEN || process.env.DISCORD_TOKEN || '';
process.env.CLIENT_ID = process.env.MAIN_CLIENT_ID || process.env.CLIENT_ID || '';

logger.info('Startup', 'Starting ticket bot...');
const ticketBot = require('./bots/ticketBot');
ticketBot.start();

logger.info('Startup', 'Starting dashboard...');
require('./dashboard/server').start(client, ticketBot);

process.on('unhandledRejection', (err) => logger.error('Process', 'Unhandled rejection:', err));
process.on('uncaughtException', (err) => logger.error('Process', 'Uncaught exception:', err));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logger.info('Process', `${sig} received — saving data...`);
    store.flushAll();
    Promise.allSettled([client.destroy(), ticketBot.destroy()]).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

if (!process.env.DISCORD_TOKEN) {
  logger.warn('Startup', 'DISCORD_TOKEN is not set — dashboard is running but the bot is offline. Add it to .env and restart.');
} else {
  logger.info('Startup', 'Connecting to Discord...');
  client.login(process.env.DISCORD_TOKEN).catch((err) => {
    logger.error('Discord', `Login failed: ${err.message}`);
    if (/disallowed intents/i.test(err.message)) logger.error('Discord', 'Enable "Server Members Intent" and "Message Content Intent" in the Discord developer portal.');
  });
}
