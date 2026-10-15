import { runProcess } from '@orca/process-host'
import type { WorktreeGcPrLookup } from './worktree-gc-model'

function pullRequestState(entry: unknown): string {
  if (typeof entry !== 'object' || entry === null || !('state' in entry)) {
    return ''
  }
  return typeof entry.state === 'string' ? entry.state : ''
}

export const lookupGithubPrStates: WorktreeGcPrLookup = async (cwd, branch) => {
  try {
    const result = await runProcess({
      program: 'gh',
      args: ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'state', '-L', '5'],
      cwd,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      timeoutMs: 30_000
    })
    if (result.code !== 0 || result.stdout.trim().length === 0) {
      return { ok: false, states: [] }
    }
    const parsed: unknown = JSON.parse(result.stdout)
    if (!Array.isArray(parsed)) {
      return { ok: false, states: [] }
    }
    const states = parsed.map(pullRequestState).filter((state) => state.length > 0)
    return { ok: true, states }
  } catch {
    return { ok: false, states: [] }
  }
}
