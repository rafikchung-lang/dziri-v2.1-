'use strict';
/**
 * Dziri System — dispatcher / persistence self-test.   Run:  npm test
 * Uses the REAL command registry, config service, storage and message dispatcher,
 * with lightweight Discord object mocks. Test guild files are removed afterwards.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { PermissionFlagsBits, Collection } = require('discord.js');

const store = require('../database/store');
store.init();
const configService = require('../services/configService');
const commandService = require('../services/commandService');
const { parseMessage, buildTriggerMap } = require('../utils/commandParser');

const G1 = '900000000000000001';
const G2 = '900000000000000002';
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; } };

const n = commandService.loadCommands();
const parse = (gid, content) => { const r = parseMessage(content, configService.getPrefix(gid), commandService.getTriggerMap(gid)); return r && r.commandName; };
const saveCmd = (gid, name, body) => { const r = commandService.validateCommandConfig(gid, name, body); if (!r.ok) return r; configService.saveCommandConfig(gid, name, r.value); return r; };

// ---- Discord mocks ---------------------------------------------------------
function mockRole(id, name) {
  return { id, name, position: 2, managed: false, hexColor: '#ff0000' };
}
function mockGuild(gid, renames = {}, deleted = false) {
  const roles = new Collection();
  if (!deleted) {
    roles.set('400000000000000001', mockRole('400000000000000001', renames['400000000000000001'] || 'Odyssey'));
    roles.set('400000000000000002', mockRole('400000000000000002', 'Staff'));
  }
  roles.set(gid, mockRole(gid, '@everyone'));
  return { id: gid, roles: { cache: roles } };
}

function mockMessage(gid, content, { admin = false, perms = [], roles = [], reply = null } = {}) {
  const replies = [];
  const permsSet = new Set(perms.map((p) => PermissionFlagsBits[p]));
  const member = {
    id: '111', permissions: { has: (p) => (admin ? true : Array.isArray(p) ? p.every((x) => permsSet.has(x)) : permsSet.has(p)) },
    roles: { cache: new Map((Array.isArray(roles) ? roles : []).map((r) => [r, {}])), highest: { position: 5 } },
  };
  const guild = mockGuild(gid);
  guild.ownerId = '999';
  guild.members = { me: null, fetch: async (id) => ({ id: String(id), user: { tag: `user-${id}`, id: String(id) }, roles: { cache: new Map(), highest: { position: 1 } } }) };
  guild.channels = { cache: new Map() };
  return {
    replies,
    msg: {
      content, guild, member, author: { id: '111', bot: false, tag: 'tester' }, webhookId: null,
      client: { users: { fetch: async (id) => ({ id: String(id), tag: `user-${id}` }) } },
      channel: { id: '222', parentId: null, sendTyping: async () => {} },
      reference: reply ? { messageId: '999000' } : null,
      fetchReference: async () => (reply ? { author: { id: reply, tag: `user-${reply}`, bot: false, system: false } } : null),
      delete: async () => {},
      reply: async (p) => { replies.push(p); return { edit: async () => {} }; },
    },
  };
}

(async () => {
  console.log(`\nDziri System dispatcher tests (${n} commands loaded)\n`);

  await test('registry contains all required commands', () => {
    for (const c of ['textmute', 'textunmute', 'voicemute', 'voiceunmute', 'ban', 'unban', 'kick', 'purge', 'lock', 'unlock', 'role', 'rank', 'leaderboard', 'history']) assert.ok(commandService.getCommand(c), c);
  });

  await test('slash definitions build for every command', () => {
    const defs = commandService.slashDefinitions();
    assert.strictEqual(defs.length, n);
    assert.ok(defs.find((d) => d.name === 'textmute' && d.options.length === 3));
  });

  await test('multiple aliases (English + Arabic) save together, none replaced', () => {
    const r = saveCmd(G1, 'textmute', { aliases: ['mute', 'كتم', 'اسكات', 'silence'] });
    assert.ok(r.ok, r.error);
    assert.deepStrictEqual(commandService.getCommandConfig(G1, commandService.getCommand('textmute')).aliases, ['mute', 'كتم', 'اسكات', 'silence']);
  });

  await test('prefix "!" → canonical, English and Arabic aliases execute', () => {
    configService.saveSection(G1, 'prefix', '!');
    assert.strictEqual(configService.getPrefix(G1), '!');
    for (const m of ['!textmute @User', '!mute @User', '!كتم @User', '!اسكات @User', '!silence <@123>', '!MUTE @User', '  !mute @User']) assert.strictEqual(parse(G1, m), 'textmute', m);
    assert.strictEqual(parse(G1, 'mute @User'), null, 'no prefix → ignored');
    assert.strictEqual(parse(G1, '!hello'), null);
  });

  await test('empty prefix "" is stored as "" (not null/undefined/default)', () => {
    configService.saveSection(G1, 'prefix', '');
    assert.strictEqual(configService.getPrefix(G1), '');
    assert.strictEqual(configService.getGuildConfig(G1).prefix, '');
    const file = JSON.parse(fs.readFileSync(path.join(store.DATA_DIR, 'guilds', `${G1}.json`), 'utf8'));
    assert.strictEqual(file.prefix, '');
  });

  await test('empty prefix → names & aliases execute directly', () => {
    for (const m of ['textmute @User', 'mute @User', 'كتم @User', 'اسكات @User', 'silence @User', 'ban 123456789012345678', 'حظر @User', 'help']) assert.ok(parse(G1, m), m);
    assert.strictEqual(parse(G1, 'كتم @User'), 'textmute');
  });

  await test('empty prefix → normal chat is NOT treated as a command', () => {
    for (const m of ['hello everyone', 'how are you', 'good morning', 'muted lol', 'كتمت الصوت', 'مرحبا بالجميع', 'I will mute you', '', '   ']) assert.strictEqual(parse(G1, m), null, JSON.stringify(m));
  });

  await test('Arabic normalisation: tatweel / invisible marks still match, letters untouched', () => {
    assert.strictEqual(parse(G1, 'كـتـم @User'), 'textmute');
    assert.strictEqual(parse(G1, '\u200Fكتم @User'), 'textmute');
    assert.deepStrictEqual(commandService.getCommandConfig(G1, commandService.getCommand('textmute')).aliases[1], 'كتم');
  });

  await test('alias collision is rejected with the required message', () => {
    const r = commandService.validateCommandConfig(G1, 'ban', { aliases: ['كتم'] });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /This alias is already assigned to another command\./);
    const r2 = commandService.validateCommandConfig(G1, 'ban', { aliases: ['kick'] });
    assert.strictEqual(r2.ok, false);
  });

  await test('removing one alias keeps the others', () => {
    saveCmd(G1, 'textmute', { aliases: ['كتم', 'اسكات', 'silence'] });
    assert.strictEqual(parse(G1, 'mute @User'), null);
    assert.strictEqual(parse(G1, 'اسكات @User'), 'textmute');
    saveCmd(G1, 'textmute', { aliases: ['mute', 'كتم', 'اسكات', 'silence'] });
  });

  await test('zero aliases → canonical name still works', () => {
    saveCmd(G1, 'kick', { aliases: [] });
    assert.strictEqual(parse(G1, 'kick @User'), 'kick');
    assert.strictEqual(parse(G1, 'طرد @User'), null);
  });

  await test('aliases are guild-specific', () => {
    configService.saveSection(G2, 'prefix', '');
    assert.strictEqual(parse(G2, 'اسكات @User'), null);
    assert.strictEqual(parse(G2, 'mute @User'), 'textmute'); // default alias
    assert.strictEqual(parse(G1, 'اسكات @User'), 'textmute');
  });

  await test('reasons are command-specific', () => {
    assert.ok(saveCmd(G1, 'textmute', { reasons: [{ label: 'Spamming', duration: '10m' }, { label: 'Advertising', duration: '1h' }, { label: 'Insulting', duration: '30m' }] }).ok);
    assert.ok(saveCmd(G1, 'ban', { reasons: [{ label: 'Severe abuse', duration: 'permanent' }, { label: 'Advertising', duration: '7d' }] }).ok);
    saveCmd(G1, 'textmute', { reasons: [{ label: 'Spamming', duration: '15m' }] });
    const ban = commandService.getCommandConfig(G1, commandService.getCommand('ban')).reasons;
    assert.deepStrictEqual(ban, [{ label: 'Severe abuse', duration: 'permanent' }, { label: 'Advertising', duration: '7d' }]);
    assert.strictEqual(commandService.validateCommandConfig(G1, 'kick', { reasons: [{ label: 'x', duration: 'banana' }] }).ok, false);
  });

  await test('roles/channels selections persist (ids only)', () => {
    const roles = ['100000000000000001', '100000000000000002', '100000000000000003'];
    assert.ok(saveCmd(G1, 'textmute', { allowedRoles: roles, allowedChannels: ['200000000000000001', '200000000000000002', '200000000000000003'] }).ok);
    const c = commandService.getCommandConfig(G1, commandService.getCommand('textmute'));
    assert.deepStrictEqual(c.allowedRoles, roles);
    assert.strictEqual(c.allowedChannels.length, 3);
    saveCmd(G1, 'textmute', { allowedRoles: [], allowedChannels: [] });
  });

  await test('dispatcher: alias + empty prefix runs SAME handler with SAME permission check', async () => {
    const def = commandService.getCommand('textmute');
    const original = def.execute;
    const ran = [];
    def.execute = async (ctx) => { ran.push(ctx.trigger); };
    try {
      // ordinary member → denied for every trigger form
      for (const content of ['كتم <@123456789012345678>', 'mute <@123456789012345678>', 'textmute <@123456789012345678>']) {
        const { msg, replies } = mockMessage(G1, content);
        assert.strictEqual(await commandService.handleMessage(msg), true);
        assert.strictEqual(ran.length, 0, 'handler must not run without permission');
        assert.match(JSON.stringify(replies[0].embeds[0].data), /ModerateMembers/);
      }
      // moderator → runs for every trigger form
      for (const content of ['كتم <@123456789012345678>', 'اسكات <@123456789012345678>', 'mute <@123456789012345678>']) {
        const { msg } = mockMessage(G1, content, { perms: ['ModerateMembers'] });
        msg.guild.members.fetch = async () => ({ id: '123456789012345678', user: { tag: 't' }, roles: { cache: new Map(), highest: { position: 1 } } });
        assert.strictEqual(await commandService.handleMessage(msg), true);
      }
      assert.deepStrictEqual(ran, ['كتم', 'اسكات', 'mute']);
      // ordinary chat → nothing at all
      const { msg, replies } = mockMessage(G1, 'hello everyone', { admin: true });
      assert.strictEqual(await commandService.handleMessage(msg), false);
      assert.strictEqual(replies.length, 0);
    } finally { def.execute = original; }
  });

  await test('disabled command stops canonical name and aliases', async () => {
    saveCmd(G1, 'purge', { enabled: false, aliases: ['مسح'] });
    assert.strictEqual(parse(G1, 'مسح 5'), null);
    const { msg, replies } = mockMessage(G1, 'purge 5', { admin: true });
    await commandService.handleMessage(msg);
    assert.match(JSON.stringify(replies[0].embeds[0].data), /disabled/);
    saveCmd(G1, 'purge', { enabled: true });
  });

  await test('restart: a fresh process loads empty prefix + all aliases from disk', () => {
    store.flushAll();
    const out = execFileSync(process.execPath, ['-e', `
      const cs=require('./services/configService'); const cmd=require('./services/commandService'); const {parseMessage}=require('./utils/commandParser');
      cmd.loadCommands();
      const p=cs.getPrefix('${G1}'); const map=cmd.getTriggerMap('${G1}');
      const r=['mute @u','كتم @u','اسكات @u','silence @u','hello everyone'].map(m=>{const x=parseMessage(m,p,map);return x&&x.commandName;});
      console.log(JSON.stringify({p, r, aliases: cmd.getCommandConfig('${G1}', cmd.getCommand('textmute')).aliases}));
    `], { cwd: path.join(__dirname, '..') }).toString().trim();
    const res = JSON.parse(out.split('\n').pop());
    assert.strictEqual(res.p, '');
    assert.deepStrictEqual(res.r, ['textmute', 'textmute', 'textmute', 'textmute', null]);
    assert.deepStrictEqual(res.aliases, ['mute', 'كتم', 'اسكات', 'silence']);
  });

  await test('pure parser: prefix with multi-char + space after prefix', () => {
    const map = buildTriggerMap(['textmute'], { textmute: ['كتم'] });
    assert.strictEqual(parseMessage('dz! كتم @x', 'dz!', map).commandName, 'textmute');
    assert.strictEqual(parseMessage('dz!كتم', 'dz!', map).commandName, 'textmute');
    assert.strictEqual(parseMessage('كتم', '', map).commandName, 'textmute');
    assert.strictEqual(parseMessage('!', '!', map), null);
  });


  await test('custom role names: resolve ID, English, Arabic + multiple names → same role', () => {
    const roleNames = require('../utils/roleNames');
    const guild = mockGuild(G1);
    const v = roleNames.validateEntries([{ roleId: '400000000000000001', names: ['ods', 'أوديسي', 'odyssey'] }]);
    assert.ok(v.ok, v.error);
    configService.saveSection(G1, 'roleNames', v.value);
    for (const n of ['ods', 'أوديسي', 'odyssey', 'ODS', 'Odyssey', '400000000000000001', '<@&400000000000000001>']) {
      const role = roleNames.resolveRole(guild, n);
      assert.ok(role, `resolve ${n}`);
      assert.strictEqual(role.id, '400000000000000001', n);
    }
    assert.strictEqual(roleNames.resolveRole(guild, 'nope'), null);
  });

  await test('custom role names survive a Discord role rename (ID is the reference)', () => {
    const roleNames = require('../utils/roleNames');
    const guild = mockGuild(G1, { '400000000000000001': 'Odyssey Staff' }); // renamed in Discord
    assert.strictEqual(roleNames.resolveRole(guild, 'ods').id, '400000000000000001');
    assert.strictEqual(roleNames.resolveRole(guild, 'أوديسي').name, 'Odyssey Staff');
  });

  await test('custom role names: deleted role is handled gracefully, no crash', () => {
    const roleNames = require('../utils/roleNames');
    const guild = mockGuild(G1, {}, true); // role no longer exists
    assert.strictEqual(roleNames.resolveRole(guild, 'ods'), null);
    assert.strictEqual(roleNames.isDeletedRoleName(guild, 'ods'), true);
  });

  await test('custom role names are NOT command aliases (separate systems)', () => {
    assert.strictEqual(parse(G1, 'ods @user'), null, 'a role custom name must not trigger a command');
    assert.strictEqual(parse(G1, 'كتم @User'), 'textmute', 'command aliases still work');
    assert.strictEqual(parse(G1, 'role @u ods'), 'role');
  });

  await test('custom role name collisions and bad input are rejected', () => {
    const roleNames = require('../utils/roleNames');
    assert.strictEqual(roleNames.validateEntries([{ roleId: '1', names: ['x'] }]).ok, false);
    assert.strictEqual(roleNames.validateEntries([{ roleId: '400000000000000001', names: ['two words'] }]).ok, false);
    const dup = roleNames.validateEntries([{ roleId: '400000000000000001', names: ['ods'] }, { roleId: '400000000000000002', names: ['ODS'] }]);
    assert.strictEqual(dup.ok, false);
    assert.match(dup.error, /already used by another role/);
  });

  await test('reply targeting: !mute with no mention targets the replied-to author', async () => {
    const def = commandService.getCommand('textmute');
    const original = def.execute;
    let seen = null;
    def.execute = async (ctx) => { seen = { id: ctx.args.user.id, fromReply: ctx.fromReply }; };
    try {
      const { msg } = mockMessage(G1, 'mute', { perms: ['ModerateMembers'], reply: '555555555555555555' });
      assert.strictEqual(await commandService.handleMessage(msg), true);
      assert.deepStrictEqual(seen, { id: '555555555555555555', fromReply: true });
    } finally { def.execute = original; }
  });

  await test('reply targeting: explicit mention wins over the replied-to author', async () => {
    const def = commandService.getCommand('textmute');
    const original = def.execute;
    let seen = null;
    def.execute = async (ctx) => { seen = ctx.args.user.id; };
    try {
      const { msg } = mockMessage(G1, 'mute <@777777777777777777>', { perms: ['ModerateMembers'], reply: '555555555555555555' });
      await commandService.handleMessage(msg);
      assert.strictEqual(seen, '777777777777777777');
    } finally { def.execute = original; }
  });

  await test('reply targeting: no mention and no reply → helpful error, no action', async () => {
    const def = commandService.getCommand('textmute');
    const original = def.execute;
    let ran = false;
    def.execute = async () => { ran = true; };
    try {
      const { msg, replies } = mockMessage(G1, 'mute', { perms: ['ModerateMembers'] });
      await commandService.handleMessage(msg);
      assert.strictEqual(ran, false);
      assert.match(JSON.stringify(replies[0].embeds[0].data), /reply to their message/i);
    } finally { def.execute = original; }
  });

  await test('reply + role custom name: "role ods" targets the replied-to member', async () => {
    const def = commandService.getCommand('role');
    const original = def.execute;
    let seen = null;
    def.execute = async (ctx) => { seen = { user: ctx.args.user.id, role: ctx.args.role.id, action: ctx.args.action }; };
    try {
      const { msg } = mockMessage(G1, 'role ods', { perms: ['ManageRoles'], reply: '555555555555555555', roles: { '400000000000000001': 'Odyssey' } });
      assert.strictEqual(await commandService.handleMessage(msg), true);
      assert.deepStrictEqual(seen, { user: '555555555555555555', role: '400000000000000001', action: undefined });
    } finally { def.execute = original; }
  });

  await test('explicit role command still works: "role add @user ods"', async () => {
    const def = commandService.getCommand('role');
    const original = def.execute;
    let seen = null;
    def.execute = async (ctx) => { seen = { user: ctx.args.user.id, role: ctx.args.role.id, action: ctx.args.action }; };
    try {
      const { msg } = mockMessage(G1, 'role add <@777777777777777777> أوديسي', { perms: ['ManageRoles'], roles: { '400000000000000001': 'Odyssey' } });
      await commandService.handleMessage(msg);
      assert.deepStrictEqual(seen, { user: '777777777777777777', role: '400000000000000001', action: 'add' });
    } finally { def.execute = original; }
  });

  await test('tickets & temp rooms: defaults exist and are guild-specific + persisted', () => {
    const cfg = configService.getGuildConfig(G1);
    assert.strictEqual(cfg.tickets.enabled, false);
    assert.strictEqual(cfg.tickets.notifications.enabled, true);
    assert.strictEqual(cfg.tickets.types.length, 0, 'no ticket types are injected by default');
    assert.strictEqual(cfg.tempRooms.enabled, false);
    configService.saveSection(G1, 'tickets', { ...cfg.tickets, enabled: true, supportRoles: ['400000000000000009'], notifications: { ...cfg.tickets.notifications, channelId: '500000000000000001' } });
    configService.saveSection(G1, 'tempRooms', { ...cfg.tempRooms, enabled: true, joinChannelId: '500000000000000002' });
    assert.strictEqual(configService.getGuildConfig(G1).tickets.notifications.channelId, '500000000000000001');
    assert.strictEqual(configService.getGuildConfig(G2).tickets.enabled, false, 'guild-specific');
    assert.strictEqual(configService.getGuildConfig(G1).tempRooms.joinChannelId, '500000000000000002');
  });

  await test('existing rank card + leveling config untouched by the new sections', () => {
    const cfg = configService.getGuildConfig(G1);
    assert.strictEqual(cfg.leveling.levelUpMessages, false, 'level-up messages still OFF by default');
    assert.strictEqual(cfg.rankCard.backgroundType, 'gradient');
    assert.strictEqual(cfg.rankCard.title, 'DZIRI SYSTEM');
  });

  // cleanup
  for (const g of [G1, G2]) { try { fs.unlinkSync(path.join(store.DATA_DIR, 'guilds', `${g}.json`)); } catch { /* ignore */ } }
  console.log(`\n${passed} test(s) passed${process.exitCode ? ' — SOME FAILED' : ''}.\n`);
})();
