'use strict';
/**
 * Duration helpers. Durations are stored as strings like "10m", "1h", "7d", "permanent" or "".
 */
const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
const PERMANENT = ['permanent', 'perm', 'forever', 'دائم', '0'];

function parseDuration(str) {
  if (str === undefined || str === null) return null;
  const s = String(str).trim().toLowerCase();
  if (!s) return null;
  if (PERMANENT.includes(s)) return 0; // 0 = permanent
  const re = /(\d+)\s*([smhdw])/g;
  let total = 0; let m; let matched = '';
  while ((m = re.exec(s))) { total += Number(m[1]) * UNITS[m[2]]; matched += m[0]; }
  if (!total || matched.replace(/\s/g, '') !== s.replace(/\s/g, '')) return null;
  return total;
}

function isDurationToken(str) {
  const v = parseDuration(str);
  return v !== null;
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms === 0) return 'Permanent';
  const parts = [];
  for (const [u, v] of [['d', UNITS.d], ['h', UNITS.h], ['m', UNITS.m], ['s', UNITS.s]]) {
    if (ms >= v) { parts.push(`${Math.floor(ms / v)}${u}`); ms %= v; }
  }
  return parts.join(' ') || '0s';
}

/** Normalise a user-entered duration string for storage ("" | "permanent" | "10m"...). */
function normalizeDurationString(str) {
  if (str === undefined || str === null) return '';
  const s = String(str).trim().toLowerCase();
  if (!s) return '';
  const v = parseDuration(s);
  if (v === null) return null; // invalid
  if (v === 0) return 'permanent';
  return s.replace(/\s+/g, '');
}

module.exports = { parseDuration, isDurationToken, formatDuration, normalizeDurationString, UNITS };
