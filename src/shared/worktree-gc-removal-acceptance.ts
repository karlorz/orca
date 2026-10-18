import { isPathInsideOrEqual } from './cross-platform-path'

export type GcExaminedWorktree = {
  path: string
  branch: string
  head: string
}

export type GcProcessCwdScan =
  | { verdict: 'live'; cwds: readonly string[] }
  | { verdict: 'unverifiable' }

export function shortGcBranchName(branchRef: string | undefined): string {
  if (!branchRef || branchRef === 'detached') {
    return ''
  }
  return branchRef.replace(/^refs\/heads\//, '')
}

export function gcWorktreeRemovalRefusal(input: {
  examined: GcExaminedWorktree
  path: string
  branch: string
  head: string
  attached: boolean
  processCwds: GcProcessCwdScan
}): string | null {
  if (!input.path || input.path !== input.examined.path) {
    return 'workspace-identity-changed'
  }
  if (!input.branch || input.branch !== input.examined.branch) {
    return 'branch-changed'
  }
  if (!input.head || input.head !== input.examined.head) {
    return 'head-changed'
  }
  if (input.attached) {
    return 'terminal-attached'
  }
  if (input.processCwds.verdict !== 'live') {
    return 'process-cwd-unverifiable'
  }
  if (
    input.processCwds.cwds.some(
      (cwd) => cwd === input.examined.path || isPathInsideOrEqual(input.examined.path, cwd)
    )
  ) {
    return 'process-cwd-inside'
  }
  return null
}

export async function enforceGcWorktreeRemovalAcceptance(input: {
  wait?: () => Promise<void>
  examined: GcExaminedWorktree
  readLive: () => Promise<{
    path: string
    branch: string
    head: string
    attached: boolean
    processCwds: GcProcessCwdScan
  }>
}): Promise<void> {
  if (input.wait) {
    await input.wait()
  }
  const live = await input.readLive()
  const why = gcWorktreeRemovalRefusal({ examined: input.examined, ...live })
  if (why) {
    throw new Error(`gc_rm_refused:${why}`)
  }
}
