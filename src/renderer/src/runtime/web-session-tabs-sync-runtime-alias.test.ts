import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerRuntimeOwnerEnvironments } from '@/lib/runtime-owner-catalog'
import { isSameEditorOwner, runtimeOwnerKey } from '../store/slices/editor/file-ids/editor-file-ids'
import type { OpenFile } from '../store/slices/editor'
import type { RuntimeMobileSessionFileTab } from '../../../shared/runtime-types'
import { applyWebSessionTabsSnapshot } from './web-session-tabs-sync/snapshot-api'
import { createMirroredEditorFileResolver } from './web-session-tabs-sync/mirrored-editor-file-identity'
import {
  WT,
  NOW,
  makeState,
  makeSnapshot,
  resetWebSessionTabsSyncTestState
} from './web-session-tabs-sync-test-harness'

const environments = [
  { id: 'env-a', runtimeId: 'pvelxc' },
  { id: 'env-b', runtimeId: 'pvelxc' },
  { id: 'msi', runtimeId: 'msi' }
]
const paths = ['/repo/out/oidc-architecture-design.png', '/repo/out/oidc-visual-report-dark.png']
function file(filePath: string): OpenFile {
  return {
    id: `local:${filePath}`,
    filePath,
    relativePath: filePath,
    worktreeId: WT,
    language: 'plaintext',
    isDirty: false,
    runtimeEnvironmentId: 'env-a',
    mode: 'edit'
  }
}
function hostTab(filePath: string, index = 0): RuntimeMobileSessionFileTab {
  return {
    type: 'file',
    id: `host:${index}`,
    title: filePath,
    filePath,
    relativePath: filePath,
    language: 'plaintext',
    isDirty: false,
    isActive: index === 0
  }
}

describe('editor runtime aliases', () => {
  beforeEach(() => {
    resetWebSessionTabsSyncTestState()
    registerRuntimeOwnerEnvironments(() => environments)
  })
  afterEach(() => registerRuntimeOwnerEnvironments(() => []))

  it('compares owners by runtime while keeping folders and distinct runtimes separate', () => {
    expect(runtimeOwnerKey('env-a')).toBe('pvelxc')
    expect(isSameEditorOwner(file(paths[0]!), `${WT}/`, 'env-b')).toBe(true)
    expect(isSameEditorOwner(file(paths[0]!), WT, 'msi')).toBe(false)
    expect(
      isSameEditorOwner(
        { ...file(paths[0]!), worktreeId: `${WT}::workspace:123e4567-e89b-12d3-a456-426614174000` },
        `${WT}::workspace:123e4567-e89b-12d3-a456-426614174001`,
        'env-b'
      )
    ).toBe(false)
  })

  it.each([1, 2])('adopts %i local PNGs from alias A when alias B publishes them', (count) => {
    const local = paths.slice(0, count).map(file)
    const state = makeState({
      openFiles: local,
      unifiedTabsByWorktree: {
        [WT]: local.map((entry, index) => ({
          id: `local-tab:${index}`,
          entityId: entry.id,
          worktreeId: WT,
          groupId: 'local',
          contentType: 'editor',
          label: entry.relativePath,
          customLabel: null,
          color: null,
          sortOrder: index,
          createdAt: NOW,
          isPreview: false
        }))
      }
    })
    const tabs = paths.slice(0, count).map(hostTab)
    const patch = applyWebSessionTabsSnapshot(state, makeSnapshot(tabs), 'env-b', NOW)
    const files = patch.openFiles ?? state.openFiles
    expect(files).toHaveLength(count)
    expect(files.map((entry) => entry.id)).toEqual(local.map((entry) => entry.id))
    expect(files.every((entry) => entry.mirroredFromRuntimeSession)).toBe(true)
    expect(patch.unifiedTabsByWorktree?.[WT]).toHaveLength(count)
    expect(patch.unifiedTabsByWorktree?.[WT]?.map((tab) => tab.id)).toEqual(
      tabs.map((tab) => tab.id)
    )
    const next = applyWebSessionTabsSnapshot(
      { ...state, ...patch },
      makeSnapshot([], { snapshotVersion: 2 }),
      'env-a',
      NOW + 1
    )
    expect(next.openFiles).toEqual([])
  })

  it('rebuilds the mirror owner index when the environment catalog gains runtime identity', () => {
    const files = [file(paths[0]!)]
    registerRuntimeOwnerEnvironments(() => [])
    expect(
      createMirroredEditorFileResolver(files, WT, 'env-b')(hostTab(paths[0]!), null).existingFile
    ).toBeUndefined()
    registerRuntimeOwnerEnvironments(() => environments)
    expect(
      createMirroredEditorFileResolver(files, WT, 'env-b')(hostTab(paths[0]!), null).existingFile
    ).toBe(files[0])
  })
})
