'use strict';
/**
 * Member history: moderation actions, role/nickname changes, automod hits.
 * Stored per guild in data/history/<guildId>.json, capped to MAX_ENTRIES (oldest dropped)
 * so storage stays bounded.
 */
const store = require('../database/store');

const MAX_ENTRIES = 5000;

function doc(guildId) { return store.read('history', guildId, () => ({ seq: 0, entries: [] })); }

/**
 * @param {string} guildId
 * @param {{type:string,targetId:string,targetTag?:string,moderatorId?:string,moderatorTag?:string,reason?:string,duration?:string,details?:string}} entry
 */
function add(guildId, entry) {
  const d = doc(guildId);
  d.seq = (d.seq || 0) + 1;
  const rec = {
    id: d.seq,
    type: entry.type,
    targetId: entry.targetId || '',
    targetTag: entry.targetTag || '',
    moderatorId: entry.moderatorId || '',
    moderatorTag: entry.moderatorTag || '',
    reason: entry.reason || '',
    duration: entry.duration || '',
    details: entry.details || '',
    source: entry.source || '',
    at: Date.now(),
  };
  d.entries.push(rec);
  if (d.entries.length > MAX_ENTRIES) d.entries.splice(0, d.entries.length - MAX_ENTRIES);
  store.markDirty('history', guildId);
  return rec;
}

function query(guildId, { page = 1, pageSize = 20, userId = '', type = '', search = '' } = {}) {
  const d = doc(guildId);
  let list = d.entries;
  if (userId) list = list.filter((e) => e.targetId === userId || e.moderatorId === userId);
  if (type) list = list.filter((e) => e.type === type);
  if (search) {
    const s = search.toLowerCase();
    list = list.filter((e) => [e.targetTag, e.moderatorTag, e.reason, e.details, e.targetId].some((x) => String(x).toLowerCase().includes(s)));
  }
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const start = total - p * pageSize;
  const items = list.slice(Math.max(0, start), start + pageSize).reverse();
  return { items, total, page: p, pages, pageSize };
}

function stats(guildId, sinceMs) {
  const d = doc(guildId);
  const since = Date.now() - sinceMs;
  const counts = {};
  for (const e of d.entries) if (e.at >= since) counts[e.type] = (counts[e.type] || 0) + 1;
  return counts;
}

function recent(guildId, n = 8) { return doc(guildId).entries.slice(-n).reverse(); }

module.exports = { add, query, stats, recent };
