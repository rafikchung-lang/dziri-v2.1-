'use strict';
/**
 * Ticket System — runs on the SECOND Discord bot (bots/ticketBot.js).
 * It does not touch the main bot's moderation command system.
 *
 * Panel  → select menu with the configured ticket types
 * Create → private channel in the type's category, creator + support roles only
 * Controls → Claim / Close / Reopen / Transcript / Delete (real Discord actions)
 * Notify → exactly ONE embed per new ticket in the moderator notification channel
 *
 * State: data/state/tickets.json (survives restarts; used to prevent duplicate notifications).
 */
const path = require('path');
const fs = require('fs');
const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionFlagsBits, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const store = require('../database/store');
const configService = require('./configService');
const botRegistry = require('./botRegistry');
const panelDelivery = require('./panelDelivery');
const logger = require('../utils/logger');

const UPLOAD_DIR = path.join(store.DATA_DIR, 'uploads');
const CID = {
  open: 'dz-ticket-open', claim: 'dz-ticket-claim', accept: 'dz-ticket-accept:',
  close: 'dz-ticket-close', confirm: 'dz-ticket-confirm', cancel: 'dz-ticket-cancel',
  reopen: 'dz-ticket-reopen', del: 'dz-ticket-delete', transcript: 'dz-ticket-transcript',
};

const creating = new Set(); // guards against Discord interaction retries creating two tickets

function state() {
  const s = store.read('state', 'tickets', () => ({ guilds: {} }));
  if (!s.guilds) s.guilds = {};
  return s;
}
function gstate(guildId) {
  const s = state();
  if (!s.guilds[guildId]) s.guilds[guildId] = { counter: 0, tickets: {} };
  if (!s.guilds[guildId].tickets) s.guilds[guildId].tickets = {};
  return s.guilds[guildId];
}
const cfgOf = (guildId) => configService.getGuildConfig(guildId).tickets;
const hex = (c) => { const n = parseInt(String(c || '#a855f7').replace('#', '').slice(0, 6), 16); return Number.isNaN(n) ? 0xa855f7 : n; };

/** The ticket bot if available, otherwise the main bot (both can run the ticket system). */
function anyClient(guildId) {
  for (const key of ['ticket', 'main']) {
    const c = botRegistry.get(key);
    if (c && c.isReady() && (!guildId || c.guilds.cache.has(guildId))) return c;
  }
  return null;
}
function ready(guildId) { return Boolean(anyClient(guildId)); }

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
function panelPayload(guild, cfg) {
  const p = cfg.panel;
  const { embed, files } = panelDelivery.buildEmbed(p, { nameHint: 'ticket-panel' });

  // The dashboard configuration is the ONLY source of ticket types.
  // Nothing is appended, renamed or defaulted — what you configure is what Discord shows.
  const types = (cfg.types || []).filter((t) => t && String(t.name || '').trim()).slice(0, 25);
  const components = [];
  if (types.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(CID.open)
      .setPlaceholder(String(p.selectPlaceholder || 'Click to open a ticket').slice(0, 150))
      .addOptions(types.map((t) => {
        const opt = { label: String(t.name).slice(0, 100), value: t.id };
        if (t.description && String(t.description).trim()) opt.description = String(t.description).slice(0, 100);
        if (t.emoji && String(t.emoji).trim()) opt.emoji = String(t.emoji).trim();
        return opt;
      }));
    components.push(new ActionRowBuilder().addComponents(menu));
  }
  return { embeds: [embed], files, components };
}

/** Publish (or update) the ticket panel using the configured sender bot + delivery mode. */
async function publishPanel(guildId) {
  const cfg = cfgOf(guildId);
  if (!cfg.panel.channelId) throw new Error('Select a ticket panel channel first.');
  if (!(cfg.types || []).filter((t) => t && String(t.name || '').trim()).length) {
    throw new Error('Add at least one ticket type first — the panel only ever shows the types you configured.');
  }
  const { key, client } = botRegistry.resolveSender(cfg.panel.senderBot, guildId);
  const guild = client.guilds.cache.get(guildId);

  const result = await panelDelivery.publish({
    guildId,
    system: 'tickets',
    channelId: cfg.panel.channelId,
    senderBot: cfg.panel.senderBot,
    delivery: cfg.panel.delivery,
    webhookName: cfg.panel.title || 'Dziri System Tickets',
    buildPayload: () => panelPayload(guild, cfg),
  });

  const raw = configService.getGuildConfig(guildId).tickets;
  configService.saveSection(guildId, 'tickets', {
    ...raw,
    panel: { ...raw.panel, messageId: result.messageId, publishedChannelId: result.channelId, publishedAt: Date.now(), publishedBy: key, publishedMode: result.mode },
  });
  await syncNotificationPermissions(guildId).catch(() => {});
  return result;
}

