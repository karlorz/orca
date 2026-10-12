import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const cleanup = new URL('./fork-macos-cleanup-identity.sh', import.meta.url)
const trust = new URL('./fork-macos-trust-self-signed-identity.sh', import.meta.url)
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function fixture(importFailure = false) {
  const root = mkdtempSync(join(tmpdir(), 'fork-signing-cleanup-'))
  roots.push(root)
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'security'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$RUNNER_TEMP/operations"
case "$1" in
  list-keychains)
    if [[ "$*" == *' -s '* ]]; then
      [[ "\u0024{FAIL_RESTORE:-}" != 1 ]] || exit 1
    else
      printf '    "/fixture/login.keychain-db"\\n'
    fi ;;
  create-keychain) touch "\u0024{!#}" ;;
  import) [[ "\u0024{FAIL_IMPORT:-}" != 1 ]] || exit 1 ;;
  delete-keychain)
    [[ "\u0024{FAIL_DELETE:-}" != 1 ]] || exit 1
    rm "$2" ;;
  find-identity) echo '1) fixture "Orca Fork (karlorz)"' ;;
esac
`,
    { mode: 0o755 }
  )
  const env = {
    ...process.env,
    RUNNER_TEMP: root,
    PATH: `${bin}:${process.env.PATH}`,
    CSC_LINK: Buffer.from('fixture-p12').toString('base64'),
    CSC_KEY_PASSWORD: 'fixture-password',
    CSC_NAME: 'Orca Fork (karlorz)'
  }
  if (importFailure) {
    expect(() =>
      execFileSync('bash', [trust.pathname], {
        env: { ...env, FAIL_IMPORT: '1' },
        stdio: 'pipe'
      })
    ).toThrow()
  } else {
    execFileSync('bash', [trust.pathname], { env, stdio: 'pipe' })
  }
  return { root, env }
}

describe.skipIf(process.platform === 'win32')(
  'temporary identity cleanup with mocked security CLI',
  () => {
    it('removes imported temporary identity and restores the original keychain list', () => {
      const { root, env } = fixture()
      const result = execFileSync('bash', [cleanup.pathname], { env, encoding: 'utf8' })
      expect(result).toContain('identity removed')
      expect(readFileSync(join(root, 'operations'), 'utf8')).toContain(
        'list-keychains -d user -s /fixture/login.keychain-db'
      )
      expect(() => readFileSync(join(root, 'orca-fork-codesign/identity.p12'))).toThrow()
      expect(() =>
        readFileSync(join(root, 'orca-fork-codesign/fork-codesign.keychain-db'))
      ).toThrow()
      expect(result).not.toContain('fixture-password')
    })
    it('attempts key deletion and p12 removal even if restoring the list fails', () => {
      const { root, env } = fixture()
      expect(() =>
        execFileSync('bash', [cleanup.pathname], {
          env: { ...env, FAIL_RESTORE: '1' },
          stdio: 'pipe'
        })
      ).toThrow()
      expect(readFileSync(join(root, 'operations'), 'utf8')).toContain('delete-keychain')
      expect(() => readFileSync(join(root, 'orca-fork-codesign/identity.p12'))).toThrow()
    })
    it('cleans a partial import after keychain creation and p12 decode', () => {
      const { root, env } = fixture(true)
      expect(readFileSync(join(root, 'orca-fork-codesign/identity.p12'), 'utf8')).toBe(
        'fixture-p12'
      )
      execFileSync('bash', [cleanup.pathname], { env, stdio: 'pipe' })
      expect(readFileSync(join(root, 'operations'), 'utf8')).toContain('delete-keychain')
      expect(() => readFileSync(join(root, 'orca-fork-codesign/identity.p12'))).toThrow()
      expect(() =>
        readFileSync(join(root, 'orca-fork-codesign/fork-codesign.keychain-db'))
      ).toThrow()
    })
    it('reports keychain deletion failure while still removing p12 material', () => {
      const { root, env } = fixture()
      expect(() =>
        execFileSync('bash', [cleanup.pathname], {
          env: { ...env, FAIL_DELETE: '1' },
          stdio: 'pipe'
        })
      ).toThrow()
      expect(() => readFileSync(join(root, 'orca-fork-codesign/identity.p12'))).toThrow()
    })
  }
)
