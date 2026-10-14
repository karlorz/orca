import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  decodeAgentSessionControlRequest,
  readAgentSessionControlRequest
} from './agent-session-control-request'

const target = {
  executionHostId: 'local',
  runtimeId: 'runtime-1',
  sessionId: 'session-1',
  provider: 'grok',
  nativeSessionId: 'native-1',
  turnId: null,
  runtimeFence: 1,
  acquisitionGeneration: 'child-1',
  revision: 1,
  token: 'opaque'
} as const
const send = {
  expectedControlTarget: target,
  envelope: {
    sessionId: 'session-1',
    clientOperationId: '1800000000000-00000000000000000000000000000001',
    expectedRuntimeFence: 1,
    payloadFingerprint: 'a'.repeat(64)
  },
  body: {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: '$(touch /tmp/never) `rm nope`\n你好 / 👋' }]
  }
}

describe('strict control JSON input', () => {
  it('preserves literal prompt argv without shell evaluation', async () => {
    const flags = new Map([['request', JSON.stringify(send)]])
    expect(
      decodeAgentSessionControlRequest(
        'follow-up',
        await readAgentSessionControlRequest(flags, '/unused')
      )
    ).toEqual(send)
  })

  it('reads piped multiline JSON literally from stdin', async () => {
    const encoded = JSON.stringify(send, null, 2)
    const input = vi
      .spyOn(process.stdin, Symbol.asyncIterator)
      .mockImplementation(async function* () {
        yield encoded.slice(0, 20)
        yield encoded.slice(20)
        return undefined
      })
    try {
      expect(
        await readAgentSessionControlRequest(new Map([['request-file', '-']]), '/unused')
      ).toEqual(send)
    } finally {
      input.mockRestore()
    }
  })

  it('reads relative request files without expanding content or paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-control-json-'))
    try {
      await writeFile(join(root, 'request.json'), JSON.stringify(send), 'utf8')
      expect(
        await readAgentSessionControlRequest(new Map([['request-file', 'request.json']]), root)
      ).toEqual(send)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    { ...send, expectedControlTarget: undefined },
    { ...send, expectedControlTarget: { ...target, unknown: true } },
    { ...send, envelope: { ...send.envelope, sessionId: 'other' } },
    { ...send, envelope: { ...send.envelope, expectedRuntimeFence: 2 } },
    { ...send, delivery: 'queue-if-active' },
    { ...send, retryUnknown: true },
    { ...send, unexpected: true },
    { ...send, body: { ...send.body, role: 'assistant' } }
  ])('rejects malformed or non-strict follow-ups', (input) => {
    expect(() => decodeAgentSessionControlRequest('follow-up', input)).toThrow()
  })

  it('requires the exact Stop turn and rejects prompt/background scope', () => {
    const stop = {
      envelope: send.envelope,
      expectedControlTarget: { ...target, turnId: 'turn-1' },
      turnId: 'turn-1'
    }
    expect(decodeAgentSessionControlRequest('stop', stop)).toEqual(stop)
    expect(() => decodeAgentSessionControlRequest('stop', { ...stop, turnId: 'turn-2' })).toThrow()
    expect(() =>
      decodeAgentSessionControlRequest('stop', { ...stop, scope: 'background-tasks' })
    ).toThrow()
    expect(() =>
      decodeAgentSessionControlRequest('stop', {
        ...stop,
        prompt: { itemId: 'q', expectedRevision: 1 }
      })
    ).toThrow()
  })

  it('requires exactly one bounded JSON source', async () => {
    await expect(readAgentSessionControlRequest(new Map(), '/unused')).rejects.toThrow()
    await expect(
      readAgentSessionControlRequest(
        new Map([
          ['request', '{}'],
          ['request-file', '-']
        ]),
        '/unused'
      )
    ).rejects.toThrow()
    await expect(
      readAgentSessionControlRequest(new Map([['request', '{not json']]), '/unused')
    ).rejects.toThrow()
    await expect(
      readAgentSessionControlRequest(new Map([['request', 'x'.repeat(512 * 1024 + 1)]]), '/unused')
    ).rejects.toThrow()
  })
})