/**
 * Make the moderator notification channel visible to the configured support roles only.
 * Only the @everyone + support-role overwrites are touched — unrelated permissions are kept.
 */
async function syncNotificationPermissions(guildId) {
  const cfg = cfgOf(guildId);
  const n = cfg.notifications;
  if (!n.enabled || !n.channelId || !n.syncPermissions) return false;
  const client = anyClient(guildId);
  if (!client) return false;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;
  const channel = guild.channels.cache.get(n.channelId) || await guild.channels.fetch(n.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;
  const me = guild.members.me;
  if (!me || !me.permissionsIn(channel).has(PermissionFlagsBits.ManageChannels)) return false;
  const roles = [...new Set([...(n.mentionRoles || []), ...(cfg.supportRoles || []), ...(cfg.types || []).flatMap((t) => t.supportRoles || [])])];
  await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }, { reason: 'Dziri System: ticket notification channel' });
  for (const roleId of roles) {
    if (!guild.roles.cache.has(roleId)) continue;
    await channel.permissionOverwrites.edit(roleId, { ViewChannel: true, ReadMessageHistory: true }, { reason: 'Dziri System: ticket support access' }).catch(() => {});
  }
  await channel.permissionOverwrites.edit(me.id, { ViewChannel: true, SendMessages: true, EmbedLinks: true }, { reason: 'Dziri System: ticket bot access' }).catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Ticket creation
// ---------------------------------------------------------------------------
function formatName(format, { user, number, type }) {
  const clean = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return (format || 'ticket-{username}')
    .replaceAll('{username}', clean(user.username))
    .replaceAll('{user}', clean(user.username))
    .replaceAll('{number}', String(number).padStart(4, '0'))
    .replaceAll('{type}', clean(type.name))
    .slice(0, 95) || `ticket-${number}`;
}

