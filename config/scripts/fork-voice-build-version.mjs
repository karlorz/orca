import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Creates a deterministic semver for fork voice development releases:
 * `<baseVersion>-fork.voice.<runNumber>.<runAttempt>.<shortSha>`
 */
export function createForkVoiceBuildVersion(baseVersion, runNumber, runAttempt, sha) {
  const match = /^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(String(baseVersion ?? ''))
  if (!match) {
    throw new Error(`Package base version is not valid semver: ${baseVersion}`)
  }

  const runNum = Number(runNumber)
  if (!Number.isInteger(runNum) || runNum < 1) {
    throw new Error(`Invalid GitHub run number: ${runNumber}`)
  }

  const runAtt = Number(runAttempt)
  if (!Number.isInteger(runAtt) || runAtt < 1) {
    throw new Error(`Invalid GitHub run attempt: ${runAttempt}`)
  }

  const cleanSha = String(sha ?? '').trim()
  if (!/^[0-9a-fA-F]{7,}$/.test(cleanSha)) {
    throw new Error(`Invalid commit SHA: ${sha}`)
  }

  const shortSha = cleanSha.slice(0, 7).toLowerCase()
  return `${match[1]}-fork.voice.${runNum}.${runAtt}.${shortSha}`
}

export function resolveForkVoiceBuildIdentity(env = process.env) {
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
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

  const version = createForkVoiceBuildVersion(packageJson.version, runNumber, runAttempt, sha)
  const shortSha = sha.slice(0, 7).toLowerCase()

  return {
    version,
    baseVersion: packageJson.version,
    runNumber,
    runAttempt,
    sha,
    shortSha
  }
}

if (process.argv[1] && process.argv[1].endsWith('fork-voice-build-version.mjs')) {
  const identity = resolveForkVoiceBuildIdentity()
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('node:fs')
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${identity.version}\nbase_version=${identity.baseVersion}\ncommit=${identity.sha}\nshort_sha=${identity.shortSha}\n`
    )
  }
  console.log(identity.version)
}
