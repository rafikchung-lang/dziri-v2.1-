'use strict';
/**
 * Default guild configuration. Every guild gets its own deep copy (guild-specific settings).
 * Command defaults (aliases / reasons) come from the command modules themselves
 * (single source of truth = the command registry).
 */
function defaultGuildConfig() {
  return {
    version: 1,
    prefix: '!',
    commands: {}, // name -> { enabled, aliases[], reasons[], allowedRoles[], allowedChannels[], log, deleteTrigger, ephemeral, dmTarget }
    moderation: {
      muteMode: 'timeout', // "timeout" (Discord timeout) | "role"
      muteRoleId: '',
      defaultMuteDuration: '10m',
      defaultVoiceMuteDuration: '10m',
      dmOnAction: true,
      requireReason: true,
      modRoles: [],
      lockRoles: [], // roles affected by /lock when none given (empty = @everyone)
      protectedRoles: [],
    },
    automod: {
      enabled: false,
      exemptRoles: [],
      exemptChannels: [],
      logChannelId: '',
      messageCleanup: {
        temporaryRooms: {
          enabled: true,
          intervalValue: 24,
          intervalUnit: 'hours',
        },
        publicVoice: {
          enabled: false,
          channelIds: [],
          intervalValue: 24,
          intervalUnit: 'hours',
        },
      },
      rules: {
        antiSpam: { enabled: false, threshold: 6, interval: 5, action: 'timeout', duration: '5m' },
        antiLink: { enabled: false, action: 'delete', duration: '5m', allowedDomains: ['discord.com', 'tenor.com'] },
        antiInvite: { enabled: false, action: 'delete', duration: '10m' },
        badWords: { enabled: false, action: 'delete', duration: '5m', words: [] },
        mentionSpam: { enabled: false, threshold: 5, action: 'timeout', duration: '10m' },
        caps: { enabled: false, threshold: 70, minLength: 10, action: 'delete', duration: '5m' },
        duplicates: { enabled: false, threshold: 3, interval: 30, action: 'delete', duration: '5m' },
      },
    },
    logging: {
      enabled: true,
      defaultChannelId: '',
      ignoredChannels: [],
      retentionDays: 0, // 0 = disabled; otherwise Discord log messages + local log files older than this are removed
      events: {
        messageDelete: { enabled: true, channelId: '' },
        messageEdit: { enabled: true, channelId: '' },
        memberJoin: { enabled: true, channelId: '' },
        memberLeave: { enabled: true, channelId: '' },
        nicknameChange: { enabled: true, channelId: '' },
        roleChange: { enabled: true, channelId: '' },
        voiceJoinLeave: { enabled: true, channelId: '' },
        voiceMove: { enabled: true, channelId: '' },
        voiceState: { enabled: true, channelId: '' },
        ban: { enabled: true, channelId: '' },
        unban: { enabled: true, channelId: '' },
        kick: { enabled: true, channelId: '' },
        moderation: { enabled: true, channelId: '' },
        automod: { enabled: true, channelId: '' },
      },
    },
    leveling: {
      enabled: true,
      textXpMin: 15,
      textXpMax: 25,
      textCooldown: 60,
      voiceXpPerMinute: 10,
      voiceRequireOthers: true,
      ignoredChannels: [],
      ignoredRoles: [],
      rewards: [], // { level, roleId }
      stackRewards: true,
      levelUpMessages: false, // OFF by default — no "🎉 reached level X" spam
      levelUpChannelId: '',
      levelUpTemplate: '{user} reached level {level}.',
    },
    rankCard: defaultRankCard(),
    // Custom names for individual Discord roles (NOT command aliases — separate system).
    // [{ roleId: '123', names: ['ods', 'أوديسي'] }]  — roleId is the permanent reference.
    roleNames: [],
    tickets: defaultTickets(),
    tempRooms: defaultTempRooms(),
    autoRole: {
      enabled: false,
      roleIds: [], // actual Discord role IDs, assigned to new non-bot members
    },
    // Member Messaging format (Dashboard → Moderation → Member Messaging). Persisted per guild.
    // Independent from the delivery method (normal bot DM vs webhook) — a webhook is HOW the
    // message is sent, an embed is the FORMAT of the message.
    messaging: {
      messageType: 'normal',                 // 'normal' (plain message) | 'embed' (text inside an embed)
      embedColor: '#a855f7',
      footerEnabled: true,                   // false → never add a footer
      footerText: 'Sent from {server} via {bot}', // '' (empty) → no footer even when enabled
    },
    dashboard: {
      accent: '#a855f7',
      compact: false,
    },
  };
}

function defaultTickets() {
  return {
    enabled: false,
    supportRoles: [],
    categoryId: '',
    namingFormat: 'ticket-{username}',
    maxOpenPerUser: 1,
    closeConfirm: true,
    transcripts: true,
    logChannelId: '',
    panel: {
      channelId: '',
      senderBot: 'ticket',   // 'ticket' | 'main' — the bot that SENDS and therefore HANDLES this panel
      delivery: 'message',   // 'message' (normal bot message) | 'webhook' (application-owned webhook)
      title: 'Support Tickets',
      description: 'Welcome! Choose the type of ticket you need below and our team will help you shortly.',
      color: '#a855f7',
      footer: 'Dziri System • Tickets',
      image: '',             // uploaded file in data/uploads
      imageUrl: '',          // or an external image URL
      thumbnailUrl: '',
      selectPlaceholder: 'Click to open a ticket',
      messageId: '',
      publishedChannelId: '',
      publishedAt: 0,
      publishedBy: '',
      publishedMode: '',
    },
    notifications: {
      enabled: true,
      channelId: '',
      mentionRoles: [],
      syncPermissions: true,
    },
    // No built-in ticket types: the dashboard configuration is the ONLY source of truth.
    types: [],
  };
}