async function createTicket(interaction, typeId) {
  const guild = interaction.guild;
  const cfg = cfgOf(guild.id);
  if (!cfg.enabled) return interaction.editReply({ content: 'The ticket system is disabled on this server.' });
  const type = (cfg.types || []).find((t) => t.id === typeId);
  if (!type) return interaction.editReply({ content: 'That ticket type no longer exists. Ask an admin to republish the ticket panel.' });

  const guard = `${guild.id}:${interaction.user.id}`;
  if (creating.has(guard)) {
    await ack(interaction);
    return interaction.editReply({ content: 'Your ticket is already being created…' }).catch(() => {});
  }
  creating.add(guard);
  try {
    const gs = gstate(guild.id);

    // open-ticket limit (also prevents duplicates from double clicks)
    const open = Object.values(gs.tickets).filter((t) => t.userId === interaction.user.id && t.status === 'open' && guild.channels.cache.has(t.channelId));
    const max = Math.max(1, Number(cfg.maxOpenPerUser) || 1);
    if (open.length >= max) {
      return interaction.editReply({ content: `You already have ${open.length} open ticket(s): ${open.map((t) => `<#${t.channelId}>`).join(', ')}` });
    }

    const categoryId = type.categoryId || cfg.categoryId;
    const category = categoryId ? guild.channels.cache.get(categoryId) : null;
    if (categoryId && (!category || category.type !== ChannelType.GuildCategory)) {
      logger.warn('Tickets', `Configured category ${categoryId} is missing in ${guild.name}.`);
    }
    const supportRoles = [...new Set([...(cfg.supportRoles || []), ...(type.supportRoles || [])])].filter((r) => guild.roles.cache.has(r));
    const me = guild.members.me;

    gs.counter = (gs.counter || 0) + 1;
    const number = gs.counter;
    store.markDirty('state', 'tickets');

    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
      ...(me ? [{ id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] }] : []),
      ...supportRoles.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] })),
    ];

    let channel;
    try {
      channel = await guild.channels.create({
        name: formatName(type.namingFormat || cfg.namingFormat, { user: interaction.user, number, type }),
        type: ChannelType.GuildText,
        parent: category && category.type === ChannelType.GuildCategory ? category.id : undefined,
        permissionOverwrites: overwrites,
        topic: `Ticket #${number} • ${type.name} • opened by ${interaction.user.tag} (${interaction.user.id})`,
        reason: `Ticket opened by ${interaction.user.tag}`,
      });
    } catch (err) {
      logger.error('Tickets', 'Channel creation failed:', err.message);
      return interaction.editReply({ content: `I could not create the ticket channel: ${err.message}. Check that the Ticket Bot has **Manage Channels** and that the configured category still exists.` });
    }

    const record = {
      channelId: channel.id, userId: interaction.user.id, userTag: interaction.user.tag,
      typeId: type.id, typeName: type.name, number, status: 'open', claimedBy: '', claimedAt: 0,
      createdAt: Date.now(), notified: false, notificationId: '', notificationChannelId: '', controlMessageId: '',
    };
    gs.tickets[channel.id] = record;
    store.markDirty('state', 'tickets');

    const embed = new EmbedBuilder()
      .setColor(hex(cfg.panel.color))
      .setTitle(`${type.emoji ? `${type.emoji} ` : ''}${type.name} • Ticket #${String(number).padStart(4, '0')}`)
      .setDescription(type.welcome || 'A staff member will be with you shortly.')
      .addFields({ name: 'Opened by', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Type', value: type.name, inline: true })
      .setFooter({ text: cfg.panel.footer || 'Dziri System • Tickets' })
      .setTimestamp();
    const controlMessage = await channel.send({
      content: [`<@${interaction.user.id}>`, ...supportRoles.map((r) => `<@&${r}>`)].join(' '),
      embeds: [embed],
      components: [controlRow(record)],
      allowedMentions: { users: [interaction.user.id], roles: supportRoles },
    }).catch((e) => { logger.warn('Tickets', 'Welcome message failed:', e.message); return null; });
    if (controlMessage) { record.controlMessageId = controlMessage.id; store.markDirty('state', 'tickets'); }

    await notifyModerators(guild, record, type).catch((e) => logger.warn('Tickets', 'Notification failed:', e.message));
    await log(guild, 'created', record, { actor: interaction.user });
    return interaction.editReply({ content: `✅ Your ticket has been created: <#${channel.id}>` });
  } finally {
    setTimeout(() => creating.delete(guard), 3000);
  }
}

/** Exactly one notification per ticket — guarded by the persisted `notified` flag. */
async function notifyModerators(guild, record, type) {
  const cfg = cfgOf(guild.id);
  const n = cfg.notifications;
  if (!n.enabled || !n.channelId) return;
  const gs = gstate(guild.id);
  const stored = gs.tickets[record.channelId];
  if (stored && stored.notified) return;
  const channel = guild.channels.cache.get(n.channelId) || await guild.channels.fetch(n.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) { logger.warn('Tickets', 'Notification channel missing.'); return; }

  const embed = new EmbedBuilder()
    .setColor(hex(cfg.panel.color))
    .setTitle('🎟️ Untaken Ticket')
    .addFields(
      { name: 'Opened by', value: `<@${record.userId}> (${record.userTag})`, inline: true },
      { name: 'Ticket Type', value: `${type.emoji ? `${type.emoji} ` : ''}${record.typeName}`, inline: true },
      { name: 'Ticket', value: `<#${record.channelId}>`, inline: true },
    )
    .setFooter({ text: `Ticket #${String(record.number).padStart(4, '0')} • Dziri System` })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Ticket').setURL(`https://discord.com/channels/${guild.id}/${record.channelId}`),
    new ButtonBuilder().setCustomId(`${CID.accept}${record.channelId}`).setLabel('Accept Ticket').setEmoji('🙋').setStyle(ButtonStyle.Success),
  );
  const mentions = (n.mentionRoles || []).filter((r) => guild.roles.cache.has(r));
  const msg = await channel.send({ content: mentions.map((r) => `<@&${r}>`).join(' ') || undefined, embeds: [embed], components: [row], allowedMentions: { roles: mentions } });
  if (stored) {
    stored.notified = true;
    stored.notificationId = msg.id;
    stored.notificationChannelId = channel.id;
    store.markDirty('state', 'tickets');
    store.flushNow('state', 'tickets');
  }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function controlRow(record) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CID.claim).setLabel(record.claimedBy ? 'Claimed' : 'Claim').setEmoji('🙋').setStyle(ButtonStyle.Secondary).setDisabled(Boolean(record.claimedBy)),
    new ButtonBuilder().setCustomId(CID.close).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CID.transcript).setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
  );
}
function closedRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CID.reopen).setLabel('Reopen').setEmoji('🔓').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CID.transcript).setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CID.del).setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
}

