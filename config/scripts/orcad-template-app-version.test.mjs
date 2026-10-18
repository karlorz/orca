import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  assertOrcadTemplatePackageVersion,
  resolveOrcadTemplateAppVersion,
  stampOrcadTemplatePackageJson
} from './orcad-template-app-version.mjs'

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function packageFile(version) {
  const dir = mkdtempSync(join(tmpdir(), 'orcad-template-version-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'out'), { recursive: true })
  const path = join(dir, 'out', 'package.json')
  writeFileSync(path, JSON.stringify({ name: 'orca', version }))
  return path
}

describe('resolveOrcadTemplateAppVersion', () => {
  it('uses the fork voice build version', () => {
    expect(resolveOrcadTemplateAppVersion({ ORCA_FORK_VOICE_BUILD_VERSION: '1.4.227-7' })).toBe(
      '1.4.227-7'
    )
  })

  it('parses a fork desktop tag', () => {
    expect(resolveOrcadTemplateAppVersion({ FORK_DESKTOP_TAG: 'v1.4.227-6' })).toBe('1.4.227-6')
  })

  it('parses GITHUB_REF_NAME from a tag workflow', () => {
    expect(resolveOrcadTemplateAppVersion({ GITHUB_REF_NAME: 'v1.4.227-6' })).toBe('1.4.227-6')
  })

  it('prefers ORCA_FORK_VOICE_BUILD_VERSION over a tag', () => {
    expect(
      resolveOrcadTemplateAppVersion({
        ORCA_FORK_VOICE_BUILD_VERSION: '1.4.227-7',
        FORK_DESKTOP_TAG: 'v1.4.227-6'
      })
    ).toBe('1.4.227-7')
  })

  it('leaves non-fork refs unstamped', () => {
    expect(resolveOrcadTemplateAppVersion({ GITHUB_REF_NAME: 'fork-main' })).toBeNull()
    expect(resolveOrcadTemplateAppVersion({ FORK_DESKTOP_TAG: 'v1.4.227' })).toBeNull()
    expect(resolveOrcadTemplateAppVersion({})).toBeNull()
  })
})

describe('stampOrcadTemplatePackageJson', () => {
  it('rewrites the version the managed server reports', () => {
    const path = packageFile('1.4.214')
    expect(stampOrcadTemplatePackageJson(path, '1.4.227-6')).toEqual({
      changed: true,
      version: '1.4.227-6'
    })
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe('1.4.227-6')
  })

  it('is a no-op when the stamp already matches', () => {
    const path = packageFile('1.4.227-6')
    expect(stampOrcadTemplatePackageJson(path, '1.4.227-6')).toEqual({
      changed: false,
      version: '1.4.227-6'
    })
  })
})

describe('assertOrcadTemplatePackageVersion', () => {
  it('accepts a template stamped to the fork tag', () => {
    const path = packageFile('1.4.227-6')
    expect(assertOrcadTemplatePackageVersion(path, { FORK_DESKTOP_TAG: 'v1.4.227-6' })).toBe(
      '1.4.227-6'
    )
  })

  it('refuses a leftover repo package version', () => {
    const path = packageFile('1.4.214')
    expect(() =>
      assertOrcadTemplatePackageVersion(path, { ORCA_FORK_VOICE_BUILD_VERSION: '1.4.227-6' })
    ).toThrow(/1\.4\.214/)
  })
})

describe('template build workflows', () => {
  it('passes the tag name into the merged desktop template build', () => {
    const workflow = parse(readFileSync('.github/workflows/node-server-tests.yml', 'utf8'))
    const build = workflow.jobs.desktop_template.steps.find(
      (step) => step.run === 'pnpm build:orcad-template'
    )
    expect(build.env.FORK_DESKTOP_TAG).toBe('${{ github.ref_name }}')
  })
})
