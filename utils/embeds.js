'use strict';
const { EmbedBuilder } = require('discord.js');

const COLORS = { brand: 0xa855f7, success: 0x22c55e, error: 0xef4444, warn: 0xf59e0b, info: 0x8b5cf6 };

function base(color) {
  return new EmbedBuilder().setColor(color).setFooter({ text: 'Dziri System' }).setTimestamp();
}
function success(text, fields) {
  const e = base(COLORS.success).setDescription(`✅ ${text}`);
  if (fields && fields.length) e.addFields(fields);
  return e;
}
function error(text) { return base(COLORS.error).setDescription(`⛔ ${text}`); }
function info(title, text) { const e = base(COLORS.info).setTitle(title); if (text) e.setDescription(text); return e; }

module.exports = { COLORS, base, success, error, info };