function isSupport(member, cfg, record) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const type = (cfg.types || []).find((t) => t.id === (record && record.typeId));
  const roles = [...(cfg.supportRoles || []), ...((type && type.supportRoles) || [])];
  return roles.some((r) => member.roles.cache.has(r));
}

async function updateClaimedTicket(guild, record) {
  const channel = guild.channels.cache.get(record.channelId) || await guild.channels.fetch(record.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  if (record.controlMessageId) {
    const control = await channel.messages.fetch(record.controlMessageId).catch(() => null);
    if (control) await control.edit({ components: [controlRow(record)] }).catch(() => {});
  }
  await channel.send({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setDescription(`🙋 <@${record.claimedBy}> accepted this ticket.`)] }).catch(() => {});
}

async function deleteNotification(guild, record, interactionMessage) {
  // Older records did not store notificationChannelId; use the current configured channel as
  // a backward-compatible fallback without rewriting/resetting ticket data.
  const notificationChannelId = record.notificationChannelId || (cfgOf(guild.id).notifications || {}).channelId || '';
  const interactionChannelId = interactionMessage && (interactionMessage.channelId || (interactionMessage.channel && interactionMessage.channel.id));
  try {
    if (interactionMessage && interactionMessage.id === record.notificationId && interactionChannelId === notificationChannelId && typeof interactionMessage.delete === 'function') {
      await Promise.resolve(interactionMessage.delete()).catch(() => {});
    } else if (record.notificationId && notificationChannelId) {
      const channel = guild.channels.cache.get(notificationChannelId) || await guild.channels.fetch(notificationChannelId).catch(() => null);
      if (channel && channel.isTextBased() && channel.messages) {
        const message = await channel.messages.fetch(record.notificationId).catch(() => null);
        if (message && typeof message.delete === 'function') await Promise.resolve(message.delete()).catch(() => {});
      }
    }
  } catch { /* notification cleanup must never undo a successful claim */ }
  record.notificationId = '';
  record.notificationChannelId = '';
  store.markDirty('state', 'tickets');
}

/**
 * Acknowledge an interaction immediately (ephemeral deferred reply).
 * Discord allows 3 seconds — deferring first means slow work can never cause
 * "… didn't respond in time".
 */
async function ack(interaction) {
  if (interaction.deferred || interaction.replied) return true;
  try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); return true; }
  catch (err) { logger.warn('Tickets', 'Could not acknowledge interaction:', err.message); return false; }
}
const say = (interaction, content) => interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});

/** True when this interaction belongs to the ticket system. */
function owns(interaction) {
  const id = String(interaction.customId || '');
  return id === CID.open || id.startsWith('dz-ticket-');
}

