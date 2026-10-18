import { createReadStream } from 'node:fs'
import { resolve } from 'node:path'
import { AgentSessionControlTargetParams } from '../shared/agent-session-bound-control'
import { CancelParams, SendParams } from '../shared/rpc-contract/structured-agent-session-params'
import { getOptionalStringFlag } from './flags'
import { RuntimeClientError } from './runtime/types'

const MAX_REQUEST_BYTES = 512 * 1024

export function decodeAgentSessionControlRequest(command: string, input: unknown) {
  const schema =
    command === 'control-target'
      ? AgentSessionControlTargetParams
      : command === 'follow-up'
        ? SendParams
        : CancelParams
  const decoded = schema.safeParse(input)
  if (
    !decoded.success ||
    (command !== 'control-target' &&
      (!('expectedControlTarget' in decoded.data) || !decoded.data.expectedControlTarget))
  ) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Malformed strict agent-session control request.'
    )
  }
  if (
    'envelope' in decoded.data &&
    'expectedControlTarget' in decoded.data &&
    decoded.data.expectedControlTarget
  ) {
    const target = decoded.data.expectedControlTarget
    if (
      decoded.data.envelope.sessionId !== target.sessionId ||
      decoded.data.envelope.expectedRuntimeFence !== target.runtimeFence ||
      ('delivery' in decoded.data && decoded.data.delivery) ||
      ('retryUnknown' in decoded.data && decoded.data.retryUnknown) ||
      ('scope' in decoded.data && decoded.data.scope) ||
      ('prompt' in decoded.data && decoded.data.prompt) ||
      ('taskId' in decoded.data && decoded.data.taskId) ||
      (command === 'stop' &&
        ('turnId' in decoded.data ? (decoded.data.turnId ?? null) : null) !== target.turnId)
    ) {
      throw new RuntimeClientError(
        'invalid_argument',
        'A strict request must name only its exact session, fence and turn.'
      )
    }
  }
  return decoded.data
}

export async function readAgentSessionControlRequest(
  flags: Map<string, string | boolean>,
  cwd: string
) {
  const inline = getOptionalStringFlag(flags, 'request')
  const file = getOptionalStringFlag(flags, 'request-file')
  if ((inline === undefined) === (file === undefined)) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Provide exactly one of --request or --request-file; use - for stdin.'
    )
  }
  let content = inline ?? ''
  if (file !== undefined) {
    if (file === '-' && process.stdin.isTTY) {
      throw new RuntimeClientError('invalid_argument', 'Pipe request JSON to stdin.')
    }
    const stream = file === '-' ? process.stdin : createReadStream(resolve(cwd, file))
    stream.setEncoding('utf8')
    let bytes = 0
    for await (const chunk of stream) {
      const part = String(chunk)
      bytes += Buffer.byteLength(part, 'utf8')
      if (bytes > MAX_REQUEST_BYTES) {
        stream.destroy()
        throw new RuntimeClientError('invalid_argument', 'Control request is too large.')
      }
      content += part
    }
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_REQUEST_BYTES) {
    throw new RuntimeClientError('invalid_argument', 'Control request is too large.')
  }
  try {
    return JSON.parse(content)
  } catch {
    throw new RuntimeClientError('invalid_argument', 'Control request must be JSON.')
  }
}
