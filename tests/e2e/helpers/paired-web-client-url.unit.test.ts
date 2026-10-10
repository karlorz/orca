import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { createPairedWebClientUrl } from './paired-web-client-url'

it('pins stall-recovery clients to disable auto-recovery so ACK-held assertions can run', () => {
  expect(
    createPairedWebClientUrl('https://example.test/pair?token=1', {
      disableRemoteTerminalStallRecovery: true
    })
  ).toContain('orcaE2EDisableRemoteTerminalStallRecovery=1')
  const spec = readFileSync(
    new URL('../paired-remote-terminal-stall-recovery.spec.ts', import.meta.url),
    'utf8'
  )
  expect(spec).toContain('disableRemoteTerminalStallRecovery: true')
  expect(spec).toContain("Reflect.get(gate, 'recover')")
})
