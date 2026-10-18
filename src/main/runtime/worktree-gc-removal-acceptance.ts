import { listWorktreesStrict } from '../git/worktree'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import type { LocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import {
  enforceGcWorktreeRemovalAcceptance,
  shortGcBranchName,
  type GcExaminedWorktree,
  type GcProcessCwdScan
} from '../../shared/worktree-gc-removal-acceptance'

export async function assertRegisteredGcWorktreeRemoval(input: {
  examined: GcExaminedWorktree
  repoPath: string
  localOptions: LocalProjectWorktreeGitOptions
  hasLocalOptions: boolean
  readAttached: () => Promise<boolean>
  readProcessCwds: () => Promise<GcProcessCwdScan>
  listWorktrees?: () => Promise<GitWorktreeInfo[]>
  wait?: () => Promise<void>
}): Promise<void> {
  await enforceGcWorktreeRemovalAcceptance({
    wait: input.wait,
    examined: input.examined,
    readLive: async () => {
      const listed = input.listWorktrees
        ? await input.listWorktrees()
        : input.hasLocalOptions
          ? await listWorktreesStrict(input.repoPath, input.localOptions)
          : await listWorktreesStrict(input.repoPath)
      const row = listed.find((worktree) => worktree.path === input.examined.path)
      return {
        path: row?.path ?? '',
        branch: shortGcBranchName(row?.branch),
        head: row?.head ?? '',
        attached: await input.readAttached(),
        processCwds: await input.readProcessCwds()
      }
    }
  })
}