async function handleInteraction(interaction) {
  if (!owns(interaction)) return false;
  if (!interaction.inGuild() || !interaction.guild) {
    if (interaction.isRepliable()) await interaction.reply({ content: 'Tickets only work inside a server.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  try {
    // ---- ticket panel select menu ----
    if (interaction.isStringSelectMenu() && interaction.customId === CID.open) {
      await ack(interaction);                       // acknowledged first, before ANY Discord call
      await createTicket(interaction, interaction.values[0]);
      resetPanelMenu(interaction);                  // fire-and-forget, never blocks the response
      return true;
    }
    if (!interaction.isButton()) return true;

    const gs = gstate(interaction.guild.id);
    const cfg = cfgOf(interaction.guild.id);

    // Accept directly from the moderator notification channel. The ticket channel ID is in
    // the component ID, so this never relies on message text or the notification channel ID.
    if (interaction.customId.startsWith(CID.accept)) {
      await ack(interaction);
      const ticketChannelId = interaction.customId.slice(CID.accept.length);
      const acceptRecord = gs.tickets[ticketChannelId];
      if (!acceptRecord) return say(interaction, 'This ticket no longer exists.');
      const staffMember = interaction.member && interaction.member.roles
        ? interaction.member
        : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!isSupport(staffMember, cfg, acceptRecord)) return say(interaction, 'Only configured ticket staff can accept tickets.');

      // Re-check immediately before writing. JavaScript executes this check + assignment as one
      // synchronous turn, so simultaneous clicks cannot assign two handlers.
      if (acceptRecord.claimedBy) return say(interaction, 'This ticket has already been accepted by another staff member.');
      acceptRecord.claimedBy = interaction.user.id;
      acceptRecord.claimedAt = Date.now();
      store.markDirty('state', 'tickets');
      store.flushNow('state', 'tickets');
      await updateClaimedTicket(interaction.guild, acceptRecord);
      await deleteNotification(interaction.guild, acceptRecord, interaction.message);
      store.flushNow('state', 'tickets');
      await say(interaction, `You accepted ticket #${acceptRecord.number}.`);
      await log(interaction.guild, 'claimed', acceptRecord, { actor: interaction.user });
      return true;
    }

    const record = gs.tickets[interaction.channelId];

    // Close confirmation buttons answer by updating the ephemeral prompt.
    if (interaction.customId === CID.cancel) { await interaction.update({ content: 'Cancelled.', components: [] }).catch(() => {}); return true; }

    if (!record) {
      await ack(interaction);
      await say(interaction, 'This channel is not a tracked ticket (it may have been created by another bot or removed from storage).');
      return true;
    }
    const member = interaction.member && interaction.member.roles
      ? interaction.member
      : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const staff = isSupport(member, cfg, record);
    const owner = interaction.user.id === record.userId;

    switch (interaction.customId) {
      case CID.claim: {
        await ack(interaction);
        if (!staff) return say(interaction, 'Only support staff can claim tickets.');
        if (record.claimedBy) return say(interaction, `Already claimed by <@${record.claimedBy}>.`);
        record.claimedBy = interaction.user.id;
        record.claimedAt = Date.now();
        store.markDirty('state', 'tickets');
        store.flushNow('state', 'tickets');
        await interaction.message.edit({ components: [controlRow(record)] }).catch(() => {});
        await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(hex(cfg.panel.color)).setDescription(`🙋 <@${interaction.user.id}> claimed this ticket.`)] }).catch(() => {});
        await deleteNotification(interaction.guild, record);
        store.flushNow('state', 'tickets');
        await say(interaction, 'You claimed this ticket.');
        return log(interaction.guild, 'claimed', record, { actor: interaction.user }).then(() => true);
      }
      case CID.close: {
        if (!staff && !owner) { await ack(interaction); return say(interaction, 'You cannot close this ticket.'); }
        if (record.status === 'closed') { await ack(interaction); return say(interaction, 'This ticket is already closed.'); }
        if (cfg.closeConfirm) {
          // A direct reply (not deferred) so the confirm buttons can update it later.
          await interaction.reply({
            content: 'Close this ticket?',
            flags: MessageFlags.Ephemeral,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(CID.confirm).setLabel('Yes, close').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(CID.cancel).setLabel('Cancel').setStyle(ButtonStyle.Secondary))],
          }).catch(() => {});
          return true;
        }
        await ack(interaction);
        await doClose(interaction, record, cfg);
        return true;
      }
      case CID.confirm: {
        await interaction.update({ content: 'Closing ticket…', components: [] }).catch(() => {});
        await doClose(interaction, record, cfg);
        return true;
      }
      case CID.reopen: {
        await ack(interaction);
        if (!staff) return say(interaction, 'Only support staff can reopen tickets.');
        record.status = 'open'; record.closedAt = 0; store.markDirty('state', 'tickets');
        await interaction.channel.permissionOverwrites.edit(record.userId, { ViewChannel: true, SendMessages: true }).catch(() => {});
        if (interaction.channel.name.startsWith('closed-')) await interaction.channel.setName(interaction.channel.name.replace(/^closed-/, '')).catch(() => {});
        await interaction.message.edit({ components: [controlRow(record)] }).catch(() => {});
        await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(0x22c55e).setDescription(`🔓 Ticket reopened by <@${interaction.user.id}>.`)] }).catch(() => {});
        await say(interaction, 'Ticket reopened.');
        return log(interaction.guild, 'reopened', record, { actor: interaction.user }).then(() => true);
      }
      case CID.del: {
        await ack(interaction);
        if (!staff) return say(interaction, 'Only support staff can delete tickets.');
        await say(interaction, 'Deleting this ticket in 5 seconds…');
        await interaction.channel.send({ content: '🗑️ This ticket will be deleted in 5 seconds.' }).catch(() => {});
        await deleteNotification(interaction.guild, record);
        await log(interaction.guild, 'deleted', record, { actor: interaction.user });
        delete gs.tickets[interaction.channelId];
        store.markDirty('state', 'tickets');
        setTimeout(() => interaction.channel.delete('Ticket deleted').catch(() => {}), 5000);
        return true;
      }
      case CID.transcript: {
        await ack(interaction);
        if (!staff && !owner) return say(interaction, 'You cannot export this ticket.');
        const file = await buildTranscript(interaction.channel, record);
        if (!file) return say(interaction, 'Could not build a transcript.');
        await interaction.editReply({ content: 'Transcript ready.', files: [file] }).catch(() => {});
        const logCh = cfg.logChannelId && interaction.guild.channels.cache.get(cfg.logChannelId);
        if (logCh && logCh.isTextBased()) {
          const copy = await buildTranscript(interaction.channel, record);
          if (copy) await logCh.send({ content: `📄 Transcript for ticket #${record.number} (<#${record.channelId}>)`, files: [copy] }).catch(() => {});
        }
        return true;
      }
      default: {
        await ack(interaction);
        return say(interaction, 'Unknown ticket action.');
      }
    }
  } catch (err) {
    logger.error('Tickets', 'Interaction failed:', err);
    // The interaction must never be left hanging, even on an unexpected error.
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: `Something went wrong: ${err.message}`, components: [] });
      else if (interaction.isRepliable()) await interaction.reply({ content: `Something went wrong: ${err.message}`, flags: MessageFlags.Ephemeral });
    } catch { /* ignore */ }
    return true;
  }
}

