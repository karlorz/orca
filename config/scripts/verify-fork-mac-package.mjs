import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function requireBothMacSliceEvidence(log) {
  for (const arch of ['x64', 'arm64']) {
    if (
      !log.includes(`[verify-packaged-daemon-entry] OK — ${arch} terminal host served a PTY`) ||
      !new RegExp(`\\[macos-terminal-host\\] OK — [^\\n]+\\(${arch}, macOS `).test(log)
    ) {
      throw new Error(`Missing actual PTY or helper signature success for ${arch}`)
    }
  }
}

export function requireForkSignature(details) {
  if (
    details.includes('flags=0x2(adhoc)') ||
    !details.split('\n').includes('Authority=Orca Fork (karlorz)')
  ) {
    throw new Error('Packed app must have the existing fork self-signed authority')
  }
}

export function verifyForkMacPackage(log, root, codesign) {
  requireBothMacSliceEvidence(log)
  for (const arch of ['x64', 'arm64']) {
    const app = join(root, arch === 'x64' ? 'mac' : 'mac-arm64', 'Orca.app')
    if (!existsSync(join(app, 'Contents/MacOS/orca-speech'))) {
      throw new Error(`Packed ${arch} app missing orca-speech`)
    }
    if (!(statSync(join(app, 'Contents/MacOS/orca-speech')).mode & 0o111)) {
      throw new Error(`Packed ${arch} app has non-executable orca-speech`)
    }
    codesign(['--verify', '--deep', '--strict', app])
    requireForkSignature(codesign(['-dv', '--verbose=2', app]))
    console.log(`Verified ${arch} app signature: Orca Fork (karlorz)`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyForkMacPackage(readFileSync(process.argv[2], 'utf8'), 'dist', (args) => {
    // codesign writes identity details to stderr even on success.
    const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8' })
    if (result.status !== 0 || result.error) {
      throw new Error('Packed app codesign verification failed')
    }
    return result.stderr
  })
}
