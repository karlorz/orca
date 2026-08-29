import { appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  assertSafePushRemoteUrl,
  listGitRemotes,
  resolvePushRemote,
  UPSTREAM_GIT_URL
} from './fork-git-remote.mjs'

const UPSTREAM_V_TAG = /^refs\/tags\/(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/

export function parseTagRefMap(tagRefs) {
  const map = new Map()
  const list = Array.isArray(tagRefs) ? tagRefs : []
  for (const item of list) {
    if (typeof item === 'string') {
      const match = /^([0-9a-fA-F]+)\s+(refs\/tags\/\S+)$/.exec(item.trim())
      if (match) {
        map.set(match[2], match[1])
      }
    } else if (item && typeof item === 'object' && item.name && item.sha) {
      const ref = item.name.startsWith('refs/tags/') ? item.name : `refs/tags/${item.name}`
      map.set(ref, item.sha)
    }
  }
  return map
}

export function buildTagMirrorPlan(upstreamTagRefs, forkTagRefs) {
  const upstreamMap = parseTagRefMap(upstreamTagRefs)
  const forkMap = parseTagRefMap(forkTagRefs)

  const toMirror = []
  const diverged = []
  const identical = []

  for (const [ref, upstreamSha] of upstreamMap.entries()) {
    if (ref.endsWith('^{}')) {
      continue
    }
    const match = UPSTREAM_V_TAG.exec(ref)
    if (!match) {
      continue
    }
    const tagName = match[1]
    const forkSha = forkMap.get(ref)

    if (!forkSha) {
      toMirror.push({ name: tagName, ref, sha: upstreamSha })
    } else if (forkSha.toLowerCase() !== upstreamSha.toLowerCase()) {
      diverged.push({ name: tagName, ref, upstreamSha, forkSha })
    } else {
      identical.push({ name: tagName, ref, sha: upstreamSha })
    }
  }

  return {
    toMirror,
    diverged,
    identical
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

export function fetchRemoteTagRefs(remoteTarget, { cwd } = {}) {
  const stdout = git(['ls-remote', '--tags', remoteTarget], { cwd })
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function syncUpstreamTags({ cwd, write = false } = {}) {
  const remotes = listGitRemotes(cwd)
  const pushRemote = resolvePushRemote(remotes)
  const pushRemoteUrl = remotes.find((r) => r.name === pushRemote)?.url
  assertSafePushRemoteUrl(pushRemoteUrl)

  const upstreamRefs = fetchRemoteTagRefs(UPSTREAM_GIT_URL, { cwd })
  const forkRefs = fetchRemoteTagRefs(pushRemote, { cwd })

  const plan = buildTagMirrorPlan(upstreamRefs, forkRefs)

  if (plan.diverged.length > 0) {
    const warningLines = plan.diverged.map(
      (d) =>
        `Warning: Tag ${d.name} diverged (upstream: ${d.upstreamSha}, fork: ${d.forkSha}). Skipping.`
    )
    for (const line of warningLines) {
      console.warn(line)
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### Tag Mirror Divergence Warnings\n\n${warningLines.map((l) => `- ${l}`).join('\n')}\n`
      )
    }
  }

  if (!write || plan.toMirror.length === 0) {
    return { ...plan, pushRemote, wrote: false }
  }

  for (const item of plan.toMirror) {
    git(['fetch', UPSTREAM_GIT_URL, `${item.ref}:${item.ref}`], { cwd })
    git(['push', pushRemote, `${item.ref}:${item.ref}`], { cwd })
  }

  return { ...plan, pushRemote, wrote: true }
}

function main() {
  const write = process.argv.includes('--write')
  const result = syncUpstreamTags({ write })
  console.log(
    `${result.wrote ? 'Mirrored' : 'Would mirror'} ${result.toMirror.length} tags to ${result.pushRemote}`
  )
  for (const item of result.toMirror) {
    console.log(`+ ${item.name} (${item.sha.slice(0, 7)})`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
