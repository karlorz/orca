import { readdir, readFile, readlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getPlatformUserDataPath } from './runtime/metadata'

export type HomeUpdateProfileSource = 'env' | 'running-app' | 'default'

export type HomeUpdateProfiles = {
  source: HomeUpdateProfileSource
  /** Every profile whose daemons must be verified; never empty. */
  userDataPaths: string[]
}

export type HomeUpdateProcessHost = {
  listPids(): Promise<string[]>
  readCmdline(pid: string): Promise<string>
  readExe(pid: string): Promise<string>
}

export const productionHomeUpdateProcessHost: HomeUpdateProcessHost = {
  listPids: async () => (await readdir('/proc')).filter((name) => /^\d+$/.test(name)),
  readCmdline: (pid) => readFile(`/proc/${pid}/cmdline`, 'utf8'),
  readExe: (pid) => readlink(`/proc/${pid}/exe`)
}

const USER_DATA_DIR_FLAG = '--user-data-dir='

/**
 * Which profile(s) the CLI must probe for live daemons before a home AppImage update.
 *
 * Why this order: ORCA_USER_DATA_PATH is the existing CLI convention (the app exports it into its
 * own terminals, and wrappers pin it). Outside those, the running managed AppImage is the only
 * authority on its profile, and it carries it as `--user-data-dir=` on its command line, the same
 * argument `relaunchHomeAppImage` preserves. Matching on that image path keeps unrelated Electron
 * or Chrome processes out. Only when no such process exists does the platform default apply.
 * Several running profiles are all probed, so one unverified profile still blocks the update.
 */
export async function resolveHomeUpdateProfiles(options: {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  homeDir: string
  image: string | null
  processes?: HomeUpdateProcessHost
}): Promise<HomeUpdateProfiles> {
  if (options.env.ORCA_USER_DATA_PATH) {
    return { source: 'env', userDataPaths: [resolve(options.env.ORCA_USER_DATA_PATH)] }
  }
  if (options.platform === 'linux' && options.image) {
    const running = await runningHomeAppImageProfiles(
      options.image,
      options.processes ?? productionHomeUpdateProcessHost
    )
    if (running.length > 0) {
      return { source: 'running-app', userDataPaths: running }
    }
  }
  return {
    source: 'default',
    userDataPaths: [getPlatformUserDataPath(options.platform, options.homeDir)]
  }
}

async function runningHomeAppImageProfiles(
  image: string,
  processes: HomeUpdateProcessHost
): Promise<string[]> {
  let pids: string[]
  try {
    pids = await processes.listPids()
  } catch {
    return []
  }
  const target = resolve(image)
  const profiles = new Set<string>()
  for (const pid of pids) {
    let argv: string[]
    try {
      argv = (await processes.readCmdline(pid)).split('\0').filter(Boolean)
    } catch {
      continue
    }
    if (argv.length === 0 || argv.some((arg) => arg.startsWith('--type='))) {
      continue
    }
    const exe = await processes.readExe(pid).catch(() => null)
    if (resolve(argv[0]) !== target && (!exe || resolve(exe) !== target)) {
      continue
    }
    const flag = argv.find((arg) => arg.startsWith(USER_DATA_DIR_FLAG))
    const value = flag?.slice(USER_DATA_DIR_FLAG.length)
    if (value) {
      profiles.add(resolve(value))
    }
  }
  return [...profiles].sort()
}
