'use strict';
/**
 * Central registry of the two Discord clients.
 *
 *   main   → Dziri System (moderation, leveling, logs, temporary rooms)
 *   ticket → Ticket Bot (separate application + token)
 *
 * Panels record WHICH bot sent them; that same bot owns the message and therefore receives
 * its component interactions. Both clients register handlers for both systems, so a panel
 * always has a live handler no matter which bot sent it.
 */
const clients = { main: null, ticket: null };

function register(key, client) { if (key === 'main' || key === 'ticket') clients[key] = client; }
function get(key) { return clients[key] || null; }
function isReady(key) { const c = clients[key]; return Boolean(c && c.isReady()); }

/** Key of the client a given interaction/guild object belongs to. */
function keyOf(client) {
  if (!client) return null;
  if (clients.ticket && client === clients.ticket) return 'ticket';
  if (clients.main && client === clients.main) return 'main';
  return null;
}

const LABELS = { main: 'Dziri System', ticket: 'Ticket Bot' };

/**
 * Resolve the client that should send a panel.
 * Returns { key, client } or throws a clear, actionable error.
 */
function resolveSender(preferredKey, guildId) {
  const order = preferredKey === 'ticket' ? ['ticket', 'main'] : ['main', 'ticket'];
  const wanted = order[0];
  const c = clients[wanted];
  if (!c || !c.isReady()) {
    throw new Error(wanted === 'ticket'
      ? 'The Ticket Bot is not connected. Set TICKET_DISCORD_TOKEN in .env and restart, or choose "Dziri System" as the panel sender.'
      : 'The main Dziri System bot is not connected to Discord.');
  }
  if (guildId && !c.guilds.cache.has(guildId)) {
    throw new Error(`${LABELS[wanted]} is not in this server. Invite it first, or choose the other bot as the panel sender.`);
  }
  return { key: wanted, client: c };
}

/** Availability info for the dashboard (never exposes tokens). */
function availability(guildId) {
  const out = {};
  for (const key of ['main', 'ticket']) {
    const c = clients[key];
    const ready = Boolean(c && c.isReady());
    out[key] = {
      key,
      label: LABELS[key],
      configured: key === 'ticket' ? Boolean(process.env.TICKET_DISCORD_TOKEN) : Boolean(process.env.DISCORD_TOKEN || process.env.MAIN_DISCORD_TOKEN),
      ready,
      tag: ready ? c.user.tag : null,
      avatar: ready ? c.user.displayAvatarURL({ size: 64 }) : null,
      inGuild: Boolean(ready && guildId && c.guilds.cache.has(guildId)),
    };
  }
  return out;
}

module.exports = { register, get, isReady, keyOf, resolveSender, availability, LABELS };
