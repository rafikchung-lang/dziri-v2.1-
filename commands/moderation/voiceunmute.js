'use strict';
const mod = require('../../services/moderationService');

module.exports = {
  name: 'voiceunmute',
  label: 'Voice Unmute',
  category: 'moderation',
  description: 'Remove a voice (server) mute from a member.',
  defaultAliases: ['vunmute', 'فككتمصوت'],
  userPermissions: ['MuteMembers'],
  botPermissions: ['MuteMembers'],
  options: [
    { name: 'user', type: 'member', required: true, description: 'Member to voice-unmute' },
    { name: 'reason', type: 'rest', description: 'Reason' },
  ],
  async execute(ctx) {
    const target = ctx.args.user;
    const err = mod.hierarchyError(ctx.guild, ctx.member, target);
    if (err) return ctx.error(err);
    const reason = ctx.args.reason || 'No reason provided';
    const inVoice = Boolean(target.voice && target.voice.channelId);
    const ok = await mod.voiceUnmute(ctx.guild, target, ctx.member, { reason, cmdCfg: ctx.cfg });
    if (!ok && !inVoice) return ctx.error(`**${target.user.tag}** is not voice-muted.`);
    return ctx.success(`**${target.user.tag}** has been voice-unmuted.`, [{ name: 'Reason', value: reason }]);
  },
};
