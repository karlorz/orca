import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  createForkVoiceBuildVersion,
  resolveForkVoiceBuildIdentity
} from './fork-voice-build-version.mjs'
import {
  generateSha256Sums,
  buildReleaseMetadata,
  buildTestSummaryMarkdown,
  verifyReleaseChecksums
} from './fork-voice-release-metadata.mjs'
import { packageDraftRelease } from './fork-voice-package-release.mjs'

const require = createRequire(import.meta.url)
const projectDir = resolve(import.meta.dirname, '../..')
const workflowPath = join(projectDir, '.github/workflows/fork-mobile-voice-release.yml')

const readWorkflow = () => {
  if (!existsSync(workflowPath)) {
    throw new Error(`Workflow file does not exist: ${workflowPath}`)
  }
  return parse(readFileSync(workflowPath, 'utf8'))
}

const MUTABLE_BUILD_ENV = [
  'ORCA_FORK_VOICE_BUILD',
  'ORCA_FORK_VOICE_BUILD_VERSION',
  'ORCA_BUILD_COMMIT',
  'ORCA_MAC_HOURLY',
  'ORCA_MAC_DAILY',
  'ORCA_MAC_ADHOC',
  'ORCA_MAC_RELEASE',
  'ORCA_HOURLY_BUILD_VERSION',
  'ORCA_DAILY_BUILD_VERSION',
  'ORCA_ADHOC_BUILD_VERSION',
  'ORCA_LOCAL_BUILD_VERSION',
  'CSC_LINK',
  'CSC_NAME',
  'CSC_KEY_PASSWORD'
]

function withEnv(env, assert) {
  const configPath = require.resolve('../electron-builder.config.cjs')
  const original = Object.fromEntries(MUTABLE_BUILD_ENV.map((key) => [key, process.env[key]]))
  try {
    for (const key of MUTABLE_BUILD_ENV) {
      delete process.env[key]
    }
    Object.assign(process.env, env)
    delete require.cache[configPath]
    assert(require('../electron-builder.config.cjs'))
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    delete require.cache[configPath]
    require('../electron-builder.config.cjs')
  }
}

describe('fork voice build versioning', () => {
  it('creates valid semver from base version, run number, attempt, and short sha', () => {
    const version = createForkVoiceBuildVersion('1.4.178-rc.2', 42, 1, 'abcdef123456')
    expect(version).toBe('1.4.178-fork.voice.42.1.abcdef1')
    expect(/^(\d+\.\d+\.\d+)-fork\.voice\.\d+\.\d+\.[0-9a-f]{7,}$/.test(version)).toBe(true)
  })

  it('rejects invalid inputs for fork build version', () => {
    expect(() => createForkVoiceBuildVersion('invalid', 42, 1, 'abcdef123456')).toThrow()
    expect(() => createForkVoiceBuildVersion('1.4.178', -1, 1, 'abcdef123456')).toThrow()
    expect(() => createForkVoiceBuildVersion('1.4.178', 42, 0, 'abcdef123456')).toThrow()
    expect(() => createForkVoiceBuildVersion('1.4.178', 42, 1, '')).toThrow()
  })

  it('resolves identity from environment and package.json', () => {
    const identity = resolveForkVoiceBuildIdentity({
      GITHUB_RUN_NUMBER: '10',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567'
    })
    expect(identity.version).toContain('-fork.voice.10.2.0123456')
    expect(identity.shortSha).toBe('0123456')
  })
})

