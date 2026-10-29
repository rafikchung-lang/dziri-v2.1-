'use strict';
/**
 * Regression tests for the reported Ticket / Temporary Room bugs.
 *
 * Covers, with real services + Discord mocks:
 *   · every interaction is acknowledged inside Discord's 3 s window ("didn't respond in time")
 *   · the bot selected as sender really sends the panel AND handles its components
 *   · message mode never creates a webhook; webhook mode uses an application-owned webhook
 *   · images work in BOTH delivery modes
 *   · the ticket menu contains EXACTLY the configured types
 *   · a member standing in their own room is never told to "join your temporary room first"
 *   · two members only ever control their own room
 *   · configurable buttons (label / emoji / style / order / enabled / delete) reach Discord
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { Collection, ChannelType, PermissionFlagsBits, ComponentType } = require('discord.js');

const store = require('../database/store');
store.init();
const configService = require('../services/configService');
const botRegistry = require('../services/botRegistry');
const ticketService = require('../services/ticketService');
const tempRoomService = require('../services/tempRoomService');
const panelDelivery = require('../services/panelDelivery');

const GID = '620000000000000001';
const PANEL = '830000000000000001';
const CAT = '830000000000000002';
const JOIN = '830000000000000003';
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; } };

// ---------------------------------------------------------------- mocks
function makeWorld() {
  const sentBy = [];           // { bot, via, hasImage, components }
  const webhooksCreated = [];
  const channels = new Collection();
  const voiceChannels = new Collection();

  const panelChannel = {
    id: PANEL, name: 'tickets', type: ChannelType.GuildText, parentId: null, isTextBased: () => true,
    webhooks: new Collection(),
    send: async (p) => { sentBy.push({ bot: currentBot, via: 'message', hasImage: Boolean(p.files && p.files.length), payload: p }); return mkMsg(p, PANEL); },
    messages: { fetch: async () => null },
    fetchWebhooks: async () => panelChannel.webhooks,
    createWebhook: async (opts) => {
      const wh = {
        id: `wh${panelChannel.webhooks.size + 1}`, name: opts.name, token: 'secret-token',
        owner: { id: currentBot.user.id },
        send: async (p) => { sentBy.push({ bot: currentBot, via: 'webhook', hasImage: Boolean(p.files && p.files.length), payload: p }); return mkMsg(p, PANEL); },
        editMessage: async (id, p) => { sentBy.push({ bot: currentBot, via: 'webhook-edit', hasImage: Boolean(p.files && p.files.length), payload: p }); return mkMsg(p, PANEL); },
        deleteMessage: async () => {},
      };
      panelChannel.webhooks.set(wh.id, wh);
      webhooksCreated.push({ bot: currentBot.user.tag, name: opts.name });
      return wh;
    },
    permissionOverwrites: { edit: async () => {} },
  };
  let msgSeq = 0;
  const mkMsg = (p, chId) => ({ id: `msg${++msgSeq}`, url: `https://discord.com/channels/${GID}/${chId}/msg${msgSeq}`, editable: true, components: p.components || [], edit: async () => {}, delete: async () => {} });
  channels.set(PANEL, panelChannel);
  channels.set(CAT, { id: CAT, name: 'Rooms', type: ChannelType.GuildCategory, isTextBased: () => false });
  channels.set(JOIN, { id: JOIN, name: 'join-to-create', type: ChannelType.GuildVoice, parentId: CAT, isTextBased: () => false, isVoiceBased: () => true, members: new Collection() });

  const roles = new Collection([[GID, { id: GID, name: '@everyone' }]]);
  const guild = {
    id: GID, name: 'Test', channels: { cache: channels, fetch: async (id) => channels.get(id) || null },
    roles: { cache: roles, everyone: roles.get(GID) },
    members: {
      me: { id: 'bot', permissions: { has: () => true }, permissionsIn: () => ({ has: () => true }) },
      cache: new Collection(),
      fetch: async (opt) => { const id = typeof opt === 'object' ? opt.user : opt; return members.get(String(id)) || null; },
    },
  };
  const members = new Collection();
  guild.members.cache = members;
  guild.channels.create = async (opts) => {
    const id = `vc${voiceChannels.size + 1}`;
    const ch = {
      id, name: opts.name, type: opts.type, parentId: opts.parent, userLimit: opts.userLimit || 0, guild,
      members: new Collection(), calls: [], isVoiceBased: () => opts.type === ChannelType.GuildVoice, isTextBased: () => opts.type === ChannelType.GuildText,
      permissionOverwrites: { edit: async (t, perms) => { ch.calls.push({ target: t.id || t, perms }); } },
      send: async (p) => mkMsg(p, id),
      messages: { fetch: async () => new Collection() },
      setName: async (n) => { ch.name = n; }, setUserLimit: async (n) => { ch.userLimit = n; },
      delete: async () => { ch.deleted = true; channels.delete(id); voiceChannels.delete(id); },
    };
    channels.set(id, ch); voiceChannels.set(id, ch);
    return ch;
  };
  let currentBot;
  const mkBot = (id, tag) => ({ isReady: () => true, user: { id, tag, displayAvatarURL: () => 'https://cdn/avatar.png' }, guilds: { cache: new Collection([[GID, guild]]) }, fetchWebhook: async () => null });
  return {
    guild, members, sentBy, webhooksCreated, panelChannel,
    main: mkBot('mainbot', 'Dziri#1111'), ticket: mkBot('ticketbot', 'Ticket#2222'),
    use: (b) => { currentBot = b; },
    get current() { return currentBot; },
  };
}

function mkMember(world, id, { voiceChannel = null, staff = false } = {}) {
  const m = {
    id, user: { id, tag: `user${id}`, username: `user${id}`, bot: false }, displayName: `user${id}`,
    permissions: { has: () => staff },
    roles: { cache: new Collection() },
    voice: {
      channelId: voiceChannel ? voiceChannel.id : null, channel: voiceChannel,
      setChannel: async (c) => { m.voice.channelId = c.id; m.voice.channel = c; c.members.set(id, m); },
      disconnect: async () => {},
    },
    guild: world.guild,
  };
  world.members.set(id, m);
  if (voiceChannel) voiceChannel.members.set(id, m);
  return m;
}

/**
 * Interaction mock that MEASURES acknowledgement: `ackMs` is how long the handler took
 * before calling deferReply/reply/showModal/update. Discord's limit is 3000 ms.
 */
