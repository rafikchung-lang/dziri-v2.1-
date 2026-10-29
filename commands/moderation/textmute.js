'use strict';
const mod = require('../../services/moderationService');

module.exports = {
  name: 'textmute',
  label: 'Text Mute',
  category: 'moderation',
  description: 'Text-mute a member (timeout or mute role) using a configured reason and duration.',
  defaultAliases: ['mute', 'كتم'],
  userPermissions: ['ModerateMembers'],
  botPermissions: ['ModerateMembers'],
  defaultDuration: '10m',
  reasons: {
    durations: true,
    defaults: [
      { label: 'Spamming', duration: '10m' },
      { label: 'Advertising', duration: '1h' },
      { label: 'Insulting', duration: '30m' },
      { label: 'Harassment', duration: '2h' },
    ],
  },
  options: [
    { name: 'user', type: 'member', required: true, description: 'Member to text-mute' },
    { name: 'duration', type: 'duration', description: 'Override duration (e.g. 10m, 1h, 7d, permanent)' },
    { name: 'reason', type: 'rest', description: 'Reason (leave empty to pick from the menu)' },
  ],
  async execute(ctx) {
    const target = ctx.args.user;
    const err = mod.hierarchyError(ctx.guild, ctx.member, target);
    if (err) return ctx.error(err);
    const r = await mod.pickReason(ctx, { usesDuration: true, title: `Text mute — ${target.user.tag}` });
    if (!r) return;
    const dur = await mod.textMute(ctx.guild, target, ctx.member, { reason: r.reason, durationMs: r.durationMs, durationStr: r.durationStr, cmdCfg: ctx.cfg });
    return ctx.success(`**${target.user.tag}** has been text-muted.`, [
      { name: 'Reason', value: r.reason, inline: true },
      { name: 'Duration', value: dur === 'permanent' ? 'Permanent' : dur || '—', inline: true },
    ]);
  },
};
