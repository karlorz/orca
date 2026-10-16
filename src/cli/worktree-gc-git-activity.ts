import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseGitdirMarkerPayload } from '../shared/gitdir-marker-payload'

async function mtimeMs(target: string): Promise<number | null> {
  try {
    return (await stat(target)).mtimeMs
  } catch {
    return null
  }
}

async function nestedFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const files = [root]
    for (const entry of entries) {
      const full = path.join(root, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await nestedFiles(full)))
      } else {
        files.push(full)
      }
    }
    return files
  } catch {
    return []
  }
}

export async function gitActivityStampTargets(
  worktreePath: string,
  branch = ''
): Promise<string[]> {
  const candidates = [worktreePath, path.join(worktreePath, '.git')]
  const short = branch.replace(/^refs\/heads\//, '')
  for (const dir of await collectGitMetadataDirs(worktreePath)) {
    candidates.push(
      dir,
      path.join(dir, 'HEAD'),
      path.join(dir, 'index'),
      path.join(dir, 'logs', 'HEAD'),
      path.join(dir, 'packed-refs'),
      ...(await nestedFiles(path.join(dir, 'refs', 'heads'))),
      ...(await nestedFiles(path.join(dir, 'logs', 'refs', 'heads')))
    )
    if (short) {
      candidates.push(
        path.join(dir, 'refs', 'heads', short),
        path.join(dir, 'logs', 'refs', 'heads', short)
      )
    }
  }
  return candidates
}

async function collectGitMetadataDirs(worktreePath: string): Promise<string[]> {
  const gitFile = path.join(worktreePath, '.git')
  try {
    const info = await lstat(gitFile)
    if (!info.isDirectory() && !info.isFile()) {
      return []
    }
    if (info.isDirectory()) {
      return [gitFile]
    }
    const marker = parseGitdirMarkerPayload(await readFile(gitFile, 'utf8'))
    if (!marker) {
      return []
    }
    const gitdir = path.isAbsolute(marker) ? marker : path.resolve(worktreePath, marker)
    const dirs = [gitdir]
    try {
      const common = (await readFile(path.join(gitdir, 'commondir'), 'utf8')).trim()
      if (common) {
        dirs.push(path.isAbsolute(common) ? common : path.resolve(gitdir, common))
      }
    } catch {
      // Linked worktrees without commondir still expose HEAD/index/reflog on gitdir.
    }
    return dirs
  } catch {
    return []
  }
}

/** Real Git activity mtimes, including index/reflog/resolved refs. Does not spawn Git. */
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
