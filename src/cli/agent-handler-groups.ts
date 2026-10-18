import type { HandlerGroup } from './handler-group-manifest'

// Why: split out so handler-group-manifest.ts stays under the max-lines lint cap.
export const AGENT_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'agent-session-control',
    keys: ['agent-session control-target', 'agent-session follow-up', 'agent-session stop'],
    load: async () =>
      (await import('./handlers/agent-session-control.js')).AGENT_SESSION_CONTROL_HANDLERS
  },
  {
    name: 'agent-hooks',
    keys: ['agent hooks prepare-codex', 'agent hooks status', 'agent hooks off', 'agent hooks on'],
    load: async () => (await import('./handlers/agent-hooks.js')).AGENT_HOOK_HANDLERS
  },
  {
    name: 'agent-launch',
    keys: ['agent launch'],
    load: async () => (await import('./handlers/agent-launch.js')).AGENT_LAUNCH_HANDLERS
  }
]