/** Reset the panel's select menu so it does not stay visually "selected". */
function resetPanelMenu(interaction) {
  setTimeout(() => {
    try {
      const msg = interaction.message;
      if (!msg || !msg.editable) return; // webhook-owned messages are refreshed on republish
      msg.edit({ components: msg.components }).catch(() => {});
    } catch { /* ignore */ }
  }, 0);
}

async function doClose(interaction, record, cfg) {
  record.status = 'closed'; record.closedAt = Date.now(); record.closedBy = interaction.user.id;
  store.markDirty('state', 'tickets');
  const channel = interaction.channel;
  await channel.permissionOverwrites.edit(record.userId, { SendMessages: false }).catch(() => {});
  if (!channel.name.startsWith('closed-')) await channel.setName(`closed-${channel.name}`.slice(0, 95)).catch(() => {});
  if (cfg.transcripts && cfg.logChannelId) {
    const logCh = interaction.guild.channels.cache.get(cfg.logChannelId);
    if (logCh && logCh.isTextBased()) {
      const file = await buildTranscript(channel, record);
      if (file) await logCh.send({ content: `📄 Transcript for ticket #${record.number}`, files: [file] }).catch(() => {});
    }
  }
  const embed = new EmbedBuilder().setColor(0xef4444).setDescription(`🔒 Ticket closed by <@${interaction.user.id}>.`).setTimestamp();
  if (interaction.deferred || interaction.replied) await interaction.editReply({ content: 'Ticket closed.', components: [] }).catch(() => {});
  await channel.send({ embeds: [embed], components: [closedRow()] }).catch(() => {});
  return log(interaction.guild, 'closed', record, { actor: interaction.user });
}

async function buildTranscript(channel, record) {
  try {
    const all = [];
    let before;
    for (let i = 0; i < 5; i++) {
      const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
      if (!batch || !batch.size) break;
      all.push(...batch.values());
      before = batch.last().id;
      if (batch.size < 100) break;
    }
    all.reverse();
    const lines = [
      `Dziri System — Ticket transcript`,
      `Ticket  : #${record.number} (${record.typeName})`,
      `Channel : #${channel.name} (${channel.id})`,
      `Opened  : ${new Date(record.createdAt).toISOString()} by ${record.userTag}`,
      `Messages: ${all.length}`,
      '='.repeat(60), '',
      ...all.map((m) => {
        const att = m.attachments.size ? ` [attachments: ${[...m.attachments.values()].map((a) => a.url).join(', ')}]` : '';
        const emb = m.embeds.length ? ` [${m.embeds.length} embed(s)]` : '';
        return `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content || ''}${emb}${att}`;
      }),
    ];
    return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `ticket-${record.number}.txt` });
  } catch (err) { logger.warn('Tickets', 'Transcript failed:', err.message); return null; }
}

