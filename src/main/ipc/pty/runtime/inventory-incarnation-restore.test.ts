import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalPtyProvider } from '../../../providers/local-pty-provider'
import type { PtyProcessInfo } from '../../../providers/pty-process-info'
import { ptyIncarnationById, ptyOwnership } from '../provider/ownership-state'
import { getLocalPtyProvider, setLocalPtyProvider } from '../provider/registry'
import { listProcessesFromRuntimeController } from './inventory-operations'

const ID = 'restored-terminal'
const FIRST = '10000000-0000-4000-8000-000000000001'
const NEXT = '10000000-0000-4000-8000-000000000002'
const originalProvider = getLocalPtyProvider()

function installListing(rows: PtyProcessInfo[]) {
  const provider = new LocalPtyProvider()
  const list = vi.spyOn(provider, 'listProcesses').mockResolvedValue(rows)
  vi.spyOn(provider, 'hasPty').mockReturnValue(true)
  setLocalPtyProvider(provider)
  return { provider, list }
}

function row(incarnationId = FIRST): PtyProcessInfo {
  return { id: ID, incarnationId, cwd: '/tmp', title: 'shell' }
}

afterEach(() => {
  setLocalPtyProvider(originalProvider)
  ptyIncarnationById.delete(ID)
  ptyOwnership.delete(ID)
  vi.restoreAllMocks()
})

describe('a runtime recovering daemon terminals from its local inventory', () => {
  it.each(['local', undefined] as const)(
    'restores the close fence through host scope %s',
    async (scope) => {
      installListing([row()])
      await listProcessesFromRuntimeController({}, scope)
      expect(ptyIncarnationById.get(ID)).toBe(FIRST)
      expect(ptyOwnership.get(ID)).toBe('local')
    }
  )

  it('keeps an incarnation recorded by a newer spawn while inventory was in flight', async () => {
    const { list } = installListing([])
    let finish: (rows: PtyProcessInfo[]) => void = () => {}
    list.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const pending = listProcessesFromRuntimeController({}, 'local')
    ptyIncarnationById.set(ID, NEXT)
    finish([row()])
    await pending
    expect(ptyIncarnationById.get(ID)).toBe(NEXT)
  })

  it('does not adopt an inventory from a provider replaced while the request was in flight', async () => {
    const { list } = installListing([])
    let finish: (rows: PtyProcessInfo[]) => void = () => {}
    list.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const pending = listProcessesFromRuntimeController({}, 'local')
    setLocalPtyProvider(new LocalPtyProvider())
    finish([row()])
    await pending
    expect(ptyIncarnationById.has(ID)).toBe(false)
  })

  it.each([
    { ...row(), incarnationId: undefined },
    { ...row(), incarnationId: '' },
    { ...row(), incarnationId: 'x'.repeat(129) },
    { ...row(), exiting: true as const }
  ])('does not restore a missing, invalid or exiting incarnation: %j', async (process) => {
    installListing([process])
    await listProcessesFromRuntimeController({}, 'local')
    expect(ptyIncarnationById.has(ID)).toBe(false)
  })

  it('does not overwrite another execution host recorded for the same id', async () => {
    installListing([row()])
    ptyOwnership.set(ID, 'ssh:another-host')
    await listProcessesFromRuntimeController({}, 'local')
    expect(ptyIncarnationById.has(ID)).toBe(false)
    expect(ptyOwnership.get(ID)).toBe('ssh:another-host')
  })
})