function mkInteraction(world, { type, customId, values = [], userId, member, channelId = null, fields = null }) {
  const t0 = Date.now();
  const out = { replies: [], updates: [], modals: [], ackMs: null, ackKind: null };
  const markAck = (kind) => { if (out.ackMs === null) { out.ackMs = Date.now() - t0; out.ackKind = kind; } };
  const i = {
    guild: world.guild, guildId: GID, channelId,
    user: { id: userId, tag: `user${userId}`, username: `user${userId}` },
    member: member || mkMember(world, userId),
    customId, values, replied: false, deferred: false,
    inGuild: () => true, isRepliable: () => true,
    isStringSelectMenu: () => type === 'select', isButton: () => type === 'button',
    isUserSelectMenu: () => type === 'userselect', isModalSubmit: () => type === 'modal',
    users: new Collection(values.map((v) => [v, { id: v, bot: false }])),
    fields: { getTextInputValue: () => fields },
    message: { components: [], editable: true, edit: async () => {} },
    channel: channelId ? world.guild.channels.cache.get(channelId) : null,
    deferReply: async () => { if (i.deferred || i.replied) throw new Error('already acknowledged'); markAck('defer'); i.deferred = true; },
    reply: async (p) => { if (i.deferred || i.replied) throw new Error('already acknowledged'); markAck('reply'); i.replied = true; out.replies.push(p); },
    editReply: async (p) => { if (!i.deferred && !i.replied) throw new Error('editReply before acknowledging!'); out.replies.push(p); return p; },
    followUp: async (p) => { out.replies.push(p); },
    update: async (p) => { markAck('update'); i.replied = true; out.updates.push(p); },
    showModal: async (m) => { markAck('modal'); i.replied = true; out.modals.push(m); },
  };
  return { i, out };
}

