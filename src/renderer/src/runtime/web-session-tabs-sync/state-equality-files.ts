import type { Tab, TabGroup } from '../../../../shared/tab-types'
import { worktreeIdentityKey } from '../../../../shared/worktree/id'
import type { OpenFile } from '../../store/slices/editor'
import type { WebSessionTabsBatchContext, WebSessionTabsSyncState } from './state'
import { sameStringArray } from './state-equality-core'

export function openFileEqual(a: OpenFile, b: OpenFile): boolean {
  return (
    a.id === b.id &&
    a.filePath === b.filePath &&
    a.relativePath === b.relativePath &&
    a.worktreeId === b.worktreeId &&
    a.language === b.language &&
    a.isDirty === b.isDirty &&
    a.runtimeEnvironmentId === b.runtimeEnvironmentId &&
    a.markdownPreviewSourceFileId === b.markdownPreviewSourceFileId &&
    a.markdownPreviewAnchor === b.markdownPreviewAnchor &&
    a.isPreview === b.isPreview &&
    a.isUntitled === b.isUntitled &&
    a.deleteUntouchedOnClose === b.deleteUntouchedOnClose &&
    a.externalMutation === b.externalMutation &&
    a.mirroredFromRuntimeSession === b.mirroredFromRuntimeSession &&
    a.mode === b.mode
  )
}

export function sameOpenFiles(a: readonly OpenFile[], b: readonly OpenFile[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  return a.every((file, index) => openFileEqual(file, b[index]!))
}

/** Index worktree-local files so each snapshot avoids scanning the global array. */
export function webSessionOpenFilesForWorktree(
  state: WebSessionTabsSyncState,
  worktreeId: string,
  batchContext?: WebSessionTabsBatchContext
): readonly OpenFile[] {
  const key = worktreeIdentityKey(worktreeId)
  if (!batchContext) {
    return state.openFiles.filter((file) => worktreeIdentityKey(file.worktreeId) === key)
  }
  let index = batchContext.openFilesIndex
  if (!index || index.source !== state.openFiles) {
    const byWorktree = new Map<string, OpenFile[]>()
    for (const file of state.openFiles) {
      const bucketKey = worktreeIdentityKey(file.worktreeId)
      const bucket = byWorktree.get(bucketKey) ?? []
      bucket.push(file)
      byWorktree.set(bucketKey, bucket)
    }
    index = { source: state.openFiles, byWorktree }
    batchContext.openFilesIndex = index
  }
  return index.byWorktree.get(key) ?? []
}

/** Rebucket only the changed worktree when retargeting; full rebuild per snapshot defeats the index’s cost bound. */
export function advanceWebSessionOpenFilesIndex(
  batchContext: WebSessionTabsBatchContext | undefined,
  nextOpenFiles: readonly OpenFile[],
  worktreeId: string
): void {
  const index = batchContext?.openFilesIndex
  if (!index || index.source === nextOpenFiles) {
    return
  }
  const key = worktreeIdentityKey(worktreeId)
  const bucket: OpenFile[] = []
  for (const file of nextOpenFiles) {
    if (worktreeIdentityKey(file.worktreeId) === key) {
      bucket.push(file)
    }
  }
  // Why: bucket under the canonical key — reads look up by it, and a raw-spelling write would
  // silently miss and re-filter on every snapshot.
  index.byWorktree.set(key, bucket)
  index.source = nextOpenFiles
}

export function tabEqual(a: Tab, b: Tab): boolean {
  return (
    a.id === b.id &&
    a.entityId === b.entityId &&
    a.groupId === b.groupId &&
    a.worktreeId === b.worktreeId &&
    a.executionHostId === b.executionHostId &&
    a.contentType === b.contentType &&
    a.agentSessionAgent === b.agentSessionAgent &&
    a.label === b.label &&
    // Include generated label in equality or unified titles diverge from terminal tabs.
    a.generatedLabel === b.generatedLabel &&
    a.aiVaultTitle?.agent === b.aiVaultTitle?.agent &&
    a.aiVaultTitle?.sessionId === b.aiVaultTitle?.sessionId &&
    a.aiVaultTitle?.title === b.aiVaultTitle?.title &&
    a.customLabel === b.customLabel &&
    a.color === b.color &&
    a.sortOrder === b.sortOrder &&
    a.createdAt === b.createdAt &&
    a.isPreview === b.isPreview &&
    a.isPinned === b.isPinned
  )
}

export function sameUnifiedTabs(a: readonly Tab[] | undefined, b: readonly Tab[] | null): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) {
    return false
  }
  return left.every((tab, index) => tabEqual(tab, right[index]!))
}

export function groupEqual(a: TabGroup, b: TabGroup): boolean {
  return (
    a.id === b.id &&
    a.worktreeId === b.worktreeId &&
    a.activeTabId === b.activeTabId &&
    sameStringArray(a.tabOrder, b.tabOrder) &&
    sameStringArray(a.recentTabIds ?? [], b.recentTabIds ?? [])
  )
}

export function sameGroups(
  a: readonly TabGroup[] | undefined,
  b: readonly TabGroup[] | null
): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) {
    return false
  }
  return left.every((group, index) => groupEqual(group, right[index]!))
}

export function toVisibleTabType(tab: Tab): WebSessionTabsSyncState['activeTabType'] {
  if (tab.contentType === 'agent-session') {
    return 'agent-session'
  }
  if (tab.contentType === 'browser' || tab.contentType === 'terminal') {
    return tab.contentType
  }
  return 'editor'
}