function defaultTempRooms() {
  return {
    enabled: false,
    joinChannelId: '',
    categoryId: '',
    nameFormat: "{username}'s Room",
    defaultUserLimit: 0,
    defaultLocked: false,
    staffRoles: [],
    deleteWhenEmpty: true,
    emptyGraceSeconds: 5,
    maxRoomsPerUser: 1,
    allowRename: true,
    logChannelId: '',
    chatCleanup: {
      enabled: true,
      retentionHours: 24,
    },
    panel: {
      channelId: '',
      senderBot: 'main',     // 'main' | 'ticket' — the bot that SENDS and therefore HANDLES this panel
      delivery: 'message',   // 'message' | 'webhook'
      title: 'Temporary Room Control',
      description: 'Use the buttons below to control the temporary voice room you own.',
      color: '#a855f7',
      footer: 'Dziri System • Temporary Rooms',
      image: '',
      imageUrl: '',
      thumbnailUrl: '',
      messageId: '',
      publishedChannelId: '',
      publishedAt: 0,
      publishedBy: '',
      publishedMode: '',
      buttons: defaultRoomButtons(),
    },
  };
}

/**
 * Every control-panel action the backend can actually execute.
 * The dashboard may only configure buttons whose action is in this list.
 */
const ROOM_ACTIONS = {
  rename:     { label: 'Rename Room',        emoji: '✏️', style: 'primary'   },
  lock:       { label: 'Lock Room',          emoji: '🔒', style: 'danger'    },
  unlock:     { label: 'Unlock Room',        emoji: '🔓', style: 'secondary' },
  hide:       { label: 'Hide Room',          emoji: '🙈', style: 'secondary' },
  unhide:     { label: 'Unhide Room',        emoji: '👁️', style: 'secondary' },
  limit:      { label: 'Set User Limit',     emoji: '🔢', style: 'secondary' },
  limitUp:    { label: 'Increase Limit',     emoji: '➕', style: 'secondary' },
  limitDown:  { label: 'Decrease Limit',     emoji: '➖', style: 'secondary' },
  allow:      { label: 'Allow User',         emoji: '✅', style: 'success'   },
  deny:       { label: 'Deny User',          emoji: '⛔', style: 'danger'    },
  kick:       { label: 'Disconnect User',    emoji: '👢', style: 'danger'    },
  claim:      { label: 'Transfer Ownership', emoji: '👑', style: 'secondary' },
  remove:     { label: 'Delete Room',        emoji: '🗑️', style: 'danger'    },
};
const ROOM_BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger'];

/**
 * Default control-panel buttons (Arabic labels, matching the reference layout).
 * Fully editable in the dashboard: label, emoji, style, order, enabled, add/delete.
 */
function defaultRoomButtons() {
  return [
    { id: 'b-lock',      action: 'lock',      label: 'قفل',          emoji: '🔒', style: 'danger',    enabled: true },
    { id: 'b-unlock',    action: 'unlock',    label: 'أفتح',         emoji: '🔓', style: 'secondary', enabled: true },
    { id: 'b-hide',      action: 'hide',      label: 'اخفي',         emoji: '🙈', style: 'secondary', enabled: true },
    { id: 'b-unhide',    action: 'unhide',    label: 'أظهر',         emoji: '👁️', style: 'secondary', enabled: true },
    { id: 'b-allow',     action: 'allow',     label: 'سماح',         emoji: '✅', style: 'success',   enabled: true },
    { id: 'b-deny',      action: 'deny',      label: 'حظر',          emoji: '⛔', style: 'danger',    enabled: true },
    { id: 'b-kick',      action: 'kick',      label: 'طرد',          emoji: '👢', style: 'danger',    enabled: true },
    { id: 'b-limit',     action: 'limit',     label: 'الحد',         emoji: '🔢', style: 'secondary', enabled: true },
    { id: 'b-rename',    action: 'rename',    label: 'الاسم',        emoji: '✏️', style: 'primary',   enabled: true },
    { id: 'b-claim',     action: 'claim',     label: 'نقل الملكية',  emoji: '👑', style: 'secondary', enabled: true },
    { id: 'b-remove',    action: 'remove',    label: 'حذف الروم',    emoji: '🗑️', style: 'danger',    enabled: true },
  ];
}

function defaultRankCard() {
  return {
    backgroundType: 'gradient', // gradient | color | image
    backgroundColor: '#0d0716',
    gradientFrom: '#1a0b2e',
    gradientTo: '#3b0f6b',
    backgroundImage: '', // filename in data/uploads
    overlayOpacity: 0.45,
    blurPanel: true,
    panelOpacity: 0.32,
    accentColor: '#a855f7',
    accentColor2: '#ec4899',
    textColor: '#ffffff',
    subTextColor: '#c4b5fd',
    trackColor: '#ffffff1f',
    avatarShape: 'circle', // circle | rounded | square
    avatarRing: true,
    avatarGlow: true,
    layout: 'left', // left | right
    progressStyle: 'rounded', // rounded | sharp
    title: 'DZIRI SYSTEM',
    showTitle: true,
    showRank: true,
    showLevel: true,
    showXp: true,
    showTextVoice: true,
    showDiscriminatorTag: true,
  };
}

module.exports = { defaultGuildConfig, defaultRankCard, defaultTickets, defaultTempRooms, defaultRoomButtons, ROOM_ACTIONS, ROOM_BUTTON_STYLES };