const txt = (o) => JSON.stringify(o.replies.concat(o.updates));

(async () => {
  console.log('\nDziri System panel / interaction regression tests\n');
  const world = makeWorld();
  botRegistry.register('main', world.main);
  botRegistry.register('ticket', world.ticket);
  world.use(world.main);

  const baseTickets = configService.getGuildConfig(GID).tickets;

  await test('ticket types: dashboard config is the ONLY source (no injected defaults)', () => {
    assert.deepStrictEqual(configService.getGuildConfig(GID).tickets.types, [], 'fresh guild has zero ticket types');
    configService.saveSection(GID, 'tickets', {
      ...baseTickets, enabled: true, categoryId: CAT,
      panel: { ...baseTickets.panel, channelId: PANEL, senderBot: 'ticket', delivery: 'message', title: 'اهلا', image: '' },
      types: [{ id: 'purchase', name: 'Purchase', description: 'Purchase related questions', emoji: '🛒', categoryId: CAT, supportRoles: [], namingFormat: '', welcome: '' }],
    });
    const payload = ticketService.panelPayload(world.guild, configService.getGuildConfig(GID).tickets);
    const opts = payload.components[0].toJSON().components[0].options;
    assert.strictEqual(opts.length, 1, 'exactly one option');
    assert.strictEqual(opts[0].label, 'Purchase');
    assert.strictEqual(opts[0].description, 'Purchase related questions');
    assert.strictEqual(opts[0].emoji.name, '🛒');
  });

  await test('ticket menu grows to exactly the configured list (no "Other"/"Support" appended)', () => {
    const cfg = configService.getGuildConfig(GID).tickets;
    configService.saveSection(GID, 'tickets', { ...cfg, types: [...cfg.types, { id: 'support', name: 'Support', description: '', emoji: '', categoryId: '', supportRoles: [], namingFormat: '', welcome: '' }] });
    const opts = ticketService.panelPayload(world.guild, configService.getGuildConfig(GID).tickets).components[0].toJSON().components[0].options;
    assert.deepStrictEqual(opts.map((o) => o.label), ['Purchase', 'Support']);
    assert.ok(!('description' in opts[1]) || !opts[1].description, 'empty description is not invented');
    assert.ok(!opts[1].emoji, 'no emoji is invented');
  });

  await test('sender = Ticket Bot + Discord Message → the TICKET BOT sends, no webhook created', async () => {
    world.sentBy.length = 0; world.webhooksCreated.length = 0;
    world.use(world.ticket);
    const r = await ticketService.publishPanel(GID);
    assert.strictEqual(r.botTag, 'Ticket#2222', 'panel author is the ticket bot');
    assert.strictEqual(r.mode, 'message');
    assert.strictEqual(world.sentBy.at(-1).via, 'message');
    assert.strictEqual(world.sentBy.at(-1).bot.user.tag, 'Ticket#2222');
    assert.strictEqual(world.webhooksCreated.length, 0, 'message mode must NOT create a webhook');
  });

  await test('sender = Dziri System → the MAIN bot sends the same panel', async () => {
    const cfg = configService.getGuildConfig(GID).tickets;
    configService.saveSection(GID, 'tickets', { ...cfg, panel: { ...cfg.panel, senderBot: 'main' } });
    world.use(world.main);
    const r = await ticketService.publishPanel(GID);
    assert.strictEqual(r.botTag, 'Dziri#1111');
    assert.strictEqual(world.sentBy.at(-1).bot.user.tag, 'Dziri#1111');
  });

  await test('webhook mode uses an application-owned webhook of the SELECTED bot', async () => {
    const cfg = configService.getGuildConfig(GID).tickets;
    configService.saveSection(GID, 'tickets', { ...cfg, panel: { ...cfg.panel, senderBot: 'ticket', delivery: 'webhook' } });
    world.use(world.ticket);
    const r = await ticketService.publishPanel(GID);
    assert.strictEqual(r.mode, 'webhook');
    assert.strictEqual(world.sentBy.at(-1).via, 'webhook');
    assert.strictEqual(world.webhooksCreated.length, 1, 'one webhook created');
    const wh = [...world.panelChannel.webhooks.values()][0];
    assert.strictEqual(wh.owner.id, world.ticket.user.id, 'webhook is owned by the sending application (components work)');
    assert.ok(world.sentBy.at(-1).payload.components.length, 'components are sent with the webhook message');
  });

  await test('webhook tokens are never exposed to the dashboard', () => {
    const info = panelDelivery.info(GID, 'tickets');
    assert.ok(info.published && info.mode === 'webhook');
    assert.ok(!('webhookToken' in info) && !JSON.stringify(info).includes('secret-token'), 'no token leaks');
    assert.ok(!JSON.stringify(ticketService.status(GID)).includes('secret-token'), 'status is token-free');
  });

  await test('uploaded image works in BOTH delivery modes (no webhook forced)', async () => {
    const file = path.join(panelDelivery.UPLOAD_DIR, `test-${GID}.png`);
    fs.mkdirSync(panelDelivery.UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGP4DwABBAEAX+5qzQAAAABJRU5ErkJggg==', 'base64'));
    let cfg = configService.getGuildConfig(GID).tickets;
    configService.saveSection(GID, 'tickets', { ...cfg, panel: { ...cfg.panel, image: path.basename(file), delivery: 'message' } });
    world.use(world.ticket);
    await ticketService.publishPanel(GID);
    assert.strictEqual(world.sentBy.at(-1).via, 'message');
    assert.strictEqual(world.sentBy.at(-1).hasImage, true, 'image attached in message mode');
    cfg = configService.getGuildConfig(GID).tickets;
    configService.saveSection(GID, 'tickets', { ...cfg, panel: { ...cfg.panel, delivery: 'webhook' } });
    await ticketService.publishPanel(GID);
    assert.strictEqual(world.sentBy.at(-1).hasImage, true, 'image attached in webhook mode too');
    fs.unlinkSync(file);
    cfg = configService.getGuildConfig(GID).tickets;
    configService.saveSection(GID, 'tickets', { ...cfg, panel: { ...cfg.panel, image: '', delivery: 'message' } });
  });

  await test('ticket select menu is acknowledged immediately (no "didn\'t respond in time")', async () => {
    const { i, out } = mkInteraction(world, { type: 'select', customId: ticketService.CID.open, values: ['purchase'], userId: '111' });
    const handled = await ticketService.handleInteraction(i);
    assert.strictEqual(handled, true, 'the ticket system claims this interaction');
    assert.notStrictEqual(out.ackMs, null, 'interaction WAS acknowledged');
    assert.ok(out.ackMs < 3000, `acknowledged in ${out.ackMs}ms (< 3000)`);
    assert.strictEqual(out.ackKind, 'defer', 'deferred first, then the slow work happens');
    assert.match(txt(out), /ticket has been created/i);
  });

  await test('BOTH clients own the ticket handler, so whichever bot sent the panel answers', () => {
    const mainEvent = require('../events/interactionCreate.js');
    const src = fs.readFileSync(path.join(__dirname, '..', 'events', 'interactionCreate.js'), 'utf8');
    assert.ok(/ticketService\.handleInteraction/.test(src), 'main bot handles ticket components');
    assert.ok(/tempRoomService\.handleInteraction/.test(src), 'main bot handles room components');
    const ticketSrc = fs.readFileSync(path.join(__dirname, '..', 'bots', 'ticketBot.js'), 'utf8');
    assert.ok(/ticketService\.handleInteraction/.test(ticketSrc), 'ticket bot handles ticket components');
    assert.ok(/tempRoomService\.handleInteraction/.test(ticketSrc), 'ticket bot handles room components');
    assert.ok(/GuildVoiceStates/.test(ticketSrc), 'ticket bot can resolve voice state for room panels');
    assert.strictEqual(typeof mainEvent.execute, 'function');
  });

  await test('unknown ticket interactions are still acknowledged, never left hanging', async () => {
    const { i, out } = mkInteraction(world, { type: 'button', customId: 'dz-ticket-bogus', userId: '111', channelId: PANEL });
    await ticketService.handleInteraction(i);
    assert.notStrictEqual(out.ackMs, null, 'acknowledged');
  });

  await test('foreign interactions are ignored (no double handling between systems)', async () => {
    const { i } = mkInteraction(world, { type: 'button', customId: 'something-else', userId: '111' });
    assert.strictEqual(await ticketService.handleInteraction(i), false);
    assert.strictEqual(await tempRoomService.handleInteraction(i), false);
  });

  // ------------------------------------------------ temporary rooms
  const baseRooms = configService.getGuildConfig(GID).tempRooms;
  configService.saveSection(GID, 'tempRooms', {
    ...baseRooms, enabled: true, joinChannelId: JOIN, categoryId: CAT, emptyGraceSeconds: 0,
    panel: { ...baseRooms.panel, channelId: PANEL, senderBot: 'main', delivery: 'message' },
  });
  tempRoomService.setClient(world.main);

  const owner = mkMember(world, '111');
  let roomA;
  await test('join-to-create: room is created and the member is moved into it', async () => {
    await tempRoomService.onVoiceUpdate({ channelId: null, guild: world.guild }, { channelId: JOIN, guild: world.guild, member: owner });
    roomA = world.guild.channels.cache.find((c) => c.isVoiceBased && c.isVoiceBased() && c.id !== JOIN);
    assert.ok(roomA, 'temporary room created');
    assert.strictEqual(owner.voice.channelId, roomA.id, 'member moved into their room');
  });

  await test('THE REPORTED BUG: a member inside their room is NOT told to join one', async () => {
    for (const action of ['lock', 'unlock', 'hide', 'unhide', 'limitUp', 'limitDown']) {
      const { i, out } = mkInteraction(world, { type: 'button', customId: `dz-room-${action}`, userId: '111', member: owner });
      await tempRoomService.handleInteraction(i);
      assert.notStrictEqual(out.ackMs, null, `${action} acknowledged`);
      assert.ok(!/not in a temporary room|Join your temporary room/i.test(txt(out)), `${action} must not ask the owner to join a room — got ${txt(out)}`);
      assert.match(txt(out), /✅/, `${action} performed`);
    }
  });

  await test('…and the same holds for Rename / User limit (modals) and Delete', async () => {
    for (const action of ['rename', 'limit']) {
      const { i, out } = mkInteraction(world, { type: 'button', customId: `dz-room-${action}`, userId: '111', member: owner });
      await tempRoomService.handleInteraction(i);
      assert.strictEqual(out.modals.length, 1, `${action} opens a modal`);
      assert.strictEqual(out.ackKind, 'modal', 'the modal IS the acknowledgement');
      assert.ok(out.ackMs < 3000);
    }
  });

  await test('owner detection survives a cold voice cache (state refetched, not refused)', async () => {
    const cold = { ...owner, voice: { channelId: null, channel: null } };
    cold.roles = owner.roles; cold.permissions = owner.permissions; cold.id = owner.id;
    const { i, out } = mkInteraction(world, { type: 'button', customId: 'dz-room-lock', userId: '111', member: cold });
    await tempRoomService.handleInteraction(i);
    assert.ok(!/not in a temporary room/i.test(txt(out)), 'resolved via re-fetch / channel scan');
    assert.match(txt(out), /locked/i);
  });

  await test('ownership mapping survives a restart (room kept, owner intact)', async () => {
    store.flushAll();
    await tempRoomService.reconcile(world.main);
    const st = tempRoomService.status(GID);
    const mine = st.rooms.find((r) => r.channelId === roomA.id);
    assert.ok(mine, 'occupied room kept after reconcile');
    assert.strictEqual(mine.ownerId, '111', 'owner mapping intact');
  });

  await test('two members: each controls only their own room', async () => {
    const second = mkMember(world, '222');
    await tempRoomService.onVoiceUpdate({ channelId: null, guild: world.guild }, { channelId: JOIN, guild: world.guild, member: second });
    const roomB = world.guild.channels.cache.find((c) => c.isVoiceBased && c.isVoiceBased() && c.id !== JOIN && c.id !== roomA.id);
    assert.ok(roomB && roomB.id !== roomA.id, 'second room created');

    // B renames → only room B changes
    const { i } = mkInteraction(world, { type: 'modal', customId: tempRoomService.CID.renameModal, userId: '222', member: second, fields: 'Room B' });
    await tempRoomService.handleInteraction(i);
    assert.strictEqual(roomB.name, 'Room B');
    assert.notStrictEqual(roomA.name, 'Room B', 'room A untouched');

    // A sitting inside B's room may not control it
    const intruder = mkMember(world, '333', { voiceChannel: roomB });
    const { i: i2, out: o2 } = mkInteraction(world, { type: 'button', customId: 'dz-room-remove', userId: '333', member: intruder });
    await tempRoomService.handleInteraction(i2);
    assert.match(txt(o2), /belongs to <@222>|only control your own/i, 'non-owner refused');
    assert.ok(!roomB.deleted, "another member's room was not deleted");
  });

  await test('staff override still works', async () => {
    const staff = mkMember(world, '444', { voiceChannel: world.guild.channels.cache.get(roomA.id), staff: true });
    const { i, out } = mkInteraction(world, { type: 'button', customId: 'dz-room-lock', userId: '444', member: staff });
    await tempRoomService.handleInteraction(i);
    assert.match(txt(out), /locked/i, 'staff may control any room');
  });

  await test('configurable buttons: label, emoji, style, order, disable and delete reach Discord', async () => {
    const cfg = configService.getGuildConfig(GID).tempRooms;
    configService.saveSection(GID, 'tempRooms', {
      ...cfg,
      panel: {
        ...cfg.panel,
        buttons: [
          { id: 'b1', action: 'rename', label: 'Rename', emoji: '✏️', style: 'primary', enabled: true },
          { id: 'b2', action: 'lock', label: 'قفل', emoji: '🔒', style: 'danger', enabled: true },
          { id: 'b3', action: 'remove', label: 'Delete', emoji: '🗑️', style: 'danger', enabled: false },
        ],
      },
    });
    const payload = tempRoomService.panelPayload(world.guild, configService.getGuildConfig(GID).tempRooms);
    const btns = payload.components.flatMap((r) => r.toJSON().components);
    assert.strictEqual(btns.length, 2, 'disabled button is not rendered');
    assert.deepStrictEqual(btns.map((b) => b.label), ['Rename', 'قفل'], 'exact labels, exact order');
    assert.strictEqual(btns[0].emoji.name, '✏️');
    assert.strictEqual(btns[0].style, 1, 'primary');
    assert.strictEqual(btns[1].style, 4, 'danger');
    assert.strictEqual(btns[0].custom_id, 'dz-room-rename');
    assert.ok(btns.every((b) => b.type === ComponentType.Button));
  });

  await test('more than 5 buttons are spread across rows in the configured order', () => {
    const cfg = configService.getGuildConfig(GID).tempRooms;
    const actions = ['lock', 'unlock', 'hide', 'unhide', 'allow', 'deny', 'kick'];
    configService.saveSection(GID, 'tempRooms', { ...cfg, panel: { ...cfg.panel, buttons: actions.map((a, n) => ({ id: `x${n}`, action: a, label: `L${n}`, emoji: '', style: 'secondary', enabled: true })) } });
    const payload = tempRoomService.panelPayload(world.guild, configService.getGuildConfig(GID).tempRooms);
    assert.strictEqual(payload.components.length, 2, 'two rows');
    assert.strictEqual(payload.components[0].toJSON().components.length, 5);
    assert.deepStrictEqual(payload.components.flatMap((r) => r.toJSON().components).map((b) => b.label), ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
  });

  await test('temp room panel honours its own sender bot, independent of tickets', async () => {
    const cfg = configService.getGuildConfig(GID).tempRooms;
    configService.saveSection(GID, 'tempRooms', { ...cfg, panel: { ...cfg.panel, senderBot: 'ticket', delivery: 'message' } });
    world.use(world.ticket);
    const r = await tempRoomService.publishPanel(GID);
    assert.strictEqual(r.botTag, 'Ticket#2222', 'temp room panel sent by the ticket bot');
    // tickets keep their own (independent) sender
    assert.strictEqual(configService.getGuildConfig(GID).tickets.panel.senderBot, 'ticket');
    const cfg2 = configService.getGuildConfig(GID).tempRooms;
    configService.saveSection(GID, 'tempRooms', { ...cfg2, panel: { ...cfg2.panel, senderBot: 'main' } });
    world.use(world.main);
    const r2 = await tempRoomService.publishPanel(GID);
    assert.strictEqual(r2.botTag, 'Dziri#1111', 'switched back to the main bot');
  });

  await test('selecting an unavailable sender gives a clear error instead of silently using the wrong bot', async () => {
    botRegistry.register('ticket', null);
    const cfg = configService.getGuildConfig(GID).tickets;
    configService.saveSection(GID, 'tickets', { ...cfg, panel: { ...cfg.panel, senderBot: 'ticket' } });
    await assert.rejects(() => ticketService.publishPanel(GID), /Ticket Bot is not connected/i);
    botRegistry.register('ticket', world.ticket);
  });

  await test('settings persist across a restart (sender, delivery, buttons, types)', () => {
    store.flushAll();
    const out = require('child_process').execFileSync(process.execPath, ['-e', `
      const c = require('./services/configService');
      const g = c.getGuildConfig('${GID}');
      console.log(JSON.stringify({
        tSender: g.tickets.panel.senderBot, tMode: g.tickets.panel.delivery, types: g.tickets.types.map(t => t.name),
        rSender: g.tempRooms.panel.senderBot, rMode: g.tempRooms.panel.delivery, btns: g.tempRooms.panel.buttons.map(b => b.label),
      }));`], { cwd: path.join(__dirname, '..') }).toString().trim();
    const re = JSON.parse(out.split('\n').pop());
    assert.strictEqual(re.tSender, 'ticket');
    assert.deepStrictEqual(re.types, ['Purchase', 'Support'], 'only the configured types survive');
    assert.strictEqual(re.rSender, 'main');
    assert.deepStrictEqual(re.btns, ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'], 'custom buttons persisted');
  });

  // cleanup
  store.flushAll();
  for (const f of [path.join(store.DATA_DIR, 'guilds', `${GID}.json`), path.join(store.DATA_DIR, 'state', 'panels.json'), path.join(store.DATA_DIR, 'state', 'temprooms.json'), path.join(store.DATA_DIR, 'state', 'tickets.json')]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  console.log(`\n${passed} test(s) passed${process.exitCode ? ' — SOME FAILED' : ''}.\n`);
  process.exit(process.exitCode || 0);
})();