async function log(guild, event, record, { actor } = {}) {
  try {
    const cfg = cfgOf(guild.id);
    if (!cfg.logChannelId) return;
    const channel = guild.channels.cache.get(cfg.logChannelId);
    if (!channel || !channel.isTextBased()) return;
    const colors = { created: 0x22c55e, claimed: 0x8b5cf6, closed: 0xef4444, reopened: 0xf59e0b, deleted: 0x64748b };
    const embed = new EmbedBuilder()
      .setColor(colors[event] || 0xa855f7)
      .setTitle(`🎟️ Ticket ${event}`)
      .addFields(
        { name: 'Ticket', value: `#${String(record.number).padStart(4, '0')} • ${record.typeName}`, inline: true },
        { name: 'Channel', value: event === 'deleted' ? `#${record.channelId}` : `<#${record.channelId}>`, inline: true },
        { name: 'Opened by', value: `<@${record.userId}>`, inline: true },
        ...(actor ? [{ name: 'Staff', value: `<@${actor.id}>`, inline: true }] : []),
      )
      .setTimestamp()
      .setFooter({ text: 'Dziri System • Tickets' });
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) { logger.warn('Tickets', 'Log failed:', err.message); }
}

/** Dashboard status: is the ticket bot usable here, and what is configured/open? */
function status(guildId) {
  const client = anyClient(guildId) || botRegistry.get('main');
  const connected = Boolean(client && client.isReady());
  const guild = connected ? client.guilds.cache.get(guildId) : null;
  const gs = gstate(guildId);
  const tickets = Object.values(gs.tickets);
  const cfg = cfgOf(guildId);
  const warnings = [];
  if (guild) {
    const miss = (id, what) => { if (id && !guild.channels.cache.has(id)) warnings.push(`The configured ${what} no longer exists.`); };
    miss(cfg.panel.channelId, 'ticket panel channel');
    miss(cfg.notifications.channelId, 'ticket notification channel');
    miss(cfg.logChannelId, 'ticket log channel');
    miss(cfg.categoryId, 'default ticket category');
    for (const t of cfg.types || []) if (t.categoryId && !guild.channels.cache.has(t.categoryId)) warnings.push(`The category for ticket type "${t.name}" no longer exists.`);
    for (const r of cfg.supportRoles || []) if (!guild.roles.cache.has(r)) warnings.push('A configured support role no longer exists.');
  }
  const sender = botRegistry.availability(guildId)[cfg.panel.senderBot === 'main' ? 'main' : 'ticket'];
  if (!sender.ready) warnings.push(`${sender.label} is selected as the panel sender but is not connected.`);
  else if (!sender.inGuild) warnings.push(`${sender.label} is selected as the panel sender but is not in this server.`);
  return {
    configured: Boolean(process.env.TICKET_DISCORD_TOKEN),
    connected,
    tag: connected ? client.user.tag : null,
    inGuild: Boolean(guild),
    bots: botRegistry.availability(guildId),
    panel: panelDelivery.info(guildId, 'tickets'),
    inviteUrl: process.env.TICKET_CLIENT_ID ? `https://discord.com/oauth2/authorize?client_id=${process.env.TICKET_CLIENT_ID}&permissions=292594113552&scope=bot%20applications.commands` : null,
    published: Boolean(cfg.panel.messageId),
    publishedAt: cfg.panel.publishedAt || 0,
    open: tickets.filter((t) => t.status === 'open').length,
    closed: tickets.filter((t) => t.status === 'closed').length,
    total: gs.counter || 0,
    warnings: [...new Set(warnings)],
    recent: tickets.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
  };
}

/** Drop records whose channel no longer exists (runs once per ticket-bot startup). */
function reconcile(client) {
  const s = state();
  let changed = false;
  for (const [guildId, gs] of Object.entries(s.guilds)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    for (const id of Object.keys(gs.tickets)) {
      if (!guild.channels.cache.has(id)) {
        const record = gs.tickets[id];
        deleteNotification(guild, record).catch(() => {});
        delete gs.tickets[id]; changed = true;
      }
    }
  }
  if (changed) store.markDirty('state', 'tickets');
}

module.exports = { publishPanel, handleInteraction, owns, status, reconcile, syncNotificationPermissions, panelPayload, CID };
