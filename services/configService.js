'use strict';
/**
 * Guild configuration access. Guild-specific, persisted in data/guilds/<guildId>.json.
 *
 * IMPORTANT: merging uses `hasOwnProperty`, never truthiness, so an empty-string prefix ""
 * stays exactly "" and is never replaced by the default "!".
 */
const store = require('../database/store');
const { defaultGuildConfig } = require('../config/defaults');

const listeners = new Set();

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function deepMerge(base, override) {
  if (!isPlainObject(base)) return override === undefined ? base : override;
  const out = { ...base };
  if (!isPlainObject(override)) return out;
  for (const k of Object.keys(override)) {
    const bv = base[k];
    const ov = override[k];
    if (isPlainObject(bv) && isPlainObject(ov)) out[k] = deepMerge(bv, ov);
    else if (ov !== undefined) out[k] = ov;
  }
  return out;
}

function getRaw(guildId) {
  return store.read('guilds', guildId, () => ({}));
}

/** Full effective config (defaults + stored overrides). */
function getGuildConfig(guildId) {
  return deepMerge(defaultGuildConfig(), getRaw(guildId));
}

function getPrefix(guildId) {
  const raw = getRaw(guildId);
  if (Object.prototype.hasOwnProperty.call(raw, 'prefix') && typeof raw.prefix === 'string') return raw.prefix;
  return defaultGuildConfig().prefix;
}

/** Replace a top-level section and persist synchronously. Returns true when the file is on disk. */
function saveSection(guildId, section, value) {
  const raw = getRaw(guildId);
  raw[section] = value;
  store.write('guilds', guildId, raw);
  const ok = store.flushNow('guilds', guildId);
  emit(guildId, section);
  return ok;
}

function saveCommandConfig(guildId, commandName, value) {
  const raw = getRaw(guildId);
  raw.commands = isPlainObject(raw.commands) ? raw.commands : {};
  raw.commands[commandName] = value;
  store.write('guilds', guildId, raw);
  const ok = store.flushNow('guilds', guildId);
  emit(guildId, 'commands');
  return ok;
}

function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(guildId, section) { for (const fn of listeners) { try { fn(guildId, section); } catch { /* ignore */ } } }

module.exports = { getGuildConfig, getPrefix, saveSection, saveCommandConfig, getRaw, onChange, deepMerge };
