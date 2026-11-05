import type { ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'

export const PROCESS_EXIT_TIMEOUT_MS = 5_000
const FORCE_KILL_WAIT_MS = 2_000

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // ast-grep-ignore: test-no-real-time-wait -- SIGTERM/SIGKILL trees have no test clock; the OS reaps them.
    const timeout = setTimeout(resolve, ms)
    timeout.unref?.()
  })
}

export function hasExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null
}

export function releaseExitedProcessPipes(proc: ChildProcess): void {
  if (!hasExited(proc)) {
    return
  }
  // Detached SSH helpers can retain inherited pipes after Electron itself exits.
  for (const stream of proc.stdio) {
    stream?.destroy()
  }
}

export function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(proc)) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (exited: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      proc.off('exit', onExit)
      proc.off('close', onExit)
      resolve(exited)
    }
    const onExit = (): void => finish(true)
    // ast-grep-ignore: test-no-real-time-wait -- child exit is an OS event; the timeout only bounds hang.
    const timeout = setTimeout(() => finish(false), timeoutMs)
    timeout.unref?.()
    proc.once('exit', onExit)
    proc.once('close', onExit)
  })
}

export function readPosixDescendantPids(rootPid: number): number[] {
  try {
    const output = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' })
    const childrenByParent = new Map<number, number[]>()
    for (const line of output.split('\n')) {
      const [pidText, ppidText] = line.trim().split(/\s+/)
      const pid = Number(pidText)
      const ppid = Number(ppidText)
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) {
        continue
      }
      const children = childrenByParent.get(ppid) ?? []
      children.push(pid)
      childrenByParent.set(ppid, children)
    }

    const descendants: number[] = []
    const stack = [...(childrenByParent.get(rootPid) ?? [])]
    while (stack.length > 0) {
      const pid = stack.pop()
      if (!pid) {
        continue
      }
      descendants.push(pid)
      stack.push(...(childrenByParent.get(pid) ?? []))
    }
    return descendants
  } catch {
    return []
  }
}

export function killPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    /* already dead or inaccessible */
  }
}

function hasPidExited(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH'
  }
}

export async function forceKillPidTree(pid: number): Promise<void> {
  if (!pid) {
    return
  }

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      /* already dead or taskkill unavailable */
    }
    return
  }

  // Capture descendants before killing the root or reparenting can strand Electron/shell children.
  const pids = [...readPosixDescendantPids(pid), pid]
  for (const targetPid of [...pids].toReversed()) {
    killPid(targetPid, 'SIGTERM')
  }
  const deadline = performance.now() + FORCE_KILL_WAIT_MS
  // ast-grep-ignore: test-no-polling-loop -- SIGTERM descendants have no test-side exited event.
  while (true) {
    if (pids.every(hasPidExited)) {
      return
    }
    const remainingMs = deadline - performance.now()
    if (remainingMs <= 0) {
      break
    }
    // ast-grep-ignore: test-no-real-time-wait -- SIGTERM descendants have no test-side exited event.
    await delay(Math.min(50, remainingMs))
  }
  for (const targetPid of [...pids].toReversed()) {
    killPid(targetPid, 'SIGKILL')
  }
}

export async function forceKillProcessTree(proc: ChildProcess): Promise<void> {
  const pid = proc.pid
  if (!pid || hasExited(proc)) {
    return
  }

  await forceKillPidTree(pid)
  await waitForExit(proc, PROCESS_EXIT_TIMEOUT_MS)
}