describe('fork voice electron-builder config gate', () => {
  it('when ORCA_FORK_VOICE_BUILD=1, points to karlorz/orca prerelease and ad-hoc unsigned mode with canonical X.Y.Z-N version', () => {
    withEnv(
      {
        ORCA_FORK_VOICE_BUILD: '1',
        ORCA_FORK_VOICE_BUILD_VERSION: '1.4.190-4'
      },
      (config) => {
        expect(config.publish).toEqual({
          provider: 'github',
          owner: 'karlorz',
          repo: 'orca',
          releaseType: 'prerelease'
        })
        expect(config.extraMetadata).toEqual({
          version: '1.4.190-4'
        })
        expect(config.mac.identity).toBe('-')
        expect(config.mac.hardenedRuntime).toBe(false)
        expect(config.mac.notarize).toBe(false)
        expect(config.forceCodeSigning).toBe(false)
        expect(config.mac.artifactName).toBe('orca-macos-${arch}.${ext}')
        expect(config.dmg.artifactName).toBe('orca-macos-${arch}.${ext}')
      }
    )
  })

  it('fails closed when ORCA_FORK_VOICE_BUILD=1 but ORCA_FORK_VOICE_BUILD_VERSION is missing, malformed, or legacy fork.voice', () => {
    expect(() => {
      withEnv({ ORCA_FORK_VOICE_BUILD: '1' }, () => {})
    }).toThrow('Invalid or missing ORCA_FORK_VOICE_BUILD_VERSION')

    expect(() => {
      withEnv(
        { ORCA_FORK_VOICE_BUILD: '1', ORCA_FORK_VOICE_BUILD_VERSION: 'invalid-version' },
        () => {}
      )
    }).toThrow('Invalid or missing ORCA_FORK_VOICE_BUILD_VERSION')

    expect(() => {
      withEnv(
        {
          ORCA_FORK_VOICE_BUILD: '1',
          ORCA_FORK_VOICE_BUILD_VERSION: '1.4.190-fork.voice.1.1.abcdef1'
        },
        () => {}
      )
    }).toThrow('Invalid or missing ORCA_FORK_VOICE_BUILD_VERSION')
  })

  it('when ORCA_FORK_VOICE_BUILD=1 and CSC_LINK is set, skips electron-builder identity lookup and does not notarize', () => {
    withEnv(
      {
        ORCA_FORK_VOICE_BUILD: '1',
        ORCA_FORK_VOICE_BUILD_VERSION: '1.4.190-7',
        CSC_LINK: 'dGVzdA==',
        CSC_NAME: 'Orca Fork (karlorz)'
      },
      (config) => {
        expect(config.mac.identity).toBeNull()
        expect(config.forceCodeSigning).toBe(false)
        expect(config.mac.hardenedRuntime).toBe(false)
        expect(config.mac.notarize).toBe(false)
        expect(config.publish).toEqual({
          provider: 'github',
          owner: 'karlorz',
          repo: 'orca',
          releaseType: 'prerelease'
        })
      }
    )
  })

  it('when ORCA_FORK_VOICE_BUILD is absent, preserves stablyai upstream defaults byte-for-byte', () => {
    withEnv({}, (config) => {
      expect(config.publish).toEqual({
        provider: 'github',
        owner: 'stablyai',
        repo: 'orca',
        releaseType: 'release'
      })
      expect(config.mac.identity).toBeUndefined()
      expect(config.mac.hardenedRuntime).toBe(false)
      expect(config.mac.notarize).toBe(false)
      expect(config.forceCodeSigning).toBe(false)
    })
  })
})

describe('mobile version increment contract', () => {
  it('mobile/app.json stays on upstream marketing 0.0.44 with a higher versionCode', () => {
    const appJson = JSON.parse(readFileSync(join(projectDir, 'mobile/app.json'), 'utf8'))
    expect(appJson.expo.version).toBe('0.0.44')
    expect(appJson.expo.android.versionCode).toBeGreaterThanOrEqual(15)
    expect(appJson.expo.android.package).toBe('com.stably.orca.mobile')
  })
})

