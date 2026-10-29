'use strict';
/**
 * Pure (dependency-free) message-command parser.
 *
 * buildTriggerMap(commands, guildCommandConfig) -> Map<normalisedToken, commandName>
 * parseMessage(content, prefix, triggerMap)     -> { commandName, trigger, args, rest } | null
 *
 * Rules:
 *  - prefix may be ANY string including "" (empty).  "" is NOT converted to a default.
 *  - With a prefix, the message must start with it; the token right after the prefix
 *    (optionally separated by whitespace) must be a known trigger.
 *  - With an empty prefix, ONLY the first whitespace-separated token is checked, and the
 *    command runs ONLY on an exact trigger match.  "hello everyone" → null.
 *  - The canonical command name is always a trigger, aliases are added on top.
 */
const { normalizeToken } = require('./normalize');

function buildTriggerMap(commandNames, aliasesByCommand) {
  const map = new Map();
  // canonical names first – they always win
  for (const name of commandNames) map.set(normalizeToken(name), name);
  for (const name of commandNames) {
    const aliases = (aliasesByCommand && aliasesByCommand[name]) || [];
    for (const alias of aliases) {
      const key = normalizeToken(alias);
      if (!key || map.has(key)) continue; // never let an alias override another command
      map.set(key, name);
    }
  }
  return map;
}

function parseMessage(content, prefix, triggerMap) {
  if (typeof content !== 'string' || !content.trim()) return null;
  const pfx = typeof prefix === 'string' ? prefix : '';
  let body = content.normalize('NFC');

  if (pfx.length > 0) {
    const lead = body.replace(/^\s+/, '');
    if (!lead.toLocaleLowerCase('en-US').startsWith(pfx.normalize('NFC').toLocaleLowerCase('en-US'))) return null;
    body = lead.slice(pfx.length);
  }

  body = body.replace(/^\s+/, '');
  if (!body) return null;

  const firstWs = body.search(/\s/u);
  const trigger = firstWs === -1 ? body : body.slice(0, firstWs);
  const rest = firstWs === -1 ? '' : body.slice(firstWs).trim();
  const key = normalizeToken(trigger);
  if (!key) return null;

  const commandName = triggerMap.get(key);
  if (!commandName) return null;

  return { commandName, trigger, rest, args: rest ? rest.split(/\s+/u) : [] };
}

module.exports = { buildTriggerMap, parseMessage };
