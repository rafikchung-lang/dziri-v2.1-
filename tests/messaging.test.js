'use strict';
/**
 * Dziri System — Member Messaging payload tests.  Run: node tests/messaging.test.js
 * Uses the REAL broadcastService.payloadFor()/resolveFormat() (the code shared by DM and
 * webhook delivery) with a mocked job/member/guild, and asserts the exact Discord payload:
 * message type, text → image ordering, footer on/off/custom/empty, placeholders, mentions.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const store = require('../database/store');
store.init();
const broadcastService = require('../services/broadcastService');
const { defaultGuildConfig } = require('../config/defaults');

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; } };

// --- mocks -----------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dziri-msg-'));
const img1 = path.join(tmp, 'my photo.png'); fs.writeFileSync(img1, 'png');
const img2 = path.join(tmp, 'صورة.jpg'); fs.writeFileSync(img2, 'jpg');
const pdf = path.join(tmp, 'rules.pdf'); fs.writeFileSync(pdf, 'pdf');
const IMAGE = { id: 'a'.repeat(24), name: 'my photo.png', type: 'image/png', size: 3, path: img1 };
const IMAGE2 = { id: 'b'.repeat(24), name: 'صورة.jpg', type: 'image/jpeg', size: 3, path: img2 };
const PDF = { id: 'c'.repeat(24), name: 'rules.pdf', type: 'application/pdf', size: 3, path: pdf };

const guild = { id: '610000000000000001', name: 'Dziri', memberCount: 42 };
const member = { id: '710000000000000001', displayName: 'Rafik', user: { username: 'rafik', globalName: 'Rafik' } };
const client = { user: { username: 'Dziri System', tag: 'Dziri System#0001' } };

function job({ message = 'Hello {user}, welcome to {server}!', attachments = [], format = {}, embed = {} } = {}) {
  return {
    message, attachments, client,
    format: broadcastService.resolveFormat(defaultGuildConfig().messaging, format),
    embed: { title: '', contentAbove: '', color: '#a855f7', ...embed },
  };
}
const payload = (opts) => broadcastService.payloadFor(job(opts), member, guild);

console.log('Member Messaging payloads');

// ---- defaults / backward compatibility -------------------------------------
test('resolveFormat: missing settings fall back safely (older configs)', () => {
  const f = broadcastService.resolveFormat(undefined, undefined);
  assert.deepStrictEqual(f, { messageType: 'normal', embedColor: '#a855f7', footerEnabled: true, footerText: broadcastService.DEFAULT_FOOTER });
  assert.strictEqual(broadcastService.resolveFormat({ messageType: 'weird', embedColor: 'red' }).messageType, 'normal');
  assert.strictEqual(broadcastService.resolveFormat({ messageType: 'weird', embedColor: 'red' }).embedColor, '#a855f7');
});
test('resolveFormat: empty footer text is preserved (never auto-filled with the default)', () => {
  assert.strictEqual(broadcastService.resolveFormat({ footerText: '' }).footerText, '');
  assert.strictEqual(broadcastService.resolveFormat({ footerText: '   ' }).footerText, '');
  assert.strictEqual(broadcastService.effectiveFooter({ footerEnabled: true, footerText: '' }), '');
  assert.strictEqual(broadcastService.effectiveFooter({ footerEnabled: false, footerText: 'x' }), '');
  assert.strictEqual(broadcastService.effectiveFooter({ footerEnabled: true, footerText: 'x' }), 'x');
});
test('resolveFormat: explicit overrides win over saved settings', () => {
  const f = broadcastService.resolveFormat({ messageType: 'normal', footerEnabled: true, footerText: 'saved' }, { messageType: 'embed', footerEnabled: false });
  assert.strictEqual(f.messageType, 'embed'); assert.strictEqual(f.footerEnabled, false); assert.strictEqual(f.footerText, 'saved');
});

// ---- the required test matrix ---------------------------------------------
test('Normal · no image · footer disabled → plain content only, no embed, no footer', () => {
  const p = payload({ format: { messageType: 'normal', footerEnabled: false } });
  assert.strictEqual(p.content, 'Hello <@710000000000000001>, welcome to Dziri!');
  assert.strictEqual(p.embeds, undefined);
  assert.deepStrictEqual(p.files, []);
  assert.ok(!/Sent from/.test(p.content));
  assert.deepStrictEqual(p.allowedMentions, { parse: [], users: [member.id], roles: [] });
});
test('Normal · image · footer disabled → content + plain attachment (Discord renders it below)', () => {
  const p = payload({ attachments: [IMAGE], format: { messageType: 'normal', footerEnabled: false } });
  assert.strictEqual(p.content, 'Hello <@710000000000000001>, welcome to Dziri!');
  assert.strictEqual(p.embeds, undefined);
  assert.deepStrictEqual(p.files, [{ attachment: img1, name: 'my photo.png' }]);
});
test('Normal · image · footer enabled with custom text → footer as sub-text after the text', () => {
  const p = payload({ attachments: [IMAGE], format: { messageType: 'normal', footerEnabled: true, footerText: 'From the {server} team' } });
  assert.strictEqual(p.content, 'Hello <@710000000000000001>, welcome to Dziri!\n\n-# From the Dziri team');
  assert.strictEqual(p.embeds, undefined);
  assert.strictEqual(p.files.length, 1);
});
test('Normal · footer enabled but empty → no footer at all', () => {
  const p = payload({ format: { messageType: 'normal', footerEnabled: true, footerText: '' } });
  assert.strictEqual(p.content, 'Hello <@710000000000000001>, welcome to Dziri!');
});
test('Normal · default footer (existing installs) → "Sent from Dziri via Dziri System" as sub-text, only once', () => {
  const p = payload({ format: {} });
  assert.strictEqual(p.content, 'Hello <@710000000000000001>, welcome to Dziri!\n\n-# Sent from Dziri via Dziri System');
});
test('Embed · no image · footer disabled → text in embed description, no content, no footer, no image', () => {
  const p = payload({ format: { messageType: 'embed', footerEnabled: false } });
  assert.strictEqual(p.content, undefined);
  assert.strictEqual(p.embeds.length, 1);
  assert.strictEqual(p.embeds[0].description, 'Hello <@710000000000000001>, welcome to Dziri!');
  assert.strictEqual(p.embeds[0].footer, undefined);
  assert.strictEqual(p.embeds[0].image, undefined);
  assert.strictEqual(p.embeds[0].color, 0xa855f7);
  assert.deepStrictEqual(p.files, []);
});
test('Embed · image · footer disabled → image inside the embed via attachment:// (below the description), not duplicated', () => {
  const p = payload({ attachments: [IMAGE], format: { messageType: 'embed', footerEnabled: false } });
  assert.strictEqual(p.embeds.length, 1);
  assert.strictEqual(p.embeds[0].description, 'Hello <@710000000000000001>, welcome to Dziri!');
  assert.deepStrictEqual(p.embeds[0].image, { url: 'attachment://image-1.png' });
  assert.deepStrictEqual(p.files, [{ attachment: img1, name: 'image-1.png' }]); // exactly one upload, referenced once
  assert.strictEqual(p.embeds[0].footer, undefined);
  assert.strictEqual(p.embeds[0].thumbnail, undefined);
});
test('Embed · image · footer enabled with custom text → embed footer field, placeholders expanded', () => {
  const p = payload({ attachments: [IMAGE], format: { messageType: 'embed', footerEnabled: true, footerText: '{server} • {bot}' } });
  assert.deepStrictEqual(p.embeds[0].footer, { text: 'Dziri • Dziri System' });
  assert.deepStrictEqual(p.embeds[0].image, { url: 'attachment://image-1.png' });
  assert.ok(!p.content, 'no hidden content/attribution is added');
});
test('Embed · image · footer enabled but empty → no footer field', () => {
  const p = payload({ attachments: [IMAGE], format: { messageType: 'embed', footerEnabled: true, footerText: '' } });
  assert.strictEqual(p.embeds[0].footer, undefined);
  assert.deepStrictEqual(p.embeds[0].image, { url: 'attachment://image-1.png' });
});

// ---- extra safety -----------------------------------------------------------
test('Embed · multiple files → first image in main embed, 2nd image stacked below, PDF kept as plain upload (nothing dropped)', () => {
  const p = payload({ attachments: [PDF, IMAGE, IMAGE2], format: { messageType: 'embed', footerEnabled: false } });
  assert.strictEqual(p.embeds.length, 2);
  assert.deepStrictEqual(p.embeds[0].image, { url: 'attachment://image-1.png' });
  assert.deepStrictEqual(p.embeds[1], { color: 0xa855f7, image: { url: 'attachment://image-2.jpg' } });
  assert.deepStrictEqual(p.files, [
    { attachment: pdf, name: 'rules.pdf' },
    { attachment: img1, name: 'image-1.png' },
    { attachment: img2, name: 'image-2.jpg' },
  ]);
});
test('Embed · title + plain text above (optional) → content kept separate so {user} can ping', () => {
  const p = payload({ format: { messageType: 'embed', footerEnabled: false }, embed: { title: 'Hi {displayname}', contentAbove: '{user}' } });
  assert.strictEqual(p.content, '<@710000000000000001>');
  assert.strictEqual(p.embeds[0].title, 'Hi Rafik');
});
test('Embed · custom colour from format', () => {
  const p = payload({ format: { messageType: 'embed', embedColor: '#112233', footerEnabled: false }, embed: { color: '#112233' } });
  assert.strictEqual(p.embeds[0].color, 0x112233);
});
test('Normal · attachments only (no text, no footer) → content undefined, files present', () => {
  const p = payload({ message: '', attachments: [PDF], format: { messageType: 'normal', footerEnabled: false } });
  assert.strictEqual(p.content, undefined);
  assert.deepStrictEqual(p.files, [{ attachment: pdf, name: 'rules.pdf' }]);
});
test('Mentions: only the recipient may ping (@everyone/@here/roles never parsed) in both types', () => {
  for (const messageType of ['normal', 'embed']) {
    const p = payload({ message: '@everyone @here {user}', format: { messageType, footerEnabled: false } });
    assert.deepStrictEqual(p.allowedMentions, { parse: [], users: [member.id], roles: [] });
  }
});
test('config/defaults.js exposes the messaging section with sane defaults', () => {
  const m = defaultGuildConfig().messaging;
  assert.deepStrictEqual(m, { messageType: 'normal', embedColor: '#a855f7', footerEnabled: true, footerText: 'Sent from {server} via {bot}' });
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES ABOVE' : ''}`);
