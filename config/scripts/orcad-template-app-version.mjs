import { readFileSync, writeFileSync } from 'node:fs'
import { parseForkDesktopTag } from './fork-desktop-build-version.mjs'

const FORK_DESKTOP_VERSION = /^\d+\.\d+\.\d+-\d+$/

/**
 * Version a managed orcad template should report in `out/package.json`.
 * Fork desktop tags stamp `1.4.227-6`; other builds leave the repo package version.
 */
export function resolveOrcadTemplateAppVersion(env = process.env) {
  const forkVoice = String(env.ORCA_FORK_VOICE_BUILD_VERSION ?? '').trim()
  if (FORK_DESKTOP_VERSION.test(forkVoice)) {
    return forkVoice
  }
  for (const raw of [env.FORK_DESKTOP_TAG, env.GITHUB_REF_NAME]) {
    if (!raw) {
      continue
    }
    try {
      return parseForkDesktopTag(raw).canonicalVersion
    } catch {
      // Branch names and upstream tags are not fork desktop versions.
    }
  }
  return null
}

export function stampOrcadTemplatePackageJson(packageJsonPath, version) {
  if (!FORK_DESKTOP_VERSION.test(version) && !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid orcad template app version: ${version}`)
  }
  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`orcad template package.json is not an object: ${packageJsonPath}`)
  }
  if (typeof parsed.version !== 'string') {
    throw new Error(`orcad template package.json has no version: ${packageJsonPath}`)
  }
  if (parsed.version === version) {
    return { changed: false, version }
  }
  parsed.version = version
  writeFileSync(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`)
  return { changed: true, version }
}

export function assertOrcadTemplatePackageVersion(packageJsonPath, env = process.env) {
  const expected = resolveOrcadTemplateAppVersion(env)
  if (!expected) {
    throw new Error(
      'No fork desktop version in ORCA_FORK_VOICE_BUILD_VERSION, FORK_DESKTOP_TAG, or GITHUB_REF_NAME'
    )
  }
  const actual = JSON.parse(readFileSync(packageJsonPath, 'utf8')).version
  if (actual !== expected) {
    throw new Error(
      `orcad-template out/package.json is ${actual}, expected ${expected} so managed servers report the fork desktop version`
    )
  }
  return actual
}

if (process.argv[1]?.endsWith('orcad-template-app-version.mjs')) {
  const assertIndex = process.argv.indexOf('--assert-file')
  if (assertIndex !== -1) {
    const file = process.argv[assertIndex + 1]
    if (!file) {
      throw new Error('--assert-file needs a path')
    }
    process.stdout.write(`${assertOrcadTemplatePackageVersion(file)}\n`)
  }
}
