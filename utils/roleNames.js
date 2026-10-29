'use strict';
/**
 * Custom names for individual Discord ROLES.
 *
 * This is a SEPARATE system from the command alias system (services/commandService.js).
 * It never renames the Discord role — the custom name only exists inside Dziri System and
 * is an extra way to refer to a role when using /role.
 *
 * Storage: guild config section "roleNames" = [{ roleId, names: [] }], role ID is the
 * permanent reference, so renaming the Discord role keeps the custom names working.
 */
const configService = require('../services/configService');
const { normalizeToken, cleanAlias, isValidAlias } = require('./normalize');

/** Raw stored entries (always an array of { roleId, names[] }). */
function getEntries(guildId) {
  const raw = configService.getGuildConfig(guildId).roleNames;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && /^\d{5,25}$/.test(String(e.roleId)))
    .map((e) => ({ roleId: String(e.roleId), names: Array.isArray(e.names) ? e.names.map(String) : [] }));
}

/** Map<normalisedCustomName, roleId> for this guild. */
function nameMap(guildId) {
  const map = new Map();
  for (const e of getEntries(guildId)) {
    for (const n of e.names) {
      const key = normalizeToken(n);
      if (key && !map.has(key)) map.set(key, e.roleId);
    }
  }
  return map;
}

/** Custom names configured for one role. */
function namesFor(guildId, roleId) {
  const e = getEntries(guildId).find((x) => x.roleId === String(roleId));
  return e ? [...e.names] : [];
}

/**
 * Resolve any user input to a real Discord role.
 * Order: role ID / mention → custom name → exact role name → unique partial role name.
 * Returns a Role or null. Never throws, never renames anything.
 */
function resolveRole(guild, input) {
  if (!guild || input === undefined || input === null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const id = (raw.match(/^<@&(\d{5,25})>$/) || raw.match(/^(\d{5,25})$/) || [])[1];
  if (id) {
    const byId = guild.roles.cache.get(id);
    if (byId) return byId;
  }
  const key = normalizeToken(raw);
  if (!key) return null;

  const customId = nameMap(guild.id).get(key);
  if (customId) {
    const role = guild.roles.cache.get(customId);
    if (role) return role; // the Discord role may have been renamed — the ID still resolves
    return null; // configured role was deleted → caller reports it gracefully
  }
  const exact = guild.roles.cache.find((r) => normalizeToken(r.name) === key);
  if (exact) return exact;
  const partial = guild.roles.cache.filter((r) => r.id !== guild.id && normalizeToken(r.name).includes(key));
  if (partial.size === 1) return partial.first();
  return null;
}

/** True when the custom name points at a role that no longer exists. */
function isDeletedRoleName(guild, input) {
  const key = normalizeToken(String(input || ''));
  const mapped = nameMap(guild.id).get(key);
  return Boolean(mapped) && !guild.roles.cache.has(mapped);
}

/** Autocomplete choices for the /role slash option: real roles + their custom names. */
function autocompleteChoices(guild, query) {
  const q = normalizeToken(query || '');
  const out = [];
  const seen = new Set();
  const push = (role, label) => {
    if (seen.has(label) || out.length >= 25) return;
    seen.add(label);
    out.push({ name: label.slice(0, 100), value: String(role.id) });
  };
  for (const e of getEntries(guild.id)) {
    const role = guild.roles.cache.get(e.roleId);
    if (!role) continue;
    for (const n of e.names) {
      if (q && !normalizeToken(n).includes(q) && !normalizeToken(role.name).includes(q)) continue;
      push(role, `${n} → ${role.name}`);
    }
  }
  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.id || role.managed) continue;
    if (q && !normalizeToken(role.name).includes(q)) continue;
    push(role, role.name);
  }
  return out.slice(0, 25);
}

/**
 * Validate & clean the dashboard payload.
 * Returns { ok, value } or { ok:false, error, name }.
 */
function validateEntries(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'Invalid payload.' };
  if (input.length > 200) return { ok: false, error: 'At most 200 roles can have custom names.' };
  const out = [];
  const used = new Map(); // normalised name -> roleId
  const roles = new Set();
  for (const entry of input) {
    const roleId = String((entry && entry.roleId) || '');
    if (!/^\d{5,25}$/.test(roleId)) return { ok: false, error: 'Every row needs a Discord role. Pick one from the role selector.' };
    if (roles.has(roleId)) return { ok: false, error: 'The same Discord role is configured twice. Merge the custom names into one row.' };
    roles.add(roleId);
    const names = [];
    for (const rawName of (Array.isArray(entry.names) ? entry.names : [])) {
      const name = cleanAlias(String(rawName));
      if (!name) continue;
      if (!isValidAlias(name)) return { ok: false, error: `Invalid custom name "${rawName}". Custom names cannot contain spaces or exceed 32 characters.`, name: String(rawName) };
      const key = normalizeToken(name);
      if (names.some((n) => normalizeToken(n) === key)) continue;
      const owner = used.get(key);
      if (owner && owner !== roleId) return { ok: false, error: `The custom name "${name}" is already used by another role.`, name };
      used.set(key, roleId);
      names.push(name);
    }
    if (names.length > 25) return { ok: false, error: 'A role can have at most 25 custom names.' };
    out.push({ roleId, names });
  }
  return { ok: true, value: out };
}

module.exports = { getEntries, nameMap, namesFor, resolveRole, isDeletedRoleName, autocompleteChoices, validateEntries };
