import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UNPUBLISHED_WORKTREE_PUBLICATION_EPOCH,
  type RuntimeMobileSessionTabsRemovedResult
} from '../../../shared/runtime-types'
import { toWebTerminalSurfaceTabId } from '../../../shared/terminal-surface-id'
import { applyWebSessionTabsSnapshot } from './web-session-tabs-sync/snapshot-api'
import type { WebSessionTabsSyncState } from './web-session-tabs-sync/state'
import {
  ENV,
  LEAF_ID,
  NOW,
  SECOND_LEAF_ID,
  WT,
  makeSnapshot,
  makeState,
  resetWebSessionTabsSyncTestState
} from './web-session-tabs-sync-test-harness'

vi.mock('../store', () => ({
  useAppStore: {
    setState: vi.fn()
  }
}))

const hostTerminal = (overrides: {
  parentTabId: string
  leafId: string
  terminal: string
  isActive?: boolean
}) => ({
  type: 'terminal' as const,
  id: `${overrides.parentTabId}::${overrides.leafId}`,
  title: 'Terminal',
  parentTabId: overrides.parentTabId,
  leafId: overrides.leafId,
  isActive: overrides.isActive === true,
  status: 'ready' as const,
  terminal: overrides.terminal
})

function applyToState(
  state: WebSessionTabsSyncState,
  snapshot: ReturnType<typeof makeSnapshot>,
  environmentId = ENV
): WebSessionTabsSyncState {
  const patch = applyWebSessionTabsSnapshot(state, snapshot, environmentId, NOW)
  return { ...state, ...patch }
}

