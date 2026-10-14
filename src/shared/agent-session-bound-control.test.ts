import { describe, expect, it } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from './agent-session-mutation-envelope'
import {
  AgentSessionControlReceiptSchema,
  AgentSessionControlTargetSchema
} from './agent-session-bound-control'

const target = {
  executionHostId: 'local',
  runtimeId: 'runtime-1',
  sessionId: 'session-1',
  provider: 'grok',
  nativeSessionId: 'native-1',
  turnId: null,
  runtimeFence: 7,
  acquisitionGeneration: 'child-1',
  revision: 3,
  token: 'token-1'
} as const

describe('public bound control fingerprints and strict decoding', () => {
  it.each([
    {
      name: 'Unicode idle Follow up',
      method: 'agentSession.send',
      fields: {
        body: {
          kind: 'message',
          role: 'user',
          blocks: [{ type: 'text', text: 'Hello / 你好 👋\n"quoted" \\ $(literal)' }]
        },
        expectedControlTarget: target
      },
      digest: '23922e14db5a9c0918f64005b6c225641d7a8286d16a9c8ce06357658e641ad0'
    },
    {
      name: 'idle Stop',
      method: 'agentSession.cancel',
      fields: { expectedControlTarget: target },
      digest: '5408163bfcbb0d2fe8bf8ae30337aa7e97a11feadecaeb0b14e56620cf8c75e5'
    },
    {
      name: 'active Stop',
      method: 'agentSession.cancel',
      fields: { turnId: 'turn-42', expectedControlTarget: { ...target, turnId: 'turn-42' } },
      digest: '854a6ac010ec94ab44e60ca167396b386fdd328cea855af59dcda40c45ba0ebe'
    }
  ])('matches the client golden vector for $name', ({ method, fields, digest }) => {
    expect(computeAgentSessionPayloadFingerprint({ method, sessionId: 'session-1', fields })).toBe(
      digest
    )
  })

  it('rejects partial, unknown-field and provider-mismatched targets and receipts', () => {
    expect(AgentSessionControlTargetSchema.safeParse(target).success).toBe(true)
    expect(
      AgentSessionControlTargetSchema.safeParse({ ...target, provider: 'codex' }).success
    ).toBe(false)
    expect(
      AgentSessionControlTargetSchema.safeParse({ ...target, revision: undefined }).success
    ).toBe(false)
    expect(AgentSessionControlTargetSchema.safeParse({ ...target, extra: true }).success).toBe(
      false
    )
    expect(
      AgentSessionControlReceiptSchema.safeParse({
        target,
        clientOperationId: 'operation',
        state: 'stopped'
      }).success
    ).toBe(true)
    expect(
      AgentSessionControlReceiptSchema.safeParse({
        target,
        clientOperationId: 'operation',
        state: 'cancelled'
      }).success
    ).toBe(false)
  })
})
