import { lstat, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseGitdirMarkerPayload } from '../shared/gitdir-marker-payload'

async function mtimeMs(target: string): Promise<number | null> {
  try {
    return (await stat(target)).mtimeMs
  } catch {
    return null
  }
}

async function resolveGitMetadataDirs(
  worktreePath: string
): Promise<{ gitdir: string | null; commondir: string | null }> {
  const gitFile = path.join(worktreePath, '.git')
  try {
    const info = await lstat(gitFile)
    if (info.isDirectory()) {
      return { gitdir: gitFile, commondir: null }
    }
    if (!info.isFile()) {
      return { gitdir: null, commondir: null }
    }
    const marker = parseGitdirMarkerPayload(await readFile(gitFile, 'utf8'))
    if (!marker) {
      return { gitdir: null, commondir: null }
    }
    const gitdir = path.isAbsolute(marker) ? marker : path.resolve(worktreePath, marker)
    try {
      const common = (await readFile(path.join(gitdir, 'commondir'), 'utf8')).trim()
      if (common) {
        return {
          gitdir,
          commondir: path.isAbsolute(common) ? common : path.resolve(gitdir, common)
        }
      }
    } catch {
      // Linked worktrees without commondir still expose HEAD/index/reflog on gitdir.
    }
    return { gitdir, commondir: null }
  } catch {
    return { gitdir: null, commondir: null }
  }
}

/**
 * Per-worktree HEAD/index/reflog, plus only the examined branch's ref/reflog in
 * the common directory. Unrelated branch and main-checkout index samples are
 * excluded so a sibling stay idle.
 */
export async function gitActivityStampTargets(
  worktreePath: string,
  branch = ''
): Promise<string[]> {
  const short = branch.replace(/^refs\/heads\//, '')
  const candidates = [worktreePath, path.join(worktreePath, '.git')]
  const { gitdir, commondir } = await resolveGitMetadataDirs(worktreePath)
  if (gitdir) {
    candidates.push(
      gitdir,
      path.join(gitdir, 'HEAD'),
      path.join(gitdir, 'index'),
      path.join(gitdir, 'logs', 'HEAD')
    )
  }
  const refRoot = commondir ?? gitdir
  if (refRoot && short) {
    candidates.push(
      path.join(refRoot, 'refs', 'heads', short),
      path.join(refRoot, 'logs', 'refs', 'heads', short)
    )
  }
  return candidates
}

/** Real Git activity mtimes for this worktree and examined branch. Does not spawn Git. */
export async function newestGitActivityMs(
  worktreePath: string,
  branch = ''
): Promise<number | null> {
  const candidates = await gitActivityStampTargets(worktreePath, branch)
  let newest: number | null = null
  for (const candidate of candidates) {
    const ms = await mtimeMs(candidate)
    if (ms !== null) {
      newest = newest === null ? ms : Math.max(newest, ms)
    }
  }
  return newest
}
