import { readdir, readlink } from 'node:fs/promises'
import path from 'node:path'
import type { WorktreeGcProcessCwdScan } from './worktree-gc-model'

export async function listLocalProcessCwds(
  platform: NodeJS.Platform = process.platform
): Promise<WorktreeGcProcessCwdScan> {
  if (platform !== 'linux') {
    return { verdict: 'unverifiable' }
  }
  let names: string[]
  try {
    names = await readdir('/proc')
  } catch {
    return { verdict: 'unverifiable' }
  }
  const cwds: string[] = []
  for (const name of names) {
    if (!/^[0-9]+$/.test(name)) {
      continue
    }
    try {
      cwds.push(await readlink(path.join('/proc', name, 'cwd')))
    } catch {
      // Process exited or cwd is unreadable; skip.
    }
  }
  return { verdict: 'live', cwds }
}
