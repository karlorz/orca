import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runProcessSync } from '@orca/process-host'

it('keeps native TypeScript installer imports valid for type-aware config readers', () => {
  const result = runProcessSync({
    program: process.execPath,
    args: [
      resolve('node_modules/typescript/bin/tsc'),
      '--showConfig',
      '-p',
      'config/tsconfig.node.json'
    ],
    timeoutMs: 10_000
  })
  expect(result.code, result.stderr).toBe(0)
  const config = JSON.parse(result.stdout)
  expect(config.compilerOptions.allowImportingTsExtensions).toBe(true)
  expect(config.compilerOptions.noEmit).toBe(true)
  expect(config.compilerOptions.strict).toBe(true)
  expect(config.compilerOptions.noUnusedLocals).toBe(true)
  expect(config.compilerOptions.noUnusedParameters).toBe(true)
})

describe.skipIf(process.platform !== 'linux' || process.arch !== 'x64')(
  'home AppImage installer',
  () => {
    it('recognizes the existing CLI command catalog', () => {
      const catalog = readFileSync(resolve('src/main/startup/cli-command-names.ts'), 'utf8')
      const launcher = readFileSync(resolve('config/scripts/orca-home-launcher.sh'), 'utf8')
      for (const match of catalog.matchAll(/'([a-z-]+)'/g)) {
        if (match[1] === 'serve') {
          continue
        }
        expect(launcher).toMatch(new RegExp(`(?:[ |])${match[1]}[|)]`))
      }
    })

    it('installs, restores the pin, rejects unsafe artifacts, and preserves launch arguments', () => {
      const result = runProcessSync({
        program: 'bash',
        args: [resolve('config/scripts/test-orca-home-appimage.sh')],
        env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' },
        timeoutMs: 30_000
      })
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain('home AppImage install/restore/launcher contracts passed')
    })
  }
)
