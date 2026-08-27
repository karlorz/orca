import { execFileSync } from 'node:child_process'
import { createForkVoiceBuildVersion } from './fork-voice-build-version.mjs'

const FORK_DESKTOP_TAG_STRICT = /^v(\d+\.\d+\.\d+)-\d+$/

export function parseForkDesktopTagBase(tag) {
  const cleanTag = String(tag ?? '')
    .trim()
    .replace(/^refs\/tags\//, '')
  const match = FORK_DESKTOP_TAG_STRICT.exec(cleanTag)
  if (!match) {
    throw new Error(`Tag is not a valid fork desktop tag (v<x.y.z>-<N>): ${tag}`)
  }
  return match[1]
}

export function resolveForkDesktopBuildIdentity(env = process.env, argv = process.argv) {
  const rawTag = env.FORK_DESKTOP_TAG || argv[2] || ''
  if (!rawTag) {
    throw new Error('FORK_DESKTOP_TAG env or tag argument is required')
  }

  const baseVersion = parseForkDesktopTagBase(rawTag)
  const runNumber = env.GITHUB_RUN_NUMBER ?? '1'
  const runAttempt = env.GITHUB_RUN_ATTEMPT ?? '1'

  let sha = env.GITHUB_SHA ?? env.ORCA_BUILD_COMMIT ?? ''
  if (!sha) {
    try {
      sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    } catch {
      sha = '0000000000000000000000000000000000000000'
    }
  }

  const version = createForkVoiceBuildVersion(baseVersion, runNumber, runAttempt, sha)
  const shortSha = sha.slice(0, 7).toLowerCase()

  return {
    version,
    baseVersion,
    runNumber,
    runAttempt,
    sha,
    shortSha
  }
}

if (process.argv[1] && process.argv[1].endsWith('fork-desktop-build-version.mjs')) {
  const identity = resolveForkDesktopBuildIdentity()
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('node:fs')
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${identity.version}\nbase_version=${identity.baseVersion}\ncommit=${identity.sha}\nshort_sha=${identity.shortSha}\n`
    )
  }
  console.log(identity.version)
}
