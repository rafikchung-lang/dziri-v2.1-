'use strict';
const { setLock } = require('../../utils/lockHelper');

module.exports = {
  name: 'lock',
  label: 'Lock',
  category: 'moderation',
  description: 'Lock a channel for a role (default: configured lock roles or @everyone).',
  defaultAliases: ['قفل'],
  userPermissions: ['ManageChannels'],
  botPermissions: ['ManageChannels'],
  options: [
    { name: 'channel', type: 'channel', description: 'Channel to lock (default: current)' },
    { name: 'role', type: 'role', byName: false, description: 'Role to lock the channel for' },
    { name: 'reason', type: 'rest', description: 'Reason' },
  ],
  execute(ctx) { return setLock(ctx, true); },
};
