import { existsSync, lstatSync, readlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

export function isSymlinkOwnedByUs(target, source) {
  try {
    if (!lstatSync(target).isSymbolicLink()) {
      return false
    }
    return readlinkSync(target) === source
  } catch {
    return false
  }
}

export function shouldSkipDevCliInstall(env = process.env) {
  const value = env.ORCA_SKIP_DEV_CLI_INSTALL
  return value === '1' || value === 'true'
}

export function runInstallDevCli(options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const log = options.log ?? console.log
  const error = options.error ?? console.error
  const execFn = options.execFileSync ?? execFileSync

  if (shouldSkipDevCliInstall(env)) {
    log('[orca-dev] Skipping global symlink (ORCA_SKIP_DEV_CLI_INSTALL).')
    return { outcome: 'skipped-env' }
  }

  const scriptDir = options.scriptDir ?? import.meta.dirname
  const source = options.source ?? path.join(scriptDir, 'orca-dev.mjs')
  const commandPath =
    options.commandPath !== undefined
      ? options.commandPath
      : platform === 'darwin' || platform === 'linux'
        ? '/usr/local/bin/orca-dev'
        : null

  if (!commandPath) {
    log('[orca-dev] Skipping global symlink (unsupported platform).')
    return { outcome: 'skipped-platform' }
  }

  if (existsSync(commandPath)) {
    if (isSymlinkOwnedByUs(commandPath, source)) {
      log(`[orca-dev] ${commandPath} already points to dev CLI.`)
      return { outcome: 'already-linked' }
    }
    error(
      `[orca-dev] ${commandPath} exists but is not our symlink. Remove it manually if you want the dev CLI installed globally.`
    )
    return { outcome: 'foreign-target' }
  }

  try {
    execFn('ln', ['-s', source, commandPath], { stdio: 'inherit' })
    log(`[orca-dev] Symlinked ${commandPath} → ${source}`)
    return { outcome: 'symlinked' }
  } catch (err) {
    log(
      `[orca-dev] Could not create ${commandPath} (permission denied). Run once with:\n` +
        `  sudo ln -s ${source} ${commandPath}`
    )
    return { outcome: 'permission-denied', error: err }
  }
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const result = runInstallDevCli()
  if (result.outcome === 'foreign-target') {
    process.exit(0)
  }
}
