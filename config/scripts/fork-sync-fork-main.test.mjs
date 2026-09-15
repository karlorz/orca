import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AUTO_RESOLVABLE_SYNC_PATHS,
  appendGitHubOutput,
  assertSafePushRemoteUrl,
  buildForkMainSyncPlan,
  computeWebviewPayloadFingerprint,
  isAutoResolvableSyncConflict,
  mergeBuildNativeForPlatform,
  resolveAllowlistedSyncConflicts,
  resolvePushRemote,
  rewriteTerminalWebviewPayloadHashTest,
  unionIgnoreFile
} from './fork-sync-fork-main.mjs'
import { resolveForkMobileAppJson } from './fork-next-mobile-tag.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const hasMobileExpoTsconfig = existsSync(
  join(projectDir, 'mobile/node_modules/expo/tsconfig.base.json')
)
const tempRepos = []

const IGNORE_PATH = '.gitignore'
const NATIVE_PATH = 'config/scripts/build-native-for-platform.mjs'
const HASH_PATH = 'mobile/src/terminal/terminal-webview-payload-hash.test.ts'

const NATIVE_THEIRS = `const exitCodes = await Promise.all(
  ['build:computer-macos', 'build:keyboard-layout-macos', 'build:notification-status-macos'].map(
    (scriptName) => runPnpmScript(scriptName)
  )
)
clearTimeout(forceTimer)

function handlerFor(signal) {}
function runNodeScript(scriptPath) {}
`

const NATIVE_OURS = `function runPnpmScriptSync(scriptName) {
  return scriptName
}

if (!externalSignal) {
  runPnpmScriptSync('build:speech-macos')
}
`

const HASH_OURS = `const EXPECTED_SHA256 = '${'a'.repeat(64)}'
const EXPECTED_LENGTH = 12
`

const HASH_THEIRS = `const EXPECTED_SHA256 = '${'c'.repeat(64)}'
const EXPECTED_LENGTH = 34
`

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function writeFiles(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(root, relativePath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }
}

function commitTree(root, files, message) {
  writeFiles(root, files)
  git(root, ['add', '-A'])
  git(root, ['commit', '--quiet', '-m', message])
}

