'use strict';
/**
 * Crime/punishment views over the EXISTING Dziri System history + mute/ban state.
 * No new punishment database is created.
 */
const store = require('../database/store');
const configService = require('./configService');
const historyService = require('./historyService');
const { parseDuration, formatDuration } = require('../utils/duration');

const PUNISHMENT_TYPES = new Set(['textmute', 'voicemute', 'ban', 'kick', 'warn', 'automod']);
const LABELS = {
  textmute: '🔇 Text Mute', voicemute: '🎙️ Voice Mute', ban: '🔨 Ban', kick: '👢 Kick',
  warn: '⚠️ Warning', automod: '🛡️ AutoMod', textunmute: '🔊 Text Unmute', voiceunmute: '🎙️ Voice Unmute', unban: '♻️ Unban',
};

function muteState() {
  const s = store.read('state', 'mutes', () => ({ text: [], voice: [], bans: [] }));
  if (!Array.isArray(s.text)) s.text = [];
  if (!Array.isArray(s.voice)) s.voice = [];
  if (!Array.isArray(s.bans)) s.bans = [];
  return s;
}

/** All target history, newest first (history is already capped at 5000/guild). */
function allTargetRecords(guildId, userId) {
  return historyService.query(guildId, { page: 1, pageSize: 5000 }).items.filter((e) => e.targetId === userId);
}

/** All recorded punishments for this target, newest first. */
function records(guildId, userId) {
  return allTargetRecords(guildId, userId).filter((e) => PUNISHMENT_TYPES.has(e.type));
}

const latest = (items, types) => items.find((e) => types.includes(e.type)) || null;
const detailsAction = (e, action) => e && String(e.details || '').toLowerCase().includes(`action: ${action}`);

/** Return authoritative currently-active punishments, newest first. */
async function activePunishments(guild, userId) {
  const now = Date.now();
  const state = muteState();
  const history = records(guild.id, userId);
  const active = [];
  const member = await guild.members.fetch(userId).catch(() => null);

  // Text timeout (Discord is authoritative). AutoMod timeouts are represented by the existing
  // automod history record; manual/command timeouts use textmute.
  const timeoutEnd = member && member.communicationDisabledUntilTimestamp > now ? member.communicationDisabledUntilTimestamp : 0;
  const roleId = configService.getGuildConfig(guild.id).moderation.muteRoleId;
  const hasMuteRole = Boolean(member && roleId && member.roles.cache.has(roleId));
  const textState = state.text.find((m) => m.guildId === guild.id && m.userId === userId && (!m.until || m.until > now));
  if (timeoutEnd || hasMuteRole || textState) {
    const source = history.find((e) => e.type === 'textmute' || (e.type === 'automod' && detailsAction(e, 'timeout'))) || null;
    active.push(fromRecord(source, {
      type: source && source.type === 'automod' ? 'automod' : 'textmute',
      endAt: timeoutEnd || (textState && textState.until > 0 ? textState.until : null),
    }));
  }

  // Voice mute state is persisted by the existing moderation service and survives restarts.
  const voiceState = state.voice.find((m) => m.guildId === guild.id && m.userId === userId && !m.pendingUnmute && (m.until === 0 || m.until > now));
  if (voiceState) {
    const source = latest(history, ['voicemute']);
    active.push(fromRecord(source, { type: 'voicemute', endAt: voiceState.until > 0 ? voiceState.until : null }));
  }

  // Temporary bans are in state; permanent bans are verified against Discord itself.
  const banState = state.bans.find((b) => b.guildId === guild.id && b.userId === userId && b.until > now);
  let isBanned = Boolean(banState);
  if (!isBanned && guild.bans && typeof guild.bans.fetch === 'function') isBanned = Boolean(await guild.bans.fetch(userId).catch(() => null));
  if (isBanned) {
    const source = latest(history, ['ban']);
    active.push(fromRecord(source, { type: 'ban', endAt: banState ? banState.until : null }));
  }

  return active.sort((a, b) => b.startAt - a.startAt);
}

function fromRecord(record, override) {
  return {
    historyId: record ? record.id : 0,
    type: override.type,
    label: LABELS[override.type] || override.type,
    reason: record && record.reason ? record.reason : 'No reason recorded',
    duration: record && record.duration ? record.duration : (override.endAt ? formatDuration(override.endAt - (record ? record.at : Date.now())) : 'permanent'),
    moderatorId: record ? record.moderatorId : '',
    moderatorTag: record ? record.moderatorTag : '',
    startAt: record ? record.at : Date.now(),
    endAt: override.endAt || null,
  };
}

function inferredEnd(record) {
  if (!record.duration || /perm/i.test(record.duration)) return null;
  const ms = parseDuration(record.duration);
  return ms && ms > 0 ? record.at + ms : null;
}

/** Infer the historical status without changing stored records. */
function statusFor(record, allRecords, active) {
  if (active.some((a) => a.historyId && a.historyId === record.id)) return 'Active';
  const newer = (type) => allRecords.some((e) => e.at > record.at && e.type === type);
  if (record.type === 'textmute' && newer('textunmute')) return 'Ended';
  if (record.type === 'voicemute' && newer('voiceunmute')) return 'Ended';
  if (record.type === 'ban' && newer('unban')) return 'Ended';
  const end = inferredEnd(record);
  if (end && end <= Date.now()) return 'Expired';
  if (record.type === 'kick') return 'Completed';
  if (record.type === 'warn' || record.type === 'automod') return 'Recorded';
  return 'Ended';
}

function formatRecord(record, index, allRecords, active) {
  const endAt = inferredEnd(record);
  const status = statusFor(record, allRecords, active);
  const moderator = record.moderatorId ? `<@${record.moderatorId}>` : (record.moderatorTag || '—');
  return [
    `**${index + 1}. ${LABELS[record.type] || record.type} — ${status}**`,
    `Date: <t:${Math.floor(record.at / 1000)}:F>`,
    `Reason: ${record.reason || '—'}`,
    record.duration ? `Duration: ${record.duration === 'permanent' ? 'Permanent' : record.duration}` : '',
    endAt ? `End: <t:${Math.floor(endAt / 1000)}:F> (${endAt > Date.now() ? `<t:${Math.floor(endAt / 1000)}:R>` : 'ended'})` : '',
    `Moderator: ${moderator}`,
    record.details ? `Details: ${record.details}` : '',
  ].filter(Boolean).join('\n');
}

function remainingText(active) {
  if (!active.endAt) return 'Permanent';
  return active.endAt <= Date.now() ? 'Expired' : formatDuration(active.endAt - Date.now());
}

module.exports = { PUNISHMENT_TYPES, LABELS, allTargetRecords, records, activePunishments, statusFor, formatRecord, remainingText, inferredEnd };
