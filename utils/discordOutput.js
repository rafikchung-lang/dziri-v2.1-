'use strict';
/** Discord-limit-aware output: one message whenever possible, minimum splits otherwise. */
const { EmbedBuilder, MessageFlags } = require('discord.js');

const DESC_LIMIT = 3900;
const MESSAGE_EMBED_TEXT_LIMIT = 5750; // Discord aggregate limit is 6000; leave room for titles/footers.

function splitText(text, limit = DESC_LIMIT) {
  const out = [];
  let rest = String(text || '');
  while (rest.length > limit) {
    let at = rest.lastIndexOf('\n\n', limit);
    if (at < Math.floor(limit * 0.5)) at = rest.lastIndexOf('\n', limit);
    if (at < Math.floor(limit * 0.5)) at = limit;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\s+/, '');
  }
  if (rest) out.push(rest);
  return out.length ? out : ['No records found.'];
}

function pack(chunks) {
  const groups = [];
  let group = []; let chars = 0;
  for (const chunk of chunks) {
    if (group.length && (chars + chunk.length > MESSAGE_EMBED_TEXT_LIMIT || group.length >= 10)) {
      groups.push(group); group = []; chars = 0;
    }
    group.push(chunk); chars += chunk.length;
  }
  if (group.length) groups.push(group);
  return groups;
}

async function sendLongEmbeds(ctx, { title, text, color = 0xa855f7, thumbnail = '', footer = 'Dziri System' }) {
  const groups = pack(splitText(text));
  const payloads = groups.map((chunks, gi) => ({
    embeds: chunks.map((chunk, ci) => {
      const e = new EmbedBuilder().setColor(color).setDescription(chunk);
      if (ci === 0) e.setTitle(groups.length > 1 ? `${title} • Part ${gi + 1}/${groups.length}` : title);
      if (gi === 0 && ci === 0 && thumbnail) e.setThumbnail(thumbnail);
      if (ci === chunks.length - 1) e.setFooter({ text: footer });
      return e;
    }),
    allowedMentions: { parse: [] },
  }));

  await ctx.respond(payloads[0]);
  for (let i = 1; i < payloads.length; i++) {
    if (ctx.source === 'slash') {
      await ctx.interaction.followUp({ ...payloads[i], flags: ctx.cfg.ephemeral ? MessageFlags.Ephemeral : undefined }).catch(() => {});
    } else {
      await ctx.channel.send(payloads[i]).catch(() => {});
    }
  }
  return payloads.length;
}

module.exports = { splitText, pack, sendLongEmbeds, DESC_LIMIT, MESSAGE_EMBED_TEXT_LIMIT };
