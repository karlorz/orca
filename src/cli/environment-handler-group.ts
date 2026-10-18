import type { HandlerGroup } from './handler-group-manifest'

export const ENVIRONMENT_HANDLER_GROUP: HandlerGroup = {
  name: 'environment',
  keys: [
    'host name',
    'host list',
    'pairing offer',
    'environment add',
    'environment list',
    'environment show',
    'environment rm'
  ],
  load: async () => (await import('./handlers/environment.js')).ENVIRONMENT_HANDLERS
}