function initConflictRepo({ extraTheirs = {}, extraOurs = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orca-fork-sync-srt-'))
  tempRepos.push(root)
  git(root, ['init', '--quiet', '-b', 'fork-main'])
  git(root, ['config', 'user.email', 'fork-sync-srt@example.com'])
  git(root, ['config', 'user.name', 'Fork Sync SRT'])
  commitTree(
    root,
    {
      README: 'base\n',
      [IGNORE_PATH]: 'node_modules/\n',
      [NATIVE_PATH]: 'function handlerFor(signal) {}\nfunction runNodeScript(scriptPath) {}\n',
      [HASH_PATH]: `const EXPECTED_SHA256 = '${'0'.repeat(64)}'\nconst EXPECTED_LENGTH = 1\n`
    },
    'base'
  )
  git(root, ['checkout', '--quiet', '-b', 'upstream-main'])
  commitTree(
    root,
    {
      [IGNORE_PATH]: 'node_modules/\nwindows-registry/\n',
      [NATIVE_PATH]: NATIVE_THEIRS,
      [HASH_PATH]: HASH_THEIRS,
      ...extraTheirs
    },
    'theirs'
  )
  git(root, ['checkout', '--quiet', 'fork-main'])
  commitTree(
    root,
    {
      [IGNORE_PATH]: 'node_modules/\n.fork-local\n',
      [NATIVE_PATH]: NATIVE_OURS,
      [HASH_PATH]: HASH_OURS,
      ...extraOurs
    },
    'ours'
  )
  try {
    execFileSync('git', ['merge', '--no-ff', 'upstream-main', '-m', 'merge: srt replay'], {
      cwd: root,
      encoding: 'utf8'
    })
  } catch {
    // Conflicts are the fixture.
  }
  return root
}

afterEach(() => {
  while (tempRepos.length > 0) {
    rmSync(tempRepos.pop(), { recursive: true, force: true })
  }
})

describe('fork-sync-fork-main helper', () => {
  it('merges stablyai/orca main into fork-main and never uses merge-upstream on fork-main', () => {
    const plan = buildForkMainSyncPlan()
    expect(plan.workingBranch).toBe('fork-main')
    expect(plan.mirrorBranch).toBe('main')
    expect(plan.upstreamUrl).toBe('https://github.com/stablyai/orca.git')
    expect(plan.fetchArgs).toEqual(['fetch', plan.upstreamUrl, 'main'])
    expect(plan.mergeArgs.slice(0, 3)).toEqual(['merge', '--no-ff', 'FETCH_HEAD'])
    expect(plan.neverMergeUpstreamApiOnWorkingBranch).toBe(true)
  })

  it('refuses stablyai/orca push remotes and prefers fork over origin', () => {
    expect(() => assertSafePushRemoteUrl('https://github.com/stablyai/orca.git')).toThrow(
      /stablyai\/orca/
    )
    expect(
      resolvePushRemote([
        { name: 'fork', url: 'https://github.com/karlorz/orca.git' },
        { name: 'origin', url: 'https://github.com/karlorz/orca.git' }
      ])
    ).toBe('fork')
  })

  it('auto-resolves any non-empty subset of the allowlisted fork-delta paths', () => {
    expect(isAutoResolvableSyncConflict(['mobile/app.json'])).toBe(true)
    expect(
      isAutoResolvableSyncConflict([
        '.gitignore',
        'config/scripts/build-native-for-platform.mjs',
        'mobile/src/terminal/terminal-webview-payload-hash.test.ts'
      ])
    ).toBe(true)
    expect(isAutoResolvableSyncConflict(AUTO_RESOLVABLE_SYNC_PATHS)).toBe(true)
    expect(isAutoResolvableSyncConflict(['mobile/app.json', 'package.json'])).toBe(false)
    expect(isAutoResolvableSyncConflict([])).toBe(false)
  })

  it('unions .gitignore by keeping ours order and appending missing theirs lines', () => {
    const ours = 'node_modules/\n.fork-local\n'
    const theirs = 'node_modules/\nwindows-registry/\n'
    expect(unionIgnoreFile(ours, theirs)).toBe('node_modules/\n.fork-local\nwindows-registry/\n')
  })

  it('takes upstream Promise.all helpers and appends sequential speech', () => {
    const theirs = `const exitCodes = await Promise.all(
  ['build:computer-macos', 'build:keyboard-layout-macos', 'build:notification-status-macos'].map(
    (scriptName) => runPnpmScript(scriptName)
  )
)
clearTimeout(forceTimer)

function handlerFor(signal) {}
function runNodeScript(scriptPath) {}
`
    const ours = `function runPnpmScriptSync(scriptName) {
  return scriptName
}

if (!externalSignal) {
  runPnpmScriptSync('build:speech-macos')
}
`
    const merged = mergeBuildNativeForPlatform(ours, theirs)
    expect(merged).toContain(
      "['build:computer-macos', 'build:keyboard-layout-macos', 'build:notification-status-macos']"
    )
    expect(merged).toContain("runPnpmScriptSync('build:speech-macos')")
    expect(merged.indexOf("runPnpmScriptSync('build:speech-macos')")).toBeLessThan(
      merged.indexOf('function handlerFor')
    )
    expect(merged).toContain('function runPnpmScriptSync(scriptName)')
    expect(merged.indexOf('function runPnpmScriptSync')).toBeLessThan(
      merged.indexOf('function runNodeScript')
    )
  })

  it('refuses speech inside the parallel native helper list', () => {
    const theirs = `const exitCodes = await Promise.all(
  ['build:computer-macos', 'build:speech-macos'].map((scriptName) => runPnpmScript(scriptName))
)
clearTimeout(forceTimer)
function handlerFor(signal) {}
`
    expect(() =>
      mergeBuildNativeForPlatform("runPnpmScriptSync('build:speech-macos')", theirs)
    ).toThrow(/refuse speech inside the parallel/)
  })

  it('rewrites only the WebView payload hash constants', () => {
    const source = `const EXPECTED_SHA256 = '${'a'.repeat(64)}'
const EXPECTED_LENGTH = 12
`
    const rewritten = rewriteTerminalWebviewPayloadHashTest(source, {
      sha256: 'b'.repeat(64),
      length: 99
    })
    expect(rewritten).toContain(`const EXPECTED_SHA256 = '${'b'.repeat(64)}'`)
    expect(rewritten).toContain('const EXPECTED_LENGTH = 99')
  })

  it.skipIf(!hasMobileExpoTsconfig)(
    'computes the live WebView payload fingerprint through Vitest',
    () => {
      const fingerprint = computeWebviewPayloadFingerprint({ cwd: projectDir })
      expect(fingerprint.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(fingerprint.length).toBeGreaterThan(1000)
    }
  )

  it('keeps fork versionCode and published-train marketing version across app.json sync', () => {
    const ours = {
      expo: {
        version: '0.0.46',
        android: {
          versionCode: 30,
          permissions: ['RECORD_AUDIO', 'android.permission.POST_NOTIFICATIONS']
        }
      }
    }
    const theirs = {
      expo: {
        version: '0.0.47',
        android: { versionCode: 15, permissions: ['RECORD_AUDIO'] }
      }
    }
    const resolved = resolveForkMobileAppJson({ ours, theirs, trainBase: '0.0.46' })
    expect(resolved.expo.version).toBe('0.0.46')
    expect(resolved.expo.android.versionCode).toBe(30)
    expect(resolved.expo.android.permissions).toEqual([
      'RECORD_AUDIO',
      'android.permission.POST_NOTIFICATIONS'
    ])
  })

  it('appends merge SHAs to GITHUB_OUTPUT for later follow-up detection', () => {
    const outputPath = join(mkdtempSync(join(tmpdir(), 'gha-out-')), 'github_output')
    appendGitHubOutput(outputPath, {
      before: 'aaa',
      after: 'bbb',
      pushed: 'true'
    })
    expect(readFileSync(outputPath, 'utf8')).toBe('before=aaa\nafter=bbb\npushed=true\n')
  })

  it('uses the published train base even when ours still lags', () => {
    const ours = { expo: { version: '0.0.44', android: { versionCode: 29, permissions: [] } } }
    const theirs = { expo: { version: '0.0.47', android: { versionCode: 15, permissions: [] } } }
    const resolved = resolveForkMobileAppJson({ ours, theirs, trainBase: '0.0.46' })
    expect(resolved.expo.version).toBe('0.0.46')
    expect(resolved.expo.android.versionCode).toBe(29)
  })

  it.skipIf(!hasMobileExpoTsconfig)(
    'auto-resolves the 2026-09-13 three-file git merge conflict set',
    () => {
      const root = initConflictRepo()
      const unmerged = git(root, ['diff', '--name-only', '--diff-filter=U'])
        .split('\n')
        .filter(Boolean)
      expect(unmerged.sort()).toEqual([IGNORE_PATH, NATIVE_PATH, HASH_PATH].sort())

      resolveAllowlistedSyncConflicts({ cwd: root, fingerprintCwd: projectDir })

      expect(git(root, ['diff', '--name-only', '--diff-filter=U'])).toBe('')
      expect(readFileSync(join(root, IGNORE_PATH), 'utf8')).toBe(
        'node_modules/\n.fork-local\nwindows-registry/\n'
      )
      const native = readFileSync(join(root, NATIVE_PATH), 'utf8')
      expect(native).toContain(
        "['build:computer-macos', 'build:keyboard-layout-macos', 'build:notification-status-macos']"
      )
      expect(native).toContain("runPnpmScriptSync('build:speech-macos')")
      const fingerprint = computeWebviewPayloadFingerprint({ cwd: projectDir })
      const hashTest = readFileSync(join(root, HASH_PATH), 'utf8')
      expect(hashTest).toContain(`const EXPECTED_SHA256 = '${fingerprint.sha256}'`)
      expect(hashTest).toContain(`const EXPECTED_LENGTH = ${fingerprint.length}`)
      expect(git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('fork-main')
    }
  )

  it('still fail-closes when a fourth path is also unmerged', () => {
    const root = initConflictRepo({
      extraTheirs: { 'package.json': '{"name":"theirs"}\n' },
      extraOurs: { 'package.json': '{"name":"ours"}\n' }
    })
    expect(() =>
      resolveAllowlistedSyncConflicts({ cwd: root, fingerprintCwd: projectDir })
    ).toThrow(/Unresolvable fork-sync conflicts:.*package\.json/)
  })
})
