import { join, resolve } from 'node:path'

export type WellKnownOrcaUserDataPaths = {
  electron: string
  orcad: string
}

/** Packaged Electron / `orca serve` profile, ignoring `ORCA_USER_DATA_PATH`. */
export function electronUserDataPath(
  platform: NodeJS.Platform,
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', 'orca')
  }
  if (platform === 'win32') {
    const appData = env.APPDATA
    if (!appData) {
      return join(homeDir, 'AppData', 'Roaming', 'orca')
    }
    return join(appData, 'orca')
  }
  return join(env.XDG_CONFIG_HOME || join(homeDir, '.config'), 'orca')
}

/** orcad profile, ignoring `ORCA_USER_DATA`. */
export function orcadUserDataPath(homeDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_DATA_HOME
  return xdg ? join(xdg, 'Orca') : join(homeDir, '.orca')
}

export function wellKnownOrcaUserDataPaths(
  platform: NodeJS.Platform,
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env
): WellKnownOrcaUserDataPaths {
  return {
    electron: electronUserDataPath(platform, homeDir, env),
    orcad: orcadUserDataPath(homeDir, env)
  }
}

/** The other well-known profile on this login, or null when `thisPath` is neither or they coincide. */
export function siblingWellKnownUserDataPath(
  thisUserDataPath: string,
  wellKnown: WellKnownOrcaUserDataPaths
): string | null {
  const thisResolved = resolve(thisUserDataPath)
  const electron = resolve(wellKnown.electron)
  const orcad = resolve(wellKnown.orcad)
  if (electron === orcad) {
    return null
  }
  if (thisResolved === electron) {
    return orcad
  }
  if (thisResolved === orcad) {
    return electron
  }
  return null
}
