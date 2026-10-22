import { readdir, readFile } from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import { parseDaemonPidFile, type ParsedDaemonPid } from '../main/daemon/daemon-pid-file-parse'
import type { HomeLiveDaemonState } from '../main/home-appimage-release-policy'

const PID_FILE_PATTERN = /^daemon-v(\d+)\.pid$/
const INVENTORY_TIMEOUT_MS = 5_000
const INVENTORY_TIMEOUT_MESSAGE = 'Daemon inventory timed out'

export type DaemonRecordInspection = 'live' | 'exited' | 'unverifiable'

export type HomeDaemonInventoryHost = {
  readdir(runtimeDir: string): Promise<string[]>
  readPidFile(path: string): Promise<string>
  inspectRecord(record: ParsedDaemonPid): Promise<DaemonRecordInspection>
  queryInventory(protocolVersion: number): Promise<void>
}

export function createProductionHomeDaemonInventoryHost(
  runtimeDir: string
): HomeDaemonInventoryHost {
  return {
    readdir: (dir) => readdir(dir),
    readPidFile: (path) => readFile(path, 'utf8'),
    inspectRecord: inspectHomeDaemonPidRecord,
    queryInventory: (protocolVersion) => queryHomeDaemonInventory(runtimeDir, protocolVersion)
  }
}

export async function probeLiveHomeDaemonProtocols(
  userDataPath: string,
  host?: HomeDaemonInventoryHost
): Promise<readonly number[] | null> {
  return (await probeHomeDaemonState(userDataPath, host)).protocols
}

/**
 * Verified live daemon generations under one profile, or why none could be verified.
 * Exited generations are skipped; anything unverifiable fails the whole inventory closed.
 */
export async function probeHomeDaemonState(
  userDataPath: string,
  host?: HomeDaemonInventoryHost
): Promise<HomeLiveDaemonState> {
  const runtimeDir = join(userDataPath, 'daemon')
  const inventory = host ?? createProductionHomeDaemonInventoryHost(runtimeDir)
  let names: string[]
  try {
    names = await inventory.readdir(runtimeDir)
  } catch (error) {
    return isMissingFile(error)
      ? { protocols: null, reason: 'none-live', detail: 'no daemon directory' }
      : { protocols: null, reason: 'unavailable', detail: 'daemon directory unreadable' }
  }
  const generations = names.flatMap((name) => {
    const version = Number(PID_FILE_PATTERN.exec(name)?.[1])
    return Number.isSafeInteger(version) && version > 0 ? [version] : []
  })
  const live: number[] = []
  for (const protocolVersion of generations.sort((left, right) => left - right)) {
    const verdict = await inspectGeneration(runtimeDir, protocolVersion, inventory)
    if (verdict === 'unverifiable') {
      return {
        protocols: null,
        reason: 'adapter-error',
        detail: `protocol ${protocolVersion} pid record unverifiable`
      }
    }
    if (verdict === 'live') {
      try {
        await inventory.queryInventory(protocolVersion)
      } catch (error) {
        const timedOut = error instanceof Error && error.message === INVENTORY_TIMEOUT_MESSAGE
        return {
          protocols: null,
          reason: timedOut ? 'timeout' : 'adapter-error',
          detail: `protocol ${protocolVersion}`
        }
      }
      live.push(protocolVersion)
    }
  }
  return live.length > 0
    ? { protocols: live }
    : { protocols: null, reason: 'none-live', detail: 'no live daemon record' }
}

export async function inspectHomeDaemonPidRecord(
  record: ParsedDaemonPid
): Promise<DaemonRecordInspection> {
  try {
    process.kill(record.pid, 0)
  } catch (error) {
    return isNoSuchProcess(error) ? 'exited' : 'unverifiable'
  }
  if (!record.linuxStartTicks) {
    return 'unverifiable'
  }
  try {
    const startTicks = parseStartTicks(await readFile(`/proc/${record.pid}/stat`, 'utf8'))
    if (!startTicks) {
      return 'unverifiable'
    }
    if (startTicks !== record.linuxStartTicks) {
      return 'unverifiable'
    }
    if (record.bootId) {
      const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
      if (bootId !== record.bootId) {
        return 'unverifiable'
      }
    }
    return 'live'
  } catch {
    return 'unverifiable'
  }
}

async function inspectGeneration(
  runtimeDir: string,
  protocolVersion: number,
  host: HomeDaemonInventoryHost
): Promise<DaemonRecordInspection> {
  let contents: string
  try {
    contents = await host.readPidFile(join(runtimeDir, `daemon-v${protocolVersion}.pid`))
  } catch (error) {
    return isMissingFile(error) ? 'exited' : 'unverifiable'
  }
  const parsed = parseDaemonPidFile(contents)
  if (!parsed || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
    return 'unverifiable'
  }
  return host.inspectRecord(parsed)
}

async function queryHomeDaemonInventory(
  runtimeDir: string,
  protocolVersion: number
): Promise<void> {
  const socketPath = join(runtimeDir, `daemon-v${protocolVersion}.sock`)
  const token = (
    await readFile(join(runtimeDir, `daemon-v${protocolVersion}.token`), 'utf8')
  ).trim()
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let sock: Socket | null = null
    let buffer = ''
    const settle = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      sock?.destroy()
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const timer = setTimeout(
      () => settle(new Error(INVENTORY_TIMEOUT_MESSAGE)),
      INVENTORY_TIMEOUT_MS
    )
    timer.unref()
    sock = connect({ path: socketPath })
    sock.on('error', () => settle(new Error('Daemon inventory socket failed')))
    sock.on('connect', () => {
      sock?.write(
        `${JSON.stringify({
          type: 'hello',
          version: protocolVersion,
          token,
          clientId: 'home-appimage-update',
          role: 'control'
        })}\n`
      )
    })
    sock.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline === -1) {
          break
        }
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (!line) {
          continue
        }
        let message: { type?: unknown; ok?: unknown; id?: unknown }
        try {
          message = JSON.parse(line)
        } catch {
          settle(new Error('Daemon inventory returned invalid JSON'))
          return
        }
        if (message.type === 'hello') {
          if (message.ok !== true) {
            settle(new Error('Daemon inventory handshake was rejected'))
            return
          }
          sock?.write(`${JSON.stringify({ id: 'inventory-1', type: 'listSessions' })}\n`)
          continue
        }
        if (message.id === 'inventory-1') {
          settle(message.ok === true ? undefined : new Error('Daemon inventory request failed'))
        }
      }
    })
  })
}

function parseStartTicks(statLine: string): string | null {
  const commandEnd = statLine.lastIndexOf(')')
  if (commandEnd === -1) {
    return null
  }
  const startTicks = statLine
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/)[19]
  return startTicks && /^\d+$/.test(startTicks) ? startTicks : null
}

function isNoSuchProcess(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
