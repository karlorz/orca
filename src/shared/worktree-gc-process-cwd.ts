import { readdir, readlink } from 'node:fs/promises'
import path from 'node:path'

export type WorktreeGcProcessCwdScan =
  | { verdict: 'live'; cwds: readonly string[] }
  | { verdict: 'unverifiable' }

export type WorktreeGcProcFs = {
  readdir(dir: string): Promise<string[]>
  readlink(target: string): Promise<string>
}

function processVanished(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ESRCH')
  )
}

export async function listLocalProcessCwds(
  platform: NodeJS.Platform = process.platform,
  procFs: WorktreeGcProcFs = { readdir, readlink }
): Promise<WorktreeGcProcessCwdScan> {
  if (platform !== 'linux') {
    return { verdict: 'unverifiable' }
  }
  let names: string[]
  try {
    names = await procFs.readdir('/proc')
  } catch {
    return { verdict: 'unverifiable' }
  }
  const cwds: string[] = []
  for (const name of names) {
    if (!/^[0-9]+$/.test(name)) {
      continue
    }
    try {
      cwds.push(await procFs.readlink(path.join('/proc', name, 'cwd')))
    } catch (error) {
      if (processVanished(error)) {
        continue
      }
      return { verdict: 'unverifiable' }
    }
  }
  return { verdict: 'live', cwds }
}
