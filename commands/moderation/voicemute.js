'use strict';
const mod = require('../../services/moderationService');

module.exports = {
  name: 'voicemute',
  label: 'Voice Mute',
  category: 'moderation',
  description: 'Server-mute a member in voice channels for a configured duration.',
  defaultAliases: ['vmute', 'كتمصوت'],
  userPermissions: ['MuteMembers'],
  botPermissions: ['MuteMembers'],
  defaultDuration: '10m',
  reasons: {
    durations: true,
    defaults: [
      { label: 'Mic spam / loud noises', duration: '10m' },
      { label: 'Insulting in voice', duration: '30m' },
      { label: 'Music / soundboard abuse', duration: '15m' },
    ],
  },
  options: [
    { name: 'user', type: 'member', required: true, description: 'Member to voice-mute' },
    { name: 'duration', type: 'duration', description: 'Override duration (e.g. 10m, 1h, permanent)' },
    { name: 'reason', type: 'rest', description: 'Reason (leave empty to pick from the menu)' },
  ],
  async execute(ctx) {
    const target = ctx.args.user;
    const err = mod.hierarchyError(ctx.guild, ctx.member, target);
    if (err) return ctx.error(err);
    const r = await mod.pickReason(ctx, { usesDuration: true, title: `Voice mute — ${target.user.tag}` });
    if (!r) return;
    const applied = await mod.voiceMute(ctx.guild, target, ctx.member, { reason: r.reason, durationMs: r.durationMs, durationStr: r.durationStr, cmdCfg: ctx.cfg });
    return ctx.success(`**${target.user.tag}** has been voice-muted.${applied ? '' : ' They are not in voice — the mute will apply when they join.'}`, [
      { name: 'Reason', value: r.reason, inline: true },
      { name: 'Duration', value: r.durationStr === 'permanent' ? 'Permanent' : r.durationStr, inline: true },
    ]);
  },
};
