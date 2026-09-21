import { describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveOrcaAppMock,
  getDefaultUserDataPathMock,
  addEnvironmentFromPairingCodeMock,
  listEnvironmentsMock,
  spawnMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveOrcaAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data'),
  addEnvironmentFromPairingCodeMock: vi.fn(),
  listEnvironmentsMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})

vi.mock('./runtime/environments', () => ({
  addEnvironmentFromPairingCode: addEnvironmentFromPairingCodeMock,
  listEnvironments: listEnvironmentsMock,
  removeEnvironment: vi.fn(),
  resolveEnvironment: vi.fn()
}))

vi.mock('child_process', async () => {
  const { createChildProcessModuleMock } = await import('./index-test-harness.js')
  return createChildProcessModuleMock(spawnMock)
})

import { main } from './index'
import {
  buildWorktree,
  okFixture,
  queueFixtures,
  workspaceDestinationFixtures,
  worktreeListFixture
} from './test-fixtures'
import { useWorktreeAwarenessEnvironment } from './index-test-harness'

function callsFor(method: string): unknown[][] {
  return callMock.mock.calls.filter((call) => call[0] === method)
}

function lastCallArgs(method: string): { updates: { model?: unknown; reasoningEffort?: unknown } } {
  const call = callsFor(method).at(-1)
  if (!call) {
    throw new Error(`No ${method} call was recorded.`)
  }
  return call[1] as { updates: { model?: unknown } }
}

describe('orca cli automation model flag', () => {
  useWorktreeAwarenessEnvironment({
    callMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  it('passes --model and --reasoning-effort through create and edit', async () => {
    queueFixtures(
      callMock,
      worktreeListFixture([buildWorktree('/tmp/repo/feature', 'feature/foo', 'abc', 'repo-1')]),
      ...workspaceDestinationFixtures(),
      okFixture('req_create', { automation: { id: 'auto-1', name: 'Grok sweep' } }),
      okFixture('req_edit_owner', { automation: { id: 'auto-1', name: 'Grok sweep' } }),
      okFixture('req_edit', { automation: { id: 'auto-1', name: 'Grok sweep' } })
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      [
        'automations',
        'create',
        '--name',
        'Grok sweep',
        '--trigger',
        'daily',
        '--prompt',
        'Triage alerts',
        '--provider',
        'grok',
        '--model',
        'deepseek-v4-flash',
        '--reasoning-effort',
        'xhigh',
        '--workspace',
        'current',
        '--json'
      ],
      '/tmp/repo/feature/src'
    )
    await main(
      [
        'automations',
        'edit',
        'auto-1',
        '--model',
        'grok-4.5',
        '--reasoning-effort',
        'high',
        '--json'
      ],
      '/tmp/repo'
    )

    expect(callsFor('automation.create').at(-1)?.[1]).toEqual(
      expect.objectContaining({
        agentId: 'grok',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'xhigh'
      })
    )
    expect(callsFor('automation.update').at(-1)?.[1]).toEqual(
      expect.objectContaining({
        updates: expect.objectContaining({ model: 'grok-4.5', reasoningEffort: 'high' })
      })
    )
  })

  it('sends an explicit clear for an empty --model', async () => {
    // Why: an absent flag has to leave the stored model alone, so an empty value
    // is the only way back to the agent's own default model.
    queueFixtures(
      callMock,
      okFixture('req_edit_owner', { automation: { id: 'auto-1', name: 'Grok sweep' } }),
      okFixture('req_edit', { automation: { id: 'auto-1', name: 'Grok sweep' } })
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['automations', 'edit', 'auto-1', '--model', '', '--json'], '/tmp/repo')

    expect(callsFor('automation.update').at(-1)?.[1]).toEqual(
      expect.objectContaining({ id: 'auto-1', updates: { model: null } })
    )
  })

  it('does not clear the model on an edit that omits the flag', async () => {
    queueFixtures(
      callMock,
      okFixture('req_edit_owner', { automation: { id: 'auto-1', name: 'Grok sweep' } }),
      okFixture('req_edit', { automation: { id: 'auto-1', name: 'Grok sweep' } })
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['automations', 'edit', 'auto-1', '--disabled', '--json'], '/tmp/repo')

    // `undefined` is the "leave unchanged" the store already reads for every other
    // omitted flag; only the empty form above turns into a `null` clear.
    expect(lastCallArgs('automation.update').updates.model).toBeUndefined()
  })
})