describe('release metadata and checksum helpers', () => {
  it('generates deterministic SHA256SUMS and validates them', () => {
    const files = {
      'orca-macos-arm64.dmg': Buffer.from('dmg-content-test'),
      'orca-macos-arm64.zip': Buffer.from('zip-content-test'),
      'orca-mobile.apk': Buffer.from('apk-content-test')
    }
    const sums = generateSha256Sums(files)
    expect(sums).toContain('orca-macos-arm64.dmg')
    expect(sums).toContain('orca-macos-arm64.zip')
    expect(sums).toContain('orca-mobile.apk')

    const verified = verifyReleaseChecksums(sums, files)
    expect(verified).toBe(true)
  })

  it('builds BUILD-METADATA.json with exact required signing mode and structure', () => {
    const metadata = buildReleaseMetadata({
      sourceSha: '0123456789abcdef',
      tag: 'fork-voice-v1.4.178-0.0.45',
      runId: '123456789',
      runNumber: '5',
      runAttempt: '1',
      repository: 'karlorz/orca',
      rootVersion: '1.4.178',
      mobileVersion: '0.0.45',
      mobileVersionCode: 14,
      macMetadata: { nodeVersion: 'v24.0.0', arch: 'arm64' },
      androidMetadata: { javaVersion: '17', ndkVersion: 'none' },
      artifacts: ['orca-macos-arm64.dmg', 'orca-macos-arm64.zip', 'orca-mobile.apk']
    })

    expect(metadata.signingMode).toBe('ad-hoc/development; not notarized')
    expect(metadata.repository).toBe('karlorz/orca')
    expect(metadata.tag).toBe('fork-voice-v1.4.178-0.0.45')
  })

  it('dynamically derives root and mobile versions in packageDraftRelease from committed manifests', async () => {
    const tempDir = join(projectDir, 'config/scripts/test-fixtures-draft')
    const artifactsDir = join(tempDir, 'artifacts')
    const outputDir = join(tempDir, 'output')

    const fs = await import('node:fs')
    fs.mkdirSync(artifactsDir, { recursive: true })
    fs.writeFileSync(join(artifactsDir, 'orca-mobile.apk'), 'apk')

    try {
      const result = await packageDraftRelease({
        artifactsDir,
        outputDir,
        sourceSha: 'abcdef1234567890',
        tag: 'fork-voice-v1.4.178-0.0.45',
        runId: '100',
        runNumber: '1',
        runAttempt: '1',
        repository: 'karlorz/orca'
      })

      const pkgJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
      const appJson = JSON.parse(readFileSync(join(projectDir, 'mobile/app.json'), 'utf8'))

      expect(result.metadata.rootVersion).toBe(pkgJson.version)
      expect(result.metadata.mobileVersion).toBe(appJson.expo.version)
      expect(result.metadata.mobileVersionCode).toBe(appJson.expo.android.versionCode)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('builds TEST-SUMMARY.md naming verification gates', () => {
    const summary = buildTestSummaryMarkdown({
      verificationPassed: true,
      commands: [
        'pnpm vitest run src/main/runtime/pet-voice-relay.test.ts',
        'pnpm run audit:code-quality:native',
        'pnpm run audit:code-quality:type-aware',
        'pnpm run check:reliability-gates',
        'pnpm run check:max-lines-ratchet',
        'pnpm run check:runtime-electron-ratchet',
        'pnpm typecheck',
        'cd mobile && pnpm typecheck',
        'cd mobile && pnpm test'
      ]
    })
    expect(summary).toContain('Verification Gates')
    expect(summary).toContain('pet-voice-relay.test.ts')
    expect(summary).toContain('check:reliability-gates')
  })
})

describe('fork mobile voice release workflow safety contract', () => {
  it('triggers only on push of mobile-android-vX.Y.Z-N tags', () => {
    const wf = readWorkflow()
    const triggers = wf.on ?? wf[true]
    expect(triggers.push).toBeDefined()
    expect(triggers.push.tags).toEqual(['mobile-android-v*.*.*-*'])
    expect(triggers.pull_request).toBeUndefined()
  })

  it('fences every job to github.repository == "karlorz/orca"', () => {
    const wf = readWorkflow()
    for (const [_jobName, job] of Object.entries(wf.jobs)) {
      expect(job.if).toBe("github.repository == 'karlorz/orca'")
    }
  })

  it('restricts top-level permissions to read-only, and gives contents:write only to final release job', () => {
    const wf = readWorkflow()
    expect(wf.permissions).toEqual({ contents: 'read' })

    const jobs = wf.jobs
    expect(jobs.verify.permissions).toBeUndefined()
    expect(jobs['build-mac-arm64']).toBeUndefined()
    expect(jobs['build-android'].permissions).toBeUndefined()
    expect(jobs['publish-release'].permissions).toEqual({ contents: 'write' })
    expect(jobs['publish-release'].needs).toEqual(['verify', 'build-android'])
  })

  it('configures checkout with persist-credentials: false and performs reachability check against fork-main with non-empty tag regex', () => {
    const wf = readWorkflow()
    for (const [_jobName, job] of Object.entries(wf.jobs)) {
      if (job.steps) {
        const checkoutStep = job.steps.find((s) => s.uses?.startsWith('actions/checkout'))
        if (checkoutStep) {
          expect(checkoutStep.with?.['persist-credentials']).toBe(false)
        }
      }
    }
    const verifyStep = wf.jobs.verify.steps.find((s) => s.name?.includes('reachability'))
    expect(verifyStep.run).toContain('mobile-android-v[0-9]+\\.[0-9]+\\.[0-9]+-[0-9]+')
  })

  it('runs root reliability and code quality gates in verify job', () => {
    const wf = readWorkflow()
    const verifySteps = wf.jobs.verify.steps
    const qualityStep = verifySteps.find((s) => s.name?.includes('code quality'))
    expect(qualityStep.run).toContain('pnpm run audit:code-quality:native')
    expect(qualityStep.run).toContain('pnpm run audit:code-quality:type-aware')
    expect(qualityStep.run).toContain('pnpm run check:reliability-gates')
    expect(qualityStep.run).toContain('pnpm run check:max-lines-ratchet')
    expect(qualityStep.run).toContain('pnpm run check:runtime-electron-ratchet')
  })

  it('does not build or publish macOS desktop artifacts on the mobile tag', () => {
    const wf = readWorkflow()
    const rawYaml = readFileSync(workflowPath, 'utf8')
    expect(wf.jobs['build-mac-arm64']).toBeUndefined()
    expect(Object.keys(wf.jobs)).toEqual(['verify', 'build-android', 'publish-release'])
    expect(rawYaml).not.toContain('orca-macos-arm64.dmg')
    expect(rawYaml).not.toContain('mac-artifacts')
  })

  it('pins Android job to Ubuntu and JDK 17 with strict SDK inspection', () => {
    const wf = readWorkflow()
    const androidJob = wf.jobs['build-android']
    expect(androidJob['runs-on']).toBe('ubuntu-latest')
    const javaStep = androidJob.steps.find((s) => s.uses?.startsWith('actions/setup-java'))
    expect(String(javaStep.with['java-version'])).toBe('17')

    const inspectStep = androidJob.steps.find((s) => s.name?.includes('Inspect packaged APK'))
    expect(inspectStep.run).toContain('find mobile/android/app/build/outputs/apk/release')
    expect(inspectStep.run).toContain('inspect-android-apk.mjs')
    expect(inspectStep.run).not.toContain('ls | head')
  })

  it('copies downloaded Android artifacts without a hard-coded android-artifacts glob', () => {
    const wf = readWorkflow()
    const pkgStep = wf.jobs['publish-release'].steps.find((s) =>
      s.name?.includes('Prepare release package')
    )
    expect(pkgStep.run).toContain("find staged-artifacts -name 'orca-mobile.apk'")
    expect(pkgStep.run).not.toContain('cp staged-artifacts/android-artifacts/*')
  })

  it('cleans up incomplete draft on failure or cancellation', () => {
    const wf = readWorkflow()
    const releaseJob = wf.jobs['publish-release']
    const cleanupStep = releaseJob.steps.find((s) => s.name?.includes('Clean up incomplete draft'))
    expect(cleanupStep.if).toContain('cancelled()')
    expect(cleanupStep.if).toContain('failure()')
  })

  it('publishes verified releases as prereleases so the operator can switch to latest in GitHub UI', () => {
    const wf = readWorkflow()
    const releaseJob = wf.jobs['publish-release']
    const createStep = releaseJob.steps.find((s) => s.name?.includes('create draft'))
    expect(createStep.run).toContain('--draft')
    expect(createStep.run).toContain('--prerelease')
    const verifyStep = releaseJob.steps.find((s) => s.name?.includes('publish prerelease'))
    expect(verifyStep.run).toContain('sha256sum -c SHA256SUMS.txt')
    expect(verifyStep.run).toContain('--draft=false')
    expect(verifyStep.run).toContain('--prerelease')
    expect(verifyStep.run).toContain('--latest=false')
  })

  it('contains zero forbidden references (Apple secrets, ORCA_MAC_RELEASE, publish always, stablyai publisher, Docker, app launch, install)', () => {
    const rawYaml = readFileSync(workflowPath, 'utf8')
    const forbiddenTokens = [
      'MAC_CERTS',
      'MAC_CERTS_PASSWORD',
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID',
      'ORCA_MAC_RELEASE',
      '--publish always',
      'docker',
      '/Applications/Orca.app',
      'adb install',
      'open /',
      'hdiutil attach',
      'stablyai/orca'
    ]
    for (const token of forbiddenTokens) {
      expect(rawYaml).not.toContain(token)
    }
  })

  it('fences the upstream mobile-android-release workflow to stablyai/orca only', () => {
    const upstream = parse(
      readFileSync(join(projectDir, '.github/workflows/mobile-android-release.yml'), 'utf8')
    )
    expect(upstream.jobs['android-build'].if).toBe("github.repository == 'stablyai/orca'")
  })
})
