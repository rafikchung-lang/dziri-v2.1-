'use strict';
/**
 * Lightweight persistent JSON store.
 *
 *   data/<collection>/<key>.json
 *
 * - documents are cached in memory after first load (lazy, per guild)
 * - writes are debounced (default 1.5 s) and atomic (write tmp file → rename),
 *   so a crash/restart can never leave a half-written file.
 * - flushAll() is called on shutdown signals.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const cache = new Map(); // "collection/key" -> object
const dirty = new Set();
let timer = null;
const DEBOUNCE_MS = 1500;

function fileFor(collection, key) {
  const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, collection, `${safeKey}.json`);
}

function init() {
  for (const dir of ['', 'guilds', 'levels', 'history', 'state', 'uploads', 'logs']) {
    fs.mkdirSync(path.join(DATA_DIR, dir), { recursive: true });
  }
}

function read(collection, key, fallbackFactory) {
  const id = `${collection}/${key}`;
  if (cache.has(id)) return cache.get(id);
  let doc;
  const file = fileFor(collection, key);
  try {
    if (fs.existsSync(file)) doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    logger.error('Storage', `Corrupted file ${file}, backing up and resetting.`, err.message);
    try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
  }
  if (doc === undefined || doc === null) doc = fallbackFactory ? fallbackFactory() : {};
  cache.set(id, doc);
  return doc;
}

function write(collection, key, doc) {
  const id = `${collection}/${key}`;
  cache.set(id, doc);
  markDirty(collection, key);
}

function markDirty(collection, key) {
  dirty.add(`${collection}/${key}`);
  if (!timer) timer = setTimeout(flushAll, DEBOUNCE_MS);
}

function flushAll() {
  if (timer) { clearTimeout(timer); timer = null; }
  for (const id of dirty) {
    const [collection, key] = id.split('/');
    const doc = cache.get(id);
    const file = fileFor(collection, key);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(doc));
      fs.renameSync(tmp, file);
    } catch (err) {
      logger.error('Storage', `Failed to write ${file}:`, err.message);
      continue;
    }
    dirty.delete(id);
  }
}

/** Force-write one document synchronously (used by the dashboard so "Saved" is real). */
function flushNow(collection, key) {
  dirty.add(`${collection}/${key}`);
  flushAll();
  return !dirty.has(`${collection}/${key}`);
}

module.exports = { init, read, write, markDirty, flushAll, flushNow, DATA_DIR };
