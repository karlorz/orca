import { vi } from 'vitest'

/** Factories the test file's hoisted `vi.mock` calls already registered; re-applied after resetModules. */
export type DaemonInitPinFactories = {
  fs: () => object
  net: () => object
  ptyProviderRegistry: () => object
  ptyListenerLifecycle: () => object
  daemonSpawner: () => object
  daemonPtyAdapter: () => object
}

/**
 * bun's first import after resetModules can miss hoisted vi.mock factories (real ipc/pty
 * barrel loads, setLocalPtyProviderMock stays at 0). Re-pin, then load ipc/pty first.
 */
export async function pinDaemonInitMocksAfterReset(
  factories: DaemonInitPinFactories
): Promise<void> {
  vi.doMock('fs', factories.fs)
  vi.doMock('node:fs', factories.fs)
  vi.doMock('net', factories.net)
  vi.doMock('node:net', factories.net)
  vi.doMock('../ipc/pty/provider/registry', factories.ptyProviderRegistry)
  vi.doMock('../ipc/pty/provider/listener-lifecycle', factories.ptyListenerLifecycle)
  vi.doMock('./daemon-spawner', factories.daemonSpawner)
  vi.doMock('./daemon-pty-adapter', factories.daemonPtyAdapter)
  await import('../ipc/pty/provider/registry')
}
