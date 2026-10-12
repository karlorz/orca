import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { verifyForkMacPackage } from './verify-fork-mac-package.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
const log = ['x64', 'arm64']
  .map(
    (arch) =>
      `[verify-packaged-daemon-entry] OK — ${arch} terminal host served a PTY\n[macos-terminal-host] OK — /fixture/helper (${arch}, macOS 13.5+)`
  )
  .join('\n')
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fork-mac-signatures-'))
  roots.push(root)
  for (const directory of ['mac', 'mac-arm64']) {
    const executable = join(root, directory, 'Orca.app/Contents/MacOS/orca-speech')
    mkdirSync(join(root, directory, 'Orca.app/Contents/MacOS'), { recursive: true })
    writeFileSync(executable, 'fixture', { mode: 0o755 })
  }
  return root
}
it('checks both app signatures and both exact authorities through a mocked signer', () => {
  const root = fixture()
  const calls = []
  verifyForkMacPackage(log, root, (args) => {
    calls.push(args)
    return 'Authority=Orca Fork (karlorz)\n'
  })
  expect(calls).toHaveLength(4)
  expect(calls[0]).toEqual(['--verify', '--deep', '--strict', join(root, 'mac/Orca.app')])
  expect(calls[2]).toEqual(['--verify', '--deep', '--strict', join(root, 'mac-arm64/Orca.app')])
})
it('fails when the second app has a different authority or its signature fails', () => {
  const root = fixture()
  expect(() =>
    verifyForkMacPackage(log, root, (args) =>
      args.at(-1).includes('mac-arm64') ? 'Authority=other' : 'Authority=Orca Fork (karlorz)\n'
    )
  ).toThrow(/authority/)
  expect(() =>
    verifyForkMacPackage(log, root, () => {
      throw new Error('signature failed')
    })
  ).toThrow()
})
it('fails with missing slice evidence or missing speech helper before accepting packaging', () => {
  const root = fixture()
  expect(() => verifyForkMacPackage('', root, () => 'Authority=Orca Fork (karlorz)')).toThrow(/PTY/)
  rmSync(join(root, 'mac-arm64/Orca.app/Contents/MacOS/orca-speech'))
  expect(() => verifyForkMacPackage(log, root, () => 'Authority=Orca Fork (karlorz)')).toThrow(
    /missing orca-speech/
  )
})
