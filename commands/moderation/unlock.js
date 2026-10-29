'use strict';
const { setLock } = require('../../utils/lockHelper');

module.exports = {
  name: 'unlock',
  label: 'Unlock',
  category: 'moderation',
  description: 'Unlock a previously locked channel.',
  defaultAliases: ['فتح'],
  userPermissions: ['ManageChannels'],
  botPermissions: ['ManageChannels'],
  options: [
    { name: 'channel', type: 'channel', description: 'Channel to unlock (default: current)' },
    { name: 'role', type: 'role', byName: false, description: 'Role to unlock the channel for' },
    { name: 'reason', type: 'rest', description: 'Reason' },
  ],
  execute(ctx) { return setLock(ctx, false); },
};
