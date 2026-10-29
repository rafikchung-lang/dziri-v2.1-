'use strict';
/**
 * Unicode-safe alias / token normalisation.
 *
 *  - NFC normalisation (never NFKD-stripping, so Arabic letters are untouched)
 *  - removes invisible formatting characters (ZWJ/ZWNJ/LRM/RLM/BOM) and Arabic tatweel "ـ"
 *  - lower-cases (only affects scripts that have case, e.g. Latin; Arabic is unchanged)
 *
 * The ORIGINAL alias string is always what gets stored and shown in the dashboard;
 * the normalised key is only used for matching.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u0640]/g;

function normalizeToken(input) {
  if (typeof input !== 'string') return '';
  return input.normalize('NFC').replace(INVISIBLE, '').trim().toLocaleLowerCase('en-US');
}

/** Clean an alias for storage: keep the user's characters, only trim & strip invisible chars. */
function cleanAlias(input) {
  if (typeof input !== 'string') return '';
  return input.normalize('NFC').replace(INVISIBLE, '').trim();
}

/** Aliases cannot contain whitespace (the dispatcher splits on whitespace) and have a sane length. */
function isValidAlias(alias) {
  const a = cleanAlias(alias);
  if (!a || a.length > 32) return false;
  if (/\s/u.test(a)) return false;
  return true;
}

module.exports = { normalizeToken, cleanAlias, isValidAlias };
