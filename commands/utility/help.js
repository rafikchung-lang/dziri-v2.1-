'use strict';
const configService = require('../../services/configService');
const { sendLongEmbeds } = require('../../utils/discordOutput');

module.exports = {
  name: 'help',
  label: 'Help',
  category: 'utility',
  description: 'List all enabled Dziri System commands with this server’s prefix and aliases.',
  defaultAliases: ['مساعدة'],
  options: [],
  async execute(ctx) {
    // Lazy require avoids a circular import at module load.
    const commandService = require('../../services/commandService');
    const prefix = configService.getPrefix(ctx.guild.id);
    const lines = commandService.allCommands().map((def) => {
      const cfg = commandService.getCommandConfig(ctx.guild.id, def);
      if (!cfg.enabled) return null;
      const al = cfg.aliases.length ? ` — ${cfg.aliases.map((a) => `\`${prefix}${a}\``).join(' ')}` : '';
      return `**/${def.name}** \`${prefix}${def.name}\`${al}\n${def.description}`;
    }).filter(Boolean);
    const prefixText = prefix === '' ? '*(empty — type the command or alias directly)*' : `\`${prefix}\``;
    return sendLongEmbeds(ctx, {
      title: 'Dziri System — Commands',
      text: `Prefix: ${prefixText}\n\n${lines.join('\n\n')}`,
      footer: `Dziri System • ${lines.length} enabled commands`,
    });
  },
};
