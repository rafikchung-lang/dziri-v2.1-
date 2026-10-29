'use strict';
const mod = require('../../services/moderationService');
const historyService = require('../../services/historyService');
const loggingService = require('../../services/loggingService');

const FETCH_SIZE = 100;
const BULK_MAX_AGE = 14 * 86_400_000;

module.exports = {
  name: 'purge',
  label: 'Purge',
  category: 'moderation',
  description: 'Delete any requested number of messages in automatic Discord-safe batches, optionally from one user.',
  defaultAliases: ['clear', 'مسح'],
  userPermissions: ['ManageMessages'],
  botPermissions: ['ManageMessages', 'ReadMessageHistory'],
  options: [
    { name: 'amount', type: 'integer', required: true, min: 1, description: 'Number of messages to delete (processed automatically in batches)' },
    { name: 'user', type: 'user', description: 'Only delete messages from this user' },
  ],
  async execute(ctx) {
    const requested = ctx.args.amount;
    const user = ctx.args.user;
    await ctx.defer();
    const channel = ctx.channel;
    if (!channel || !channel.messages || typeof channel.messages.fetch !== 'function') return ctx.error('This channel does not support message deletion.');

    let deleted = 0;
    let failed = 0;
    let scanned = 0;
    let before;
    let exhausted = false;

    // Fetch at Discord's maximum page size. `before` is set before deleting the page so
    // pagination remains stable even while messages disappear underneath the loop.
    while (deleted < requested && !exhausted) {
      const fetched = await channel.messages.fetch({ limit: FETCH_SIZE, ...(before ? { before } : {}) }).catch(() => null);
      if (!fetched || !fetched.size) break;
      const page = [...fetched.values()];
      before = page[page.length - 1].id;
      exhausted = fetched.size < FETCH_SIZE;
      scanned += page.length;

      let candidates = page.filter((m) => {
        if (m.pinned) return false; // preserve the existing purge behaviour
        if (ctx.source === 'prefix' && m.id === ctx.message.id) return false;
        if (ctx.source === 'slash' && ((m.interaction && m.interaction.id === ctx.interaction.id) || (m.interactionMetadata && m.interactionMetadata.id === ctx.interaction.id))) return false;
        if (user && (!m.author || m.author.id !== user.id)) return false;
        return true;
      });
      candidates = candidates.slice(0, requested - deleted);
      if (!candidates.length) continue;

      // Discord bulk-delete accepts at most 100 messages and rejects messages >= 14 days old.
      // Use a safety margin around the boundary, then delete older messages individually.
      const bulkCutoff = Date.now() - BULK_MAX_AGE + 60_000;
      const recent = candidates.filter((m) => m.createdTimestamp > bulkCutoff);
      const old = candidates.filter((m) => m.createdTimestamp <= bulkCutoff);

      if (recent.length) {
        try {
          const result = await channel.bulkDelete(recent.slice(0, 100), true);
          deleted += result ? result.size : 0;
          failed += recent.length - (result ? result.size : 0);
        } catch {
          // If a page crosses Discord's age boundary or bulk deletion otherwise fails,
          // fall back to individual deletion instead of aborting the whole command.
          for (const message of recent) {
            try { await message.delete(); deleted++; } catch { failed++; }
          }
        }
      }
      for (const message of old) {
        try { await message.delete(); deleted++; } catch { failed++; }
      }
    }

    if (ctx.source === 'prefix') ctx.message.delete().catch(() => {});
    const suffix = user ? ` from **${user.tag}**` : '';
    const shortfall = Math.max(0, requested - deleted);
    historyService.add(ctx.guild.id, {
      type: 'purge', targetId: user ? user.id : '', targetTag: user ? user.tag : `#${channel.name}`,
      moderatorId: ctx.user.id, moderatorTag: ctx.user.tag,
      reason: `Requested ${requested}; deleted ${deleted} message(s) in #${channel.name}${failed ? `; ${failed} failed` : ''}`,
    });
    if (ctx.cfg.log) {
      await loggingService.log(ctx.guild, 'moderation', {
        title: mod.LABELS.purge, user: ctx.user,
        fields: [
          { name: 'Channel', value: `<#${channel.id}>` },
          { name: 'Requested', value: String(requested) },
          { name: 'Deleted', value: String(deleted) },
          { name: 'Failed', value: String(failed) },
          { name: 'Messages scanned', value: String(scanned) },
          ...(user ? [{ name: 'Filtered user', value: `<@${user.id}>` }] : []),
        ],
      });
    }
    await ctx.success(`Deleted **${deleted}** message(s)${suffix}.${shortfall ? ` **${shortfall}** requested message(s) were not found or could not be deleted.` : ''}`,
      failed ? [{ name: 'Deletion failures', value: String(failed), inline: true }] : undefined);
    if (ctx.source === 'prefix' && ctx.botMessage) setTimeout(() => ctx.botMessage.delete().catch(() => {}), 5000);
  },
};
