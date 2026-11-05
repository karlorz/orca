import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerRuntimeOwnerEnvironments } from '@/lib/runtime-owner-catalog'
import { toWebTerminalSurfaceTabId } from '../../../shared/terminal-surface-id'
import type { RuntimeMobileSessionFileTab } from '../../../shared/runtime-types'
import { applyWebSessionTabsSnapshot } from './web-session-tabs-sync/snapshot-api'
import type { WebSessionTabsSyncState } from './web-session-tabs-sync/state'
import {
  LEAF_ID,
  NOW,
  WT,
  makeSnapshot,
  makeState,
  resetWebSessionTabsSyncTestState
} from './web-session-tabs-sync-test-harness'

/**
 * MSI is paired to pvelxc and also publishes this worktree. A client that already mirrors pvelxc
 * still admits MSI's unique surfaces so a shared workspace can show both runtimes (#31983).
 */
const environments = [
  { id: 'pvelxc', runtimeId: 'runtime-pvelxc', lastUsedAt: 1 },
  { id: 'msi', runtimeId: 'runtime-msi', lastUsedAt: 2 }
]
const PNG = '/root/projects/company-coord/out/oidc-visual-report-light-v3.png'
const COORD_TAB_ID = toWebTerminalSurfaceTabId('coord-tab')

function hostTerminal(parentTabId: string, terminal: string) {
  return {
    type: 'terminal' as const,
    id: `${parentTabId}::${LEAF_ID}`,
    title: 'Terminal',
    parentTabId,
    leafId: LEAF_ID,
    isActive: true,
    status: 'ready' as const,
    terminal
  }
}

function hostFile(id: string, filePath: string, isActive = false): RuntimeMobileSessionFileTab {
  return {
    type: 'file',
    id,
    title: filePath,
    filePath,
    relativePath: filePath,
    language: 'plaintext',
    isDirty: false,
    isActive
  }
}

function apply(
  state: WebSessionTabsSyncState,
  snapshot: ReturnType<typeof makeSnapshot>,
  environmentId: string
): WebSessionTabsSyncState {
  const patch = applyWebSessionTabsSnapshot(state, snapshot, environmentId, NOW)
  return { ...state, ...patch }
}

/** The local strip as it stands for a client paired to pvelxc: its terminal and its editor tab. */
function pvelxcMirroredState(): WebSessionTabsSyncState {
  return apply(
    makeState(),
    makeSnapshot([hostTerminal('coord-tab', 'terminal-coord'), hostFile('pvelxc-editor', PNG)]),
    'pvelxc'
  )
}

describe('cross-runtime session surface mirrors', () => {
  beforeEach(() => {
    resetWebSessionTabsSyncTestState()
    registerRuntimeOwnerEnvironments(() => environments)
  })
  afterEach(() => registerRuntimeOwnerEnvironments(() => []))

  it('keeps the first-hand pvelxc editor and still admits MSI unique editor surfaces', () => {
    const paired = pvelxcMirroredState()
    const next = apply(
      paired,
      makeSnapshot([hostFile('msi-editor-a', PNG, true), hostFile('msi-editor-b', PNG)]),
      'msi'
    )

    expect(next.openFiles?.map((file) => file.runtimeEnvironmentId).sort()).toEqual([
      'msi',
      'pvelxc'
    ])
    const editorTabs = (next.unifiedTabsByWorktree[WT] ?? []).filter(
      (tab) => tab.contentType === 'editor'
    )
    expect(editorTabs).toHaveLength(3)
    expect(new Set(editorTabs.map((tab) => tab.executionHostId))).toEqual(
      new Set(['runtime:msi', 'runtime:pvelxc'])
    )
  })

  it('keeps the pvelxc terminal and still admits MSI unique terminal surfaces', () => {
    const paired = pvelxcMirroredState()
    const next = apply(paired, makeSnapshot([hostTerminal('msi-tab', 'terminal-msi')]), 'msi')

    expect(next.tabsByWorktree[WT]?.map((tab) => tab.id).sort()).toEqual(
      [COORD_TAB_ID, toWebTerminalSurfaceTabId('msi-tab')].sort()
    )
    expect(next.ptyIdsByTabId[COORD_TAB_ID]).toEqual(['remote:pvelxc@@terminal-coord'])
    expect(next.ptyIdsByTabId[toWebTerminalSurfaceTabId('msi-tab')]).toEqual([
      'remote:msi@@terminal-msi'
    ])
  })

  it('mirrors MSI surfaces for a client with no pvelxc mirror of that worktree', () => {
    const next = apply(
      makeState(),
      makeSnapshot([hostFile('msi-editor-a', PNG, true), hostFile('msi-editor-b', PNG)]),
      'msi'
    )

    expect(next.openFiles?.map((file) => file.runtimeEnvironmentId)).toEqual(['msi'])
    const editorTabs = (next.unifiedTabsByWorktree[WT] ?? []).filter(
      (tab) => tab.contentType === 'editor'
    )
    expect(editorTabs).toHaveLength(2)
    expect(editorTabs.every((tab) => tab.executionHostId === 'runtime:msi')).toBe(true)
  })
})
