'use strict';
/**
 * Member Messaging recipient-resolution tests. Run: node tests/broadcastRecipients.test.js
 * Verifies that broadcast preview/sending reuses member data instead of multiplying Opcode 8
 * requests, while preserving role and exclusion filters.
 */
const assert = require('assert');
const store = require('../database/store');
store.init();
const broadcastService = require('../services/broadcastService');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.stack}`); process.exitCode = 1; }
}

function member(id, roleIds = [], bot = false) {
  return {
    id,
    user: { id, bot, username: `user-${id}` },
    roles: { cache: new Map(roleIds.map((roleId) => [roleId, { id: roleId }])) },
    joinedTimestamp: Date.now() - 10_000,
  };
}

function guild(id, members, fetch) {
  return { id, memberCount: members.length, members: { cache: new Map(), fetch } };
}

(async () => {
  await test('concurrent previews share one full member fetch and preserve role filters', async () => {
    const members = [member('one', ['role-a']), member('two', ['role-b']), member('bot', [], true)];
    let fetches = 0;
    const fakeGuild = guild('recipient-concurrent', members, async () => {
      fetches++;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return new Map(members.map((m) => [m.id, m]));
    });
    const filters = { target: 'roles', roles: ['role-a'], excludeRoles: [], joinedWithinDays: 0, joinedBeforeDays: 0 };
    const [first, second] = await Promise.all([broadcastService.preview(fakeGuild, filters), broadcastService.preview(fakeGuild, filters)]);
    assert.strictEqual(fetches, 1);
    assert.deepStrictEqual(first, { count: 1, matched: 1, skipped: 1, cap: 1000 });
    assert.deepStrictEqual(second, first);

    const recipients = await broadcastService.resolveRecipients(fakeGuild, { ...filters, target: 'all', roles: [], excludeRoles: ['role-b'] });
    assert.strictEqual(fetches, 1, 'the send-time recipient resolution reuses the preview snapshot');
    assert.deepStrictEqual(recipients.recipients.map((m) => m.id), ['one']);
    assert.strictEqual(recipients.skipped, 2);
  });

  await test('a complete Discord.js member cache is used without an Opcode 8 fetch', async () => {
    const members = [member('one', ['role-a']), member('two')];
    let fetches = 0;
    const fakeGuild = guild('recipient-cache', members, async () => { fetches++; throw new Error('fetch should not be called'); });
    fakeGuild.members.cache = new Map(members.map((m) => [m.id, m]));
    const result = await broadcastService.preview(fakeGuild, { target: 'roles', roles: ['role-a'], excludeRoles: [], joinedWithinDays: 0, joinedBeforeDays: 0 });
    assert.strictEqual(fetches, 0);
    assert.strictEqual(result.count, 1);
  });

  await test('Discord retry timing becomes a cooldown instead of repeated fetch attempts', async () => {
    const members = [member('one')];
    let fetches = 0;
    const fakeGuild = guild('recipient-cooldown', members, async () => {
      fetches++;
      throw new Error('Request with opcode 8 was rate limited. Retry after 6.825 seconds.');
    });
    const filters = { target: 'all', roles: [], excludeRoles: [], joinedWithinDays: 0, joinedBeforeDays: 0 };
    await assert.rejects(() => broadcastService.preview(fakeGuild, filters), /temporarily rate limiting member data\. Retry after 6\./);
    await assert.rejects(() => broadcastService.preview(fakeGuild, filters), /temporarily rate limiting member data\. Retry after/);
    assert.strictEqual(fetches, 1, 'cooldown prevents a tight retry loop');
  });

  console.log(`\n${passed} passed${process.exitCode ? ' - FAILURES ABOVE' : ''}`);
})();
