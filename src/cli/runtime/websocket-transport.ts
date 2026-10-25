import {
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'
import { AGENT_SESSION_BOUND_CONTROL_CAPABILITY } from '../../shared/agent-session-bound-control'
import type { PairedRuntimeConnection } from '../../shared/paired-runtime-connection'
import type { RuntimeOrchestrationEnvelope } from '../../shared/runtime-rpc-envelope'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import { AGENT_LAUNCH_RUNTIME_CAPABILITY } from '../../shared/agent-launch-runtime-capability'
import {
  sendRemoteRuntimeRequest,
  sendRemoteRuntimeRequestWithStatusPreflight
} from '../../shared/remote-runtime-client'
import type { RuntimeStatus } from '../../shared/runtime-types'
import { RuntimeClientError, type RuntimeRpcResponse } from './types'

// Paired CLI callers are not exempt from the host's agent.launch gate like the local socket is.
const CLI_CLIENT_CAPABILITIES = [AGENT_LAUNCH_RUNTIME_CAPABILITY] as const

function agentSessionCapabilities(method: string): string[] {
  return method.startsWith('agentSession.')
    ? [
        ...CLI_CLIENT_CAPABILITIES,
        STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
        STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY,
        AGENT_SESSION_BOUND_CONTROL_CAPABILITY
      ]
    : [...CLI_CLIENT_CAPABILITIES]
}

export async function sendWebSocketRequest<TResult>(
  connection: PairedRuntimeConnection,
  method: string,
  params: unknown,
  timeoutMs: number,
  envelope?: RuntimeOrchestrationEnvelope
): Promise<RuntimeRpcResponse<TResult>> {
  try {
    return await sendRemoteRuntimeRequest<TResult>(
      connection,
      method,
      params,
      timeoutMs,
      envelope,
      undefined,
      agentSessionCapabilities(method)
    )
  } catch (error) {
    if (error instanceof RemoteRuntimeClientError) {
      throw new RuntimeClientError(error.code, error.message, error.data)
    }
    throw error
  }
}

export async function sendWebSocketRequestWithStatusPreflight<TResult>(
  connection: PairedRuntimeConnection,
  method: string,
  params: unknown,
  timeoutMs: number,
  validateStatus: (response: RuntimeRpcResponse<RuntimeStatus>) => void,
  envelope?: RuntimeOrchestrationEnvelope
): Promise<RuntimeRpcResponse<TResult>> {
  try {
    return await sendRemoteRuntimeRequestWithStatusPreflight<TResult>(
      connection,
      method,
      params,
      timeoutMs,
      validateStatus,
      envelope,
      agentSessionCapabilities(method)
    )
  } catch (error) {
    if (error instanceof RemoteRuntimeClientError) {
      throw new RuntimeClientError(error.code, error.message, error.data)
    }
    throw error
  }
}
