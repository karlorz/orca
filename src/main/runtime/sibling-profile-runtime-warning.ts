import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { getRuntimeMetadataPath, type RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { isProcessRunning } from '../../shared/runtime-pid-liveness'
import {
  siblingWellKnownUserDataPath,
  wellKnownOrcaUserDataPaths,
  type WellKnownOrcaUserDataPaths
} from '../../shared/well-known-orca-user-data-paths'

export function formatSiblingProfileRuntimeWarning(args: {
  siblingPath: string
  pid: number | null
  runtimeId?: string
}): string {
  const who = args.pid === null ? 'another process' : `pid ${args.pid}`
  const runtime = args.runtimeId ? ` (runtime ${args.runtimeId})` : ''
  return `[serve] Another Orca profile is already live as ${who}${runtime} under ${args.siblingPath}. Terminals belong to that runtime; pair clients to it.`
}

function isRuntimeMetadata(value: unknown): value is RuntimeMetadata {
  if (!value || typeof value !== 'object') {
    return false
  }
  return (
    typeof Reflect.get(value, 'runtimeId') === 'string' &&
    typeof Reflect.get(value, 'pid') === 'number'
  )
}

export function readSiblingRuntimeMetadata(userDataPath: string): RuntimeMetadata | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(getRuntimeMetadataPath(userDataPath), 'utf8'))
    return isRuntimeMetadata(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function warnIfSiblingProfileRuntimeLive(args: {
  thisUserDataPath: string
  wellKnown?: WellKnownOrcaUserDataPaths
  platform?: NodeJS.Platform
  homeDir?: string
  env?: NodeJS.ProcessEnv
  readMetadata?: (userDataPath: string) => RuntimeMetadata | null
  isPidLive?: (pid: number | null | undefined) => boolean
  warn?: (line: string) => void
}): void {
  const wellKnown =
    args.wellKnown ??
    wellKnownOrcaUserDataPaths(
      args.platform ?? process.platform,
      args.homeDir ?? homedir(),
      args.env ?? process.env
    )
  const sibling = siblingWellKnownUserDataPath(args.thisUserDataPath, wellKnown)
  if (!sibling) {
    return
  }
  const readMetadata = args.readMetadata ?? readSiblingRuntimeMetadata
  const metadata = readMetadata(sibling)
  if (!metadata) {
    return
  }
  const isPidLive = args.isPidLive ?? isProcessRunning
  if (!isPidLive(metadata.pid)) {
    return
  }
  const warn = args.warn ?? ((line: string) => console.error(line))
  warn(
    formatSiblingProfileRuntimeWarning({
      siblingPath: sibling,
      pid: metadata.pid ?? null,
      runtimeId: metadata.runtimeId
    })
  )
}
