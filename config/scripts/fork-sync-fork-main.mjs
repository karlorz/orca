import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolvePnpmCliInvocation } from './pnpm-cli-invocation.mjs'
import { loadUpstreamReleases, selectLatestTrains } from './fork-upstream-trains.mjs'
import { parseUpstreamMobileBase, resolveForkMobileAppJson } from './fork-next-mobile-tag.mjs'
import {
  FORK_WORKING_BRANCH,
  FORK_MIRROR_BRANCH,
  UPSTREAM_REPO,
  UPSTREAM_GIT_URL,
  UPSTREAM_BRANCH,
  assertSafePushRemoteUrl,
  resolvePushRemote,
  listGitRemotes
} from './fork-git-remote.mjs'

export {
  FORK_WORKING_BRANCH,
  FORK_MIRROR_BRANCH,
  UPSTREAM_REPO,
  UPSTREAM_GIT_URL,
  UPSTREAM_BRANCH,
  assertSafePushRemoteUrl,
  resolvePushRemote,
  listGitRemotes
}

export function buildForkMainSyncPlan() {
  return {
    mirrorBranch: FORK_MIRROR_BRANCH,
    workingBranch: FORK_WORKING_BRANCH,
    upstreamRepo: UPSTREAM_REPO,
    upstreamUrl: UPSTREAM_GIT_URL,
    upstreamBranch: UPSTREAM_BRANCH,
    fetchArgs: ['fetch', UPSTREAM_GIT_URL, UPSTREAM_BRANCH],
    mergeArgs: [
      'merge',
      '--no-ff',
      'FETCH_HEAD',
      '-m',
      'merge: sync fork-main from stablyai/orca main'
    ],
    neverMergeUpstreamApiOnWorkingBranch: true
  }
}

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    cwd: options.cwd,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe']
  })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
  return (result.stdout ?? '').trim()
}

export function appendGitHubOutput(outputPath, values) {
  if (!outputPath) {
    return
  }
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  appendFileSync(outputPath, `${body}\n`)
}

export const AUTO_RESOLVABLE_SYNC_PATHS = Object.freeze([
  'mobile/app.json',
  '.gitignore',
  'config/scripts/build-native-for-platform.mjs',
  'mobile/src/terminal/terminal-webview-payload-hash.test.ts'
])

export function isAutoResolvableSyncConflict(unmergedPaths) {
  return (
    Array.isArray(unmergedPaths) &&
    unmergedPaths.length > 0 &&
    unmergedPaths.every((path) => AUTO_RESOLVABLE_SYNC_PATHS.includes(path))
  )
}

export function unionIgnoreFile(ours, theirs) {
  const split = (text) =>
    String(text ?? '')
      .replace(/\n$/, '')
      .split('\n')
  const oursLines = split(ours)
  const seen = new Set(oursLines)
  const extra = split(theirs).filter((line) => !seen.has(line))
  return `${[...oursLines, ...extra].join('\n')}\n`
}

const SPEECH_AFTER_PARALLEL = `if (!externalSignal && !firstFailure && !outputFailed && exitCodes.every((code) => code === 0)) {
  runPnpmScriptSync('build:speech-macos')
}

`

function extractRunPnpmScriptSync(source) {
  const start = source.indexOf('function runPnpmScriptSync(scriptName)')
  if (start === -1) {
    return null
  }
  const end = source.indexOf('\nfunction ', start + 1)
  return end === -1 ? source.slice(start) : source.slice(start, end)
}

export function mergeBuildNativeForPlatform(ours, theirs) {
  const parallelBlockStart = theirs.indexOf('Promise.all')
  const parallelBlockEnd = theirs.indexOf('clearTimeout')
  if (parallelBlockStart !== -1 && parallelBlockEnd > parallelBlockStart) {
    const parallelBlock = theirs.slice(parallelBlockStart, parallelBlockEnd)
    if (parallelBlock.includes('speech')) {
      throw new Error('fork-sync: refuse speech inside the parallel native helper list')
    }
  }
  if (theirs.includes("runPnpmScriptSync('build:speech-macos')")) {
    return theirs
  }
  if (!ours.includes("runPnpmScriptSync('build:speech-macos')")) {
    throw new Error('fork-sync: ours lost sequential build:speech-macos')
  }
  if (!theirs.includes("'build:computer-macos'") || !theirs.includes('await Promise.all')) {
    throw new Error('fork-sync: upstream native launcher is not the Promise.all helper shape')
  }
  const marker = 'function handlerFor(signal)'
  const idx = theirs.indexOf(marker)
  if (idx === -1) {
    throw new Error('fork-sync: cannot find handlerFor insertion point in native launcher')
  }
  let body = theirs.slice(0, idx) + SPEECH_AFTER_PARALLEL + theirs.slice(idx)
  if (!body.includes('function runPnpmScriptSync')) {
    const fn = extractRunPnpmScriptSync(ours)
    if (!fn) {
      throw new Error('fork-sync: ours has no runPnpmScriptSync helper')
    }
    const insertAt = body.indexOf('function runNodeScript')
    if (insertAt === -1) {
      throw new Error('fork-sync: cannot attach runPnpmScriptSync')
    }
    body = `${body.slice(0, insertAt)}${fn}\n${body.slice(insertAt)}`
  }
  return body
}

