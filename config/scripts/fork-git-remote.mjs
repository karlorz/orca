import { spawnSync } from 'node:child_process'

export const FORK_WORKING_BRANCH = 'fork-main'
export const FORK_MIRROR_BRANCH = 'main'
export const UPSTREAM_REPO = 'stablyai/orca'
export const UPSTREAM_GIT_URL = 'https://github.com/stablyai/orca.git'
export const UPSTREAM_BRANCH = 'main'

export function assertSafePushRemoteUrl(remoteUrl) {
  const url = String(remoteUrl ?? '')
  if (!url) {
    throw new Error('Push remote URL is required')
  }
  if (url.includes('stablyai/orca')) {
    throw new Error('Refusing to push to stablyai/orca')
  }
  if (!url.includes('karlorz/orca')) {
    throw new Error(`Push remote must be karlorz/orca, got: ${url}`)
  }
}

export function resolvePushRemote(remotes) {
  const rows = Array.isArray(remotes) ? remotes : []
  const named = (name) => rows.find((row) => row?.name === name)
  const fork = named('fork')
  if (fork) {
    assertSafePushRemoteUrl(fork.url)
    return fork.name
  }
  const origin = named('origin')
  if (origin) {
    assertSafePushRemoteUrl(origin.url)
    return origin.name
  }
  throw new Error('No karlorz/orca push remote (fork or origin)')
}

export function listGitRemotes(cwd) {
  const result = spawnSync('git', ['remote', '-v'], {
    encoding: 'utf8',
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`git remote -v failed${detail ? `: ${detail}` : ''}`)
  }
  const remotes = []
  for (const line of (result.stdout ?? '').trim().split('\n')) {
    const match = /^(?<name>\S+)\s+(?<url>\S+)\s+\(push\)$/.exec(line)
    if (match?.groups) {
      remotes.push({ name: match.groups.name, url: match.groups.url })
    }
  }
  return remotes
}
