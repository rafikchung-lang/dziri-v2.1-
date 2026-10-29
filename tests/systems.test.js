'use strict';
/**
 * Dziri System — Ticket & Temporary Room service tests.  Run: npm test
 * Uses the REAL services with lightweight Discord mocks, so every assertion checks the
 * actual Discord calls the bot would make (channel creation, permission overwrites,
 * renames, user limits, deletion, and exactly-once notifications).
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { Collection, ChannelType, PermissionFlagsBits } = require('discord.js');

const store = require('../database/store');
store.init();
const configService = require('../services/configService');
const ticketService = require('../services/ticketService');
const tempRoomService = require('../services/tempRoomService');
const botRegistry = require('../services/botRegistry');

const GID = '610000000000000001';
const CAT = '820000000000000001';
const PANEL = '820000000000000002';
const NOTIFY = '820000000000000003';
const LOGCH = '820000000000000004';
const JOIN = '820000000000000005';
const SUPPORT = '720000000000000001';
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; } };

// --- mocks -----------------------------------------------------------------
const sent = { welcome: [], notify: [], log: [] };
function textChannel(id, name, bucket) {
  return {
    id, name, type: ChannelType.GuildText, parentId: null, guild: null,
    isTextBased: () => true,
    send: async (p) => { bucket.push(p); return { id: `m${bucket.length}`, url: `https://discord.com/channels/${GID}/${id}/x`, edit: async () => {} }; },
    messages: { fetch: async () => new Collection() },
    permissionOverwrites: { edit: async () => {} },
    setName: async () => {},
    delete: async () => {},
  };
}
function makeGuild() {
  const created = [];
  const channels = new Collection();
  channels.set(PANEL, textChannel(PANEL, 'tickets', sent.welcome));
  channels.set(NOTIFY, textChannel(NOTIFY, 'mod-alerts', sent.notify));
  channels.set(LOGCH, textChannel(LOGCH, 'ticket-logs', sent.log));
  channels.set(CAT, { id: CAT, name: 'Tickets', type: ChannelType.GuildCategory, isTextBased: () => false });
  channels.set(JOIN, { id: JOIN, name: 'join-to-create', type: ChannelType.GuildVoice, parentId: CAT, isTextBased: () => false, members: new Collection() });
  const roles = new Collection();
  roles.set(SUPPORT, { id: SUPPORT, name: 'Support' });
  roles.set(GID, { id: GID, name: '@everyone' });
  const guild = {
    id: GID, name: 'Test', created, channels: { cache: channels, fetch: async (id) => channels.get(id) || null },
    roles: { cache: roles, everyone: roles.get(GID) },
    members: { me: { id: 'bot', permissions: { has: () => true }, permissionsIn: () => ({ has: () => true }) }, fetch: async (id) => memberMock(String(id)) },
  };
  guild.channels.create = async (opts) => {
    const id = `9${created.length}00000000000000`;
    const ch = opts.type === ChannelType.GuildVoice
      ? { id, name: opts.name, type: ChannelType.GuildVoice, parentId: opts.parent, userLimit: opts.userLimit || 0, guild, members: new Collection(), overwrites: opts.permissionOverwrites || [], calls: [],
          permissionOverwrites: { edit: async (target, perms) => { ch.calls.push({ target: target.id || target, perms }); } },
          setName: async (n) => { ch.name = n; }, setUserLimit: async (n) => { ch.userLimit = n; }, delete: async () => { ch.deleted = true; channels.delete(id); } }
      : { ...textChannel(id, opts.name, sent.welcome), parentId: opts.parent, overwrites: opts.permissionOverwrites || [], guild };
    channels.set(id, ch);
    created.push(ch);
    return ch;
  };
  return guild;
}
function memberMock(id, { voiceChannel = null, staff = false } = {}) {
  return {
    id, user: { id, tag: `user${id}`, username: `user${id}`, bot: false },
    displayName: `user${id}`,
    permissions: { has: (p) => staff && p !== undefined },
    roles: { cache: new Collection() },
    voice: { channelId: voiceChannel ? voiceChannel.id : null, channel: voiceChannel, setChannel: async (c) => { voiceChannel = c; if (c) c.members.set(id, memberMock(id)); }, disconnect: async () => {} },
  };
}
function interactionMock(guild, { type = 'select', customId = '', values = [], userId = '111', channelId = null, fields = null } = {}) {
  const out = { replies: [], updates: [], modals: [] };
  const i = {
    guild, guildId: guild.id, channelId, user: { id: userId, tag: `user${userId}`, username: `user${userId}` },
    member: memberMock(userId, { staff: true }), customId, values, replied: false, deferred: false,
    inGuild: () => true, isRepliable: () => true,
    isStringSelectMenu: () => type === 'select', isButton: () => type === 'button',
    isUserSelectMenu: () => type === 'userselect', isModalSubmit: () => type === 'modal',
    users: new Collection(values.map((v) => [v, { id: v, bot: false }])),
    fields: { getTextInputValue: () => fields },
    message: { components: [], edit: async () => {} },
    channel: channelId ? guild.channels.cache.get(channelId) : null,
    deferReply: async () => { if (i.replied || i.deferred) throw new Error('already acknowledged'); i.deferred = true; return {}; },
    editReply: async (p) => { if (!i.deferred && !i.replied) throw new Error('editReply before acknowledging'); out.replies.push(p); return p; },
    reply: async (p) => { i.replied = true; out.replies.push(p); return p; },
    followUp: async (p) => { out.replies.push(p); },
    update: async (p) => { out.updates.push(p); },
    showModal: async (m) => { out.modals.push(m); },
  };
  return { i, out };
}

(async () => {
  console.log('\nDziri System ticket & temporary room tests\n');
  const guild = makeGuild();

  configService.saveSection(GID, 'tickets', {
    ...configService.getGuildConfig(GID).tickets,
    enabled: true, supportRoles: [SUPPORT], categoryId: CAT, logChannelId: LOGCH, maxOpenPerUser: 1, closeConfirm: false,
    panel: { ...configService.getGuildConfig(GID).tickets.panel, channelId: PANEL, senderBot: 'ticket', delivery: 'message' },
    notifications: { enabled: true, channelId: NOTIFY, mentionRoles: [SUPPORT], syncPermissions: false },
    types: [{ id: 'purchase', name: 'Purchase', description: 'buy', emoji: '🛒', categoryId: CAT, supportRoles: [], namingFormat: 'ticket-{username}', welcome: 'hello' }],
  });
  const ticketClient = { isReady: () => true, user: { id: 'tbot', tag: 'Ticket#1', displayAvatarURL: () => '' }, guilds: { cache: new Collection([[GID, guild]]) } };
  const mainClient = { isReady: () => true, user: { id: 'mbot', tag: 'Dziri#1', displayAvatarURL: () => '' }, guilds: { cache: new Collection([[GID, guild]]) } };
  botRegistry.register('ticket', ticketClient);
  botRegistry.register('main', mainClient);

  let ticketChannel;
  await test('ticket: member picks a type → private channel created in that category', async () => {
    const { i, out } = interactionMock(guild, { type: 'select', customId: ticketService.CID.open, values: ['purchase'], userId: '111' });
    await ticketService.handleInteraction(i);
    ticketChannel = guild.created[0];
    assert.ok(ticketChannel, 'channel created');
    assert.strictEqual(ticketChannel.name, 'ticket-user111');
    assert.strictEqual(ticketChannel.parentId, CAT);
    assert.match(JSON.stringify(out.replies), /ticket has been created/i);
  });

  await test('ticket permissions: creator + support role allowed, @everyone denied', () => {
    const ov = ticketChannel.overwrites;
    const everyone = ov.find((o) => o.id === GID);
    const creator = ov.find((o) => o.id === '111');
    const support = ov.find((o) => o.id === SUPPORT);
    assert.ok(everyone.deny.includes(PermissionFlagsBits.ViewChannel), '@everyone denied');
    assert.ok(creator.allow.includes(PermissionFlagsBits.ViewChannel) && creator.allow.includes(PermissionFlagsBits.SendMessages), 'creator allowed');
    assert.ok(support.allow.includes(PermissionFlagsBits.ViewChannel), 'support role allowed');
  });

  await test('ticket notification: exactly ONE, with member, exact type and Open Ticket link', () => {
    assert.strictEqual(sent.notify.length, 1, 'exactly one notification');
    const n = sent.notify[0];
    const data = n.embeds[0].data;
    assert.match(JSON.stringify(data.fields), /<@111>/, 'shows the member');
    assert.match(JSON.stringify(data.fields), /Purchase/, 'shows the exact ticket type');
    assert.match(JSON.stringify(data.fields), new RegExp(ticketChannel.id), 'links the ticket channel');
    const btn = n.components[0].toJSON().components[0];
    assert.strictEqual(btn.url, `https://discord.com/channels/${GID}/${ticketChannel.id}`, 'Open Ticket button points to the ticket');
  });

  await test('ticket: an immediately retried interaction is blocked (in-flight guard)', async () => {
    const before = guild.created.length;
    const { i, out } = interactionMock(guild, { type: 'select', customId: ticketService.CID.open, values: ['purchase'], userId: '111' });
    await ticketService.handleInteraction(i);
    assert.strictEqual(guild.created.length, before, 'no second channel');
    assert.strictEqual(sent.notify.length, 1, 'no second notification');
    assert.match(JSON.stringify(out.replies), /already being created/i);
  });

  await test('ticket: the persisted open-ticket limit still blocks later duplicates', async () => {
    await new Promise((r) => setTimeout(r, 3100)); // let the in-flight guard expire
    const before = guild.created.length;
    const { i, out } = interactionMock(guild, { type: 'select', customId: ticketService.CID.open, values: ['purchase'], userId: '111' });
    await ticketService.handleInteraction(i);
    assert.strictEqual(guild.created.length, before, 'still no second channel');
    assert.strictEqual(sent.notify.length, 1, 'still exactly one notification');
    assert.match(JSON.stringify(out.replies), /already have/i);
  });

  await test('ticket controls: claim then close perform real actions and log', async () => {
    const claim = interactionMock(guild, { type: 'button', customId: ticketService.CID.claim, userId: '222', channelId: ticketChannel.id });
    await ticketService.handleInteraction(claim.i);
    assert.match(JSON.stringify(claim.out.replies), /claimed this ticket/i);
    const logsBefore = sent.log.length;
    const close = interactionMock(guild, { type: 'button', customId: ticketService.CID.close, userId: '222', channelId: ticketChannel.id });
    await ticketService.handleInteraction(close.i);
    assert.ok(sent.log.length > logsBefore, 'ticket events are logged');
    assert.match(JSON.stringify(sent.log), /Ticket closed/i);
  });

  await test('ticket status: dashboard sees open/closed counts and no false warnings', () => {
    const st = ticketService.status(GID);
    assert.strictEqual(st.total, 1);
    assert.strictEqual(st.closed, 1);
    assert.deepStrictEqual(st.warnings, []);
  });

  await test('ticket: a deleted category is reported as a warning, not a crash', () => {
    const cfg = configService.getGuildConfig(GID).tickets;
    configService.saveSection(GID, 'tickets', { ...cfg, categoryId: '820000000000000099' });
    const st = ticketService.status(GID);
    assert.ok(st.warnings.some((w) => /category/i.test(w)), 'warning shown');
    configService.saveSection(GID, 'tickets', { ...cfg, categoryId: CAT });
  });

  // ---------------- temporary rooms ----------------
  configService.saveSection(GID, 'tempRooms', {
    ...configService.getGuildConfig(GID).tempRooms,
    enabled: true, joinChannelId: JOIN, categoryId: CAT, nameFormat: "{username}'s Room", defaultUserLimit: 0, emptyGraceSeconds: 0,
    panel: { ...configService.getGuildConfig(GID).tempRooms.panel, channelId: PANEL },
  });
  tempRoomService.setClient(mainClient);

  let room;
  const owner = memberMock('111');
  await test('temp room: joining Join-to-Create makes a room owned by that member', async () => {
    owner.guild = guild;
    await tempRoomService.onVoiceUpdate({ channelId: null, guild }, { channelId: JOIN, guild, member: owner });
    room = guild.created.find((c) => c.type === ChannelType.GuildVoice);
    assert.ok(room, 'voice channel created');
    assert.strictEqual(room.name, "user111's Room");
    assert.strictEqual(room.parentId, CAT);
    const st = tempRoomService.status(GID);
    assert.strictEqual(st.rooms[0].ownerId, '111');
  });

  const inRoom = (userId) => { const m = memberMock(userId); m.voice.channelId = room.id; m.voice.channel = room; return m; };
  const roomBtn = (customId, userId = '111', extra = {}) => {
    const { i, out } = interactionMock(guild, { type: 'button', customId, userId, ...extra });
    i.member = inRoom(userId);
    return { i, out };
  };

  await test('temp room: Lock actually denies Connect for @everyone', async () => {
    const { i } = roomBtn(tempRoomService.CID.lock);
    await tempRoomService.handleInteraction(i);
    const call = room.calls.find((c) => c.target === GID && 'Connect' in c.perms);
    assert.ok(call && call.perms.Connect === false, 'Connect denied');
    assert.strictEqual(tempRoomService.status(GID).rooms[0].locked, true);
  });

  await test('temp room: Unlock and Hide/Unhide change the real overwrites', async () => {
    await tempRoomService.handleInteraction(roomBtn(tempRoomService.CID.unlock).i);
    assert.strictEqual(room.calls.filter((c) => c.target === GID && c.perms.Connect === null).length, 1);
    await tempRoomService.handleInteraction(roomBtn(tempRoomService.CID.hide).i);
    assert.ok(room.calls.find((c) => c.perms.ViewChannel === false), 'hidden');
    await tempRoomService.handleInteraction(roomBtn(tempRoomService.CID.unhide).i);
    assert.ok(room.calls.find((c) => c.perms.ViewChannel === null), 'unhidden');
  });

  await test('temp room: user limit buttons change Discord’s user limit', async () => {
    await tempRoomService.handleInteraction(roomBtn(tempRoomService.CID.limitUp).i);
    await tempRoomService.handleInteraction(roomBtn(tempRoomService.CID.limitUp).i);
    assert.strictEqual(room.userLimit, 2);
    await tempRoomService.handleInteraction(roomBtn(tempRoomService.CID.limitDown).i);
    assert.strictEqual(room.userLimit, 1);
  });

  await test('temp room: Rename opens a modal and the submit renames the channel', async () => {
    const { i, out } = roomBtn(tempRoomService.CID.rename);
    await tempRoomService.handleInteraction(i);
    assert.strictEqual(out.modals.length, 1, 'modal shown');
    const sub = interactionMock(guild, { type: 'modal', customId: tempRoomService.CID.renameModal, userId: '111', fields: 'Rafik Room' });
    sub.i.member = inRoom('111');
    await tempRoomService.handleInteraction(sub.i);
    assert.strictEqual(room.name, 'Rafik Room');
  });

  await test('temp room: Allow / Deny edit real member permissions', async () => {
    const allow = interactionMock(guild, { type: 'userselect', customId: tempRoomService.CID.allowPick, userId: '111', values: ['333'] });
    allow.i.member = inRoom('111');
    await tempRoomService.handleInteraction(allow.i);
    assert.ok(room.calls.find((c) => c.target === '333' && c.perms.Connect === true), 'member allowed');
    const deny = interactionMock(guild, { type: 'userselect', customId: tempRoomService.CID.denyPick, userId: '111', values: ['444'] });
    deny.i.member = inRoom('111');
    await tempRoomService.handleInteraction(deny.i);
    assert.ok(room.calls.find((c) => c.target === '444' && c.perms.Connect === false), 'member denied');
  });

  await test('temp room: ownership transfer updates the owner', async () => {
    const t = interactionMock(guild, { type: 'userselect', customId: tempRoomService.CID.claimPick, userId: '111', values: ['555'] });
    t.i.member = inRoom('111');
    await tempRoomService.handleInteraction(t.i);
    assert.strictEqual(tempRoomService.status(GID).rooms[0].ownerId, '555');
  });

  await test('temp room: a member without a room gets a clear message, not an action', async () => {
    const { i, out } = interactionMock(guild, { type: 'button', customId: tempRoomService.CID.lock, userId: '999' });
    i.member = memberMock('999');
    await tempRoomService.handleInteraction(i);
    assert.match(JSON.stringify(out.replies), /not in a temporary room/i);
  });

  await test('temp room: empty room is deleted automatically', async () => {
    room.members = new Collection();
    await tempRoomService.onVoiceUpdate({ channelId: room.id, guild }, { channelId: null, guild, member: memberMock('555') });
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(room.deleted, true, 'channel deleted');
    assert.strictEqual(tempRoomService.status(GID).active, 0);
  });

  await test('temp room: startup reconcile removes stale rooms instead of duplicating', async () => {
    const before = tempRoomService.status(GID).active;
    await tempRoomService.reconcile({ isReady: () => true, guilds: { cache: new Collection([[GID, guild]]) } });
    assert.strictEqual(tempRoomService.status(GID).active, before);
  });

  store.flushAll();
  for (const f of [path.join(store.DATA_DIR, 'guilds', `${GID}.json`), path.join(store.DATA_DIR, 'state', 'tickets.json'), path.join(store.DATA_DIR, 'state', 'temprooms.json')]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  console.log(`\n${passed} test(s) passed${process.exitCode ? ' — SOME FAILED' : ''}.\n`);
  process.exit(process.exitCode || 0);
})();
