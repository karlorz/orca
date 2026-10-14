import { AGENT_SESSION_BOUND_CONTROL_CAPABILITY } from '../../shared/agent-session-bound-control'
import {
  STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'
import {
  decodeAgentSessionControlRequest,
  readAgentSessionControlRequest
} from '../agent-session-control-request'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime/types'

function handler(command: string, method: string): CommandHandler {
  return async ({ client, flags, cwd, json }) => {
    const params = decodeAgentSessionControlRequest(
      command,
      await readAgentSessionControlRequest(flags, cwd)
    )
    const status = await client.getCliStatus()
    if (
      ![
        AGENT_SESSION_BOUND_CONTROL_CAPABILITY,
        STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
        STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY
      ].every((cap) => status.result.runtime.capabilities?.includes(cap))
    ) {
      throw new RuntimeClientError(
        'bound_control_unavailable',
        'The selected Orca host does not support bound Grok controls.'
      )
    }
    printResult(await client.call(method, params), json, (value) => JSON.stringify(value, null, 2))
  }
}

export const AGENT_SESSION_CONTROL_HANDLERS: Record<string, CommandHandler> = {
  'agent-session control-target': handler('control-target', 'agentSession.controlTarget'),
  'agent-session follow-up': handler('follow-up', 'agentSession.send'),
  'agent-session stop': handler('stop', 'agentSession.cancel')
}