export function rewriteTerminalWebviewPayloadHashTest(source, { sha256, length }) {
  if (!/const EXPECTED_SHA256 = '[0-9a-f]{64}'/.test(source)) {
    throw new Error('fork-sync: payload hash test missing EXPECTED_SHA256')
  }
  if (!/const EXPECTED_LENGTH = \d+/.test(source)) {
    throw new Error('fork-sync: payload hash test missing EXPECTED_LENGTH')
  }
  return source
    .replace(/const EXPECTED_SHA256 = '[0-9a-f]{64}'/, `const EXPECTED_SHA256 = '${sha256}'`)
    .replace(/const EXPECTED_LENGTH = \d+/, `const EXPECTED_LENGTH = ${length}`)
}

export function computeWebviewPayloadFingerprint({ cwd }) {
  const out = join(tmpdir(), `orca-webview-fp-${process.pid}.json`)
  const { command, prefixArgs, shell } = resolvePnpmCliInvocation()
  const result = spawnSync(
    command,
    [
      ...prefixArgs,
      'exec',
      'vitest',
      'run',
      '--config',
      'config/vitest.config.ts',
      'config/scripts/write-webview-payload-fingerprint.test.ts'
    ],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, WEBVIEW_FINGERPRINT_OUT: out },
      shell,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  if (result.status !== 0) {
    throw new Error(
      `fork-sync: cannot hash WebView payload: ${(result.stderr || result.stdout || '').trim()}`
    )
  }
  if (!existsSync(out)) {
    throw new Error('fork-sync: WebView fingerprint writer skipped or wrote nothing')
  }
  return JSON.parse(readFileSync(out, 'utf8'))
}

function showStage(stage, path, { cwd }) {
  return git(['show', `${stage}:${path}`], { cwd })
}

function resolveAllowlistedSyncConflicts({ cwd }) {
  const unmerged = git(['diff', '--name-only', '--diff-filter=U'], { cwd })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!isAutoResolvableSyncConflict(unmerged)) {
    throw new Error(`Unresolvable fork-sync conflicts: ${unmerged.join(', ') || '(none)'}`)
  }
  const root = cwd ?? process.cwd()
  for (const path of unmerged) {
    if (path === 'mobile/app.json') {
      const trains = selectLatestTrains(loadUpstreamReleases())
      if (!trains.mobile?.tag) {
        throw new Error('No upstream mobile train to resolve mobile/app.json')
      }
      const trainBase = parseUpstreamMobileBase(trains.mobile.tag)
      const ours = JSON.parse(showStage(':2', path, { cwd }))
      const theirs = JSON.parse(showStage(':3', path, { cwd }))
      const resolved = resolveForkMobileAppJson({ ours, theirs, trainBase })
      writeFileSync(join(root, path), `${JSON.stringify(resolved, null, 2)}\n`)
    } else if (path === '.gitignore') {
      writeFileSync(
        join(root, path),
        unionIgnoreFile(showStage(':2', path, { cwd }), showStage(':3', path, { cwd }))
      )
    } else if (path === 'config/scripts/build-native-for-platform.mjs') {
      writeFileSync(
        join(root, path),
        mergeBuildNativeForPlatform(showStage(':2', path, { cwd }), showStage(':3', path, { cwd }))
      )
    } else if (path === 'mobile/src/terminal/terminal-webview-payload-hash.test.ts') {
      const fingerprint = computeWebviewPayloadFingerprint({ cwd: root })
      writeFileSync(
        join(root, path),
        rewriteTerminalWebviewPayloadHashTest(showStage(':2', path, { cwd }), fingerprint)
      )
    }
    git(['add', path], { cwd })
  }
  git(['commit', '--no-edit'], { cwd })
}

export function syncForkMainFromUpstream({ cwd, write = false } = {}) {
  const plan = buildForkMainSyncPlan()
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
  if (branch !== plan.workingBranch) {
    throw new Error(`Must run on ${plan.workingBranch}, currently ${branch}`)
  }
  const pushRemote = resolvePushRemote(listGitRemotes(cwd))
  if (!write) {
    return { ...plan, pushRemote, wrote: false }
  }

  git(plan.fetchArgs, { cwd })
  const before = git(['rev-parse', 'HEAD'], { cwd })
  try {
    git(plan.mergeArgs, { cwd })
  } catch (error) {
    let unmerged = []
    try {
      unmerged = git(['diff', '--name-only', '--diff-filter=U'], { cwd })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    } catch {
      throw error
    }
    if (!isAutoResolvableSyncConflict(unmerged)) {
      throw error
    }
    resolveAllowlistedSyncConflicts({ cwd })
  }
  const after = git(['rev-parse', 'HEAD'], { cwd })
  if (before !== after) {
    git(['push', pushRemote, `HEAD:${plan.workingBranch}`], { cwd })
  }
  const pushed = before !== after
  appendGitHubOutput(process.env.GITHUB_OUTPUT, { before, after, pushed: String(pushed) })
  return { ...plan, pushRemote, wrote: true, before, after, pushed }
}

const invokedDirectly =
  Boolean(process.argv[1]) && process.argv[1].endsWith('fork-sync-fork-main.mjs')

if (invokedDirectly) {
  const write = process.argv.includes('--write')
  const result = syncForkMainFromUpstream({ write })
  console.log(
    write
      ? `fork-main sync ${result.pushed ? 'pushed' : 'already up to date'} via ${result.pushRemote}`
      : `dry-run: would fetch ${result.upstreamUrl} ${result.upstreamBranch} and merge into ${result.workingBranch}`
  )
}
