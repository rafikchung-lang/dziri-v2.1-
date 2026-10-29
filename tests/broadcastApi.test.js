'use strict';
/**
 * Exercises the real Express dashboard preview endpoint, including the guild access guard.
 * Run: node tests/broadcastApi.test.js
 */
const assert = require('assert');
const express = require('express');
const createApi = require('../dashboard/api');

function member(id, roles = [], bot = false) {
  return {
    id,
    user: { id, username: `user-${id}`, bot },
    roles: { cache: new Map(roles.map((role) => [role, { id: role }])) },
    joinedTimestamp: Date.now() - 10_000,
  };
}

async function createDashboard(guild) {
  const client = {
    isReady: () => true,
    guilds: { cache: new Map([[guild.id, guild]]) },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: { username: 'dashboard-test' }, mode: 'local' }; next(); });
  app.use('/api', createApi(client, { canAccessGuild: async () => true, ticketBot: null }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const { port } = server.address();
  return {
    post: async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

(async () => {
  const roleA = '111111111111111111';
  const roleB = '222222222222222222';
  const members = [member('333333333333333333', [roleA]), member('444444444444444444', [roleB]), member('555555555555555555', [], true)];
  let fetches = 0;
  const guild = {
    id: '123456789012345678', memberCount: members.length,
    members: {
      cache: new Map(),
      fetch: async () => {
        fetches++;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return new Map(members.map((m) => [m.id, m]));
      },
    },
  };
  const dashboard = await createDashboard(guild);
  try {
    const filters = { target: 'roles', roles: [roleA], excludeRoles: [], joinedWithinDays: 0, joinedBeforeDays: 0 };
    const [first, second] = await Promise.all([
      dashboard.post(`/guilds/${guild.id}/broadcast/preview`, { filters }),
      dashboard.post(`/guilds/${guild.id}/broadcast/preview`, { filters }),
    ]);
    assert.deepStrictEqual(first, { status: 200, body: { count: 1, matched: 1, skipped: 1, cap: 1000 } });
    assert.deepStrictEqual(second, first);
    assert.strictEqual(fetches, 1, 'two concurrent browser requests result in one Opcode 8 member request');

    const filtered = await dashboard.post(`/guilds/${guild.id}/broadcast/preview`, {
      filters: { target: 'all', roles: [], excludeRoles: [roleB], joinedWithinDays: 0, joinedBeforeDays: 0 },
    });
    assert.deepStrictEqual(filtered, { status: 200, body: { count: 1, matched: 1, skipped: 2, cap: 1000 } });
    assert.strictEqual(fetches, 1, 'a follow-up preview reuses the fetched member snapshot');
    console.log('Dashboard broadcast preview API integration passed.');
  } finally {
    await dashboard.close();
  }
})().catch((err) => { console.error(err.stack); process.exitCode = 1; });
