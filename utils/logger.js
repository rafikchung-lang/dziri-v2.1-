'use strict';
/**
 * Tiny console + file logger with size-based rotation.
 * Keeps at most MAX_FILES files of MAX_SIZE bytes each (default 3 × 2 MB),
 * so logs can never eat Wispbyte's limited storage.
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'data', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'dziri.log');
const MAX_SIZE = 2 * 1024 * 1024;
const MAX_FILES = 3;

let ready = false;
function ensureDir() {
  if (ready) return;
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); ready = true; } catch { /* ignore */ }
}

function rotate() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size < MAX_SIZE) return;
  } catch { return; }
  for (let i = MAX_FILES - 1; i >= 1; i--) {
    const src = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`;
    const dst = `${LOG_FILE}.${i}`;
    try { if (fs.existsSync(src)) fs.renameSync(src, dst); } catch { /* ignore */ }
  }
}

let writes = 0;
function write(level, tag, msg) {
  const line = `[${new Date().toISOString()}] [${level}] [${tag}] ${msg}\n`;
  ensureDir();
  try {
    if (++writes % 50 === 0) rotate();
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* disk issues must never crash the bot */ }
}

function fmt(args) {
  return args.map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'object' ? safeJson(a) : String(a))).join(' ');
}
function safeJson(o) { try { return JSON.stringify(o); } catch { return String(o); } }

function logFiles() {
  ensureDir();
  try { return fs.readdirSync(LOG_DIR).filter((n) => /^dziri\.log(?:\.\d+)?$/.test(n)).map((n) => path.join(LOG_DIR, n)); }
  catch { return []; }
}

/** Delete only Dziri's process log files; configuration and all other data are untouched. */
function clearFiles() {
  let files = 0; let bytes = 0;
  for (const file of logFiles()) {
    try { bytes += fs.statSync(file).size; fs.unlinkSync(file); files++; } catch { /* ignore */ }
  }
  return { files, bytes };
}

/** Rewrite log files keeping only timestamped lines newer than the retention cutoff. */
function retainDays(days) {
  const n = Number(days);
  if (!(n > 0)) return { files: 0, bytes: 0 };
  const cutoff = Date.now() - n * 86_400_000;
  let files = 0; let bytes = 0;
  for (const file of logFiles()) {
    try {
      const before = fs.readFileSync(file, 'utf8');
      const kept = before.split('\n').filter((line) => {
        if (!line) return false;
        const m = line.match(/^\[([^\]]+)\]/);
        const at = m ? Date.parse(m[1]) : NaN;
        return Number.isNaN(at) || at >= cutoff;
      });
      const after = kept.length ? `${kept.join('\n')}\n` : '';
      if (after.length) fs.writeFileSync(file, after); else fs.unlinkSync(file);
      bytes += Math.max(0, Buffer.byteLength(before) - Buffer.byteLength(after));
      files++;
    } catch { /* ignore */ }
  }
  return { files, bytes };
}

function storageInfo() {
  let bytes = 0; const files = logFiles();
  for (const file of files) { try { bytes += fs.statSync(file).size; } catch { /* ignore */ } }
  return { files: files.length, bytes };
}

const logger = {
  info(tag, ...args) { const m = fmt(args); console.log(`[${tag}] ${m}`); write('INFO', tag, m); },
  warn(tag, ...args) { const m = fmt(args); console.warn(`[${tag}] ${m}`); write('WARN', tag, m); },
  error(tag, ...args) { const m = fmt(args); console.error(`[${tag}] ${m}`); write('ERROR', tag, m); },
  raw(line) { console.log(line); },
  clearFiles,
  retainDays,
  storageInfo,
};

module.exports = logger;