describe('mirrored terminal unpublished frames', () => {
  beforeEach(resetWebSessionTabsSyncTestState)

  it('keeps a live web-terminal tab through an empty unpublished snapshot', () => {
    const hydrated = applyToState(
      makeState(),
      makeSnapshot([
        hostTerminal({
          parentTabId: 'host-tab-1',
          leafId: LEAF_ID,
          terminal: 'terminal-1',
          isActive: true
        })
      ])
    )
    const mirroredId = toWebTerminalSurfaceTabId('host-tab-1')
    expect(hydrated.tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([mirroredId])

    const next = applyToState(
      hydrated,
      makeSnapshot([], {
        publicationEpoch: UNPUBLISHED_WORKTREE_PUBLICATION_EPOCH,
        snapshotVersion: 0,
        activeTabId: null,
        activeTabType: null
      })
    )

    expect(next.tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([mirroredId])
    expect(next.ptyIdsByTabId[mirroredId]).toEqual(hydrated.ptyIdsByTabId[mirroredId])
    expect(
      next.unifiedTabsByWorktree[WT]?.some(
        (tab) => tab.contentType === 'terminal' && tab.id === mirroredId
      )
    ).toBe(true)
  })

  it('rebuilds a republished mirrored tab on an unpublished frame without duplicating it', () => {
    const first = applyToState(
      makeState(),
      makeSnapshot([
        hostTerminal({
          parentTabId: 'host-tab-1',
          leafId: LEAF_ID,
          terminal: 'terminal-1',
          isActive: true
        })
      ])
    )
    const mirroredId = toWebTerminalSurfaceTabId('host-tab-1')
    const next = applyToState(
      first,
      makeSnapshot(
        [
          hostTerminal({
            parentTabId: 'host-tab-1',
            leafId: LEAF_ID,
            terminal: 'terminal-1',
            isActive: true
          })
        ],
        {
          publicationEpoch: UNPUBLISHED_WORKTREE_PUBLICATION_EPOCH,
          snapshotVersion: 0
        }
      )
    )

    expect(next.tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([mirroredId])
    expect(next.unifiedTabsByWorktree[WT]?.filter((tab) => tab.id === mirroredId)).toHaveLength(1)
  })

  it('keeps an omitted mirrored tab when an unpublished frame republishes a sibling', () => {
    const coordinator = applyToState(
      makeState(),
      makeSnapshot([
        hostTerminal({
          parentTabId: 'coord-tab',
          leafId: LEAF_ID,
          terminal: 'terminal-coord',
          isActive: true
        })
      ])
    )
    const withSibling = applyToState(
      coordinator,
      makeSnapshot([
        hostTerminal({
          parentTabId: 'coord-tab',
          leafId: LEAF_ID,
          terminal: 'terminal-coord',
          isActive: false
        }),
        hostTerminal({
          parentTabId: 'other-tab',
          leafId: SECOND_LEAF_ID,
          terminal: 'terminal-other',
          isActive: true
        })
      ])
    )
    const coordId = toWebTerminalSurfaceTabId('coord-tab')
    const otherId = toWebTerminalSurfaceTabId('other-tab')
    expect(withSibling.tabsByWorktree[WT]?.map((tab) => tab.id).sort()).toEqual(
      [coordId, otherId].sort()
    )

    const unpublishedSiblingOnly = applyToState(
      withSibling,
      makeSnapshot(
        [
          hostTerminal({
            parentTabId: 'other-tab',
            leafId: SECOND_LEAF_ID,
            terminal: 'terminal-other',
            isActive: true
          })
        ],
        {
          publicationEpoch: UNPUBLISHED_WORKTREE_PUBLICATION_EPOCH,
          snapshotVersion: 0
        }
      )
    )

    expect(unpublishedSiblingOnly.tabsByWorktree[WT]?.map((tab) => tab.id).sort()).toEqual(
      [coordId, otherId].sort()
    )
  })

  it('culls an omitted mirrored tab when an affirming snapshot lists a sibling instead', () => {
    const both = applyToState(
      makeState(),
      makeSnapshot([
        hostTerminal({
          parentTabId: 'coord-tab',
          leafId: LEAF_ID,
          terminal: 'terminal-coord',
          isActive: false
        }),
        hostTerminal({
          parentTabId: 'other-tab',
          leafId: SECOND_LEAF_ID,
          terminal: 'terminal-other',
          isActive: true
        })
      ])
    )
    const coordId = toWebTerminalSurfaceTabId('coord-tab')
    const otherId = toWebTerminalSurfaceTabId('other-tab')
    const next = applyToState(
      both,
      makeSnapshot([
        hostTerminal({
          parentTabId: 'other-tab',
          leafId: SECOND_LEAF_ID,
          terminal: 'terminal-other',
          isActive: true
        })
      ])
    )

    expect(next.tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([otherId])
    expect(next.tabsByWorktree[WT]?.some((tab) => tab.id === coordId)).toBe(false)
    expect(next.ptyIdsByTabId[coordId]).toBeUndefined()
  })

  it('still drops mirrored terminals on an explicit worktree removal frame', () => {
    const hydrated = applyToState(
      makeState(),
      makeSnapshot([
        hostTerminal({
          parentTabId: 'host-tab-1',
          leafId: LEAF_ID,
          terminal: 'terminal-1',
          isActive: true
        })
      ])
    )
    const next = applyToState(hydrated, {
      ...makeSnapshot([], { activeTabId: null, activeTabType: null }),
      removed: true
    } as RuntimeMobileSessionTabsRemovedResult)

    expect(Object.hasOwn(next.tabsByWorktree, WT)).toBe(false)
  })

  it('keeps a pvelxc-mirrored terminal through an affirming MSI frame with no terminals', () => {
    const hydrated = applyToState(
      makeState(),
      makeSnapshot([
        hostTerminal({
          parentTabId: 'coord-tab',
          leafId: LEAF_ID,
          terminal: 'terminal-coord',
          isActive: true
        })
      ]),
      'pvelxc'
    )
    const coordId = toWebTerminalSurfaceTabId('coord-tab')
    expect(hydrated.ptyIdsByTabId[coordId]).toEqual(['remote:pvelxc@@terminal-coord'])

    const next = applyToState(hydrated, makeSnapshot([]), 'msi')

    expect(next.tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([coordId])
    expect(next.ptyIdsByTabId[coordId]).toEqual(['remote:pvelxc@@terminal-coord'])
  })

  it('culls an omitted same-environment mirrored terminal on an affirming frame', () => {
    const hydrated = applyToState(
      makeState(),
      makeSnapshot([
        hostTerminal({
          parentTabId: 'coord-tab',
          leafId: LEAF_ID,
          terminal: 'terminal-coord',
          isActive: true
        })
      ])
    )
    const coordId = toWebTerminalSurfaceTabId('coord-tab')

    const next = applyToState(hydrated, makeSnapshot([]))

    expect(next.tabsByWorktree[WT]?.map((tab) => tab.id) ?? []).toEqual([])
    expect(next.ptyIdsByTabId[coordId]).toBeUndefined()
  })

  it('culls an unqualified mirrored terminal from any environment as before', () => {
    const hydrated = applyToState(
      makeState(),
      makeSnapshot([
        hostTerminal({
          parentTabId: 'coord-tab',
          leafId: LEAF_ID,
          terminal: 'terminal-coord',
          isActive: true
        })
      ]),
      'pvelxc'
    )
    const coordId = toWebTerminalSurfaceTabId('coord-tab')
    // A local-mode mirror mints a bare handle, which names no runtime.
    const withoutOwner: WebSessionTabsSyncState = {
      ...hydrated,
      ptyIdsByTabId: { ...hydrated.ptyIdsByTabId, [coordId]: ['terminal-coord'] },
      tabsByWorktree: {
        ...hydrated.tabsByWorktree,
        [WT]: (hydrated.tabsByWorktree[WT] ?? []).map((tab) =>
          tab.id === coordId ? { ...tab, ptyId: 'terminal-coord' } : tab
        )
      }
    }

    const next = applyToState(withoutOwner, makeSnapshot([]), 'msi')

    expect(next.tabsByWorktree[WT]?.map((tab) => tab.id) ?? []).toEqual([])
  })
})
