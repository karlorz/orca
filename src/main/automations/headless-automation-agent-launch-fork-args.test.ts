/**
 * Fork: per-automation model / reasoningEffort / agentProfile and `agentFlags` ride the headless
 * launch next to upstream's allowlisted `extraAgentArgs`. Asserts both what the launch hands the
 * runtime and the argv the host would spawn from it.
 */
import { describe, expect, it, vi } from 'vitest'
import { launchHeadlessAutomationAgent } from './headless-automation-agent-launch'
import {
  AGENT_FLAGS_REQUIRE_FRESH_SESSION,
  assertAutomationAgentFlags,
  buildAutomationModelLaunchPreferences
} from '../../shared/automation-model'
import { resolveAgentStartupPlanInputs } from '../../shared/agent-startup-plan-inputs'
import { buildAgentStartupPlan } from '../../shared/tui-agent-startup'
import type { TuiAgent } from '../../shared/tui-agent'

type LaunchAgentTerminalOpts = {
  agent: TuiAgent
  launchPreferences?: Record<string, unknown>
  extraAgentArgs?: string
}

function harness() {
  return {
    getClientSettings: () => ({ experimentalNativeChat: true }),
    getStructuredAgentSessionCreateSupport: vi.fn(async () => ({ supported: true })),
    createManagedWorktree: vi.fn(async (_args: Record<string, unknown>) => ({
      worktree: { id: 'repo-1::/wt/auto', displayName: 'auto-nightly' },
      startupTerminal: { handle: 'term_new', tabId: 'tab-new', paneKey: 'tab-new:leaf-1' }
    })),
    launchAgentTerminal: vi.fn(
      async (_selector: string, _opts: LaunchAgentTerminalOpts) => ({
        handle: 'term_existing',
        tabId: 'tab-1',
        paneKey: 'tab-1:leaf-1',
        ptyId: 'pty-1',
        worktreeId: 'wt-1'
      })
    ),
    showManagedWorktree: vi.fn(async () => ({ displayName: 'repo' })),
    deliverStartupFollowup: vi.fn(async () => true)
  }
}

const RUN = { id: 'run-1', title: 'Nightly', scheduledFor: Date.UTC(2026, 9, 10, 3) }
const TARGET = { ok: true, repo: { id: 'repo-1', path: '/repo', displayName: 'repo' } }

function launch(runtime: ReturnType<typeof harness>, overrides: Record<string, unknown>) {
  return launchHeadlessAutomationAgent(
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the launch reads only the faked members.
    runtime as never,
    {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only these automation fields are read.
      automation: {
        id: 'auto-1',
        agentId: 'grok',
        prompt: 'triage',
        workspaceMode: 'existing',
        workspaceId: 'wt-1',
        ...overrides
      } as never,
      run: RUN,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the repo is read.
      target: TARGET as never
    }
  )
}

/** The argv a host renders for this launch, as buildWorktreeStartupForAgent would. */
function spawnedCommand(args: LaunchAgentTerminalOpts): string | undefined {
  const inputs = resolveAgentStartupPlanInputs({
    agent: args.agent,
    settings: {},
    platform: 'linux',
    isRemote: false,
    ...(args.extraAgentArgs ? { extraAgentArgs: args.extraAgentArgs } : {}),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: launch preferences are the session option map.
    ...(args.launchPreferences ? { sessionOptions: args.launchPreferences as never } : {})
  })
  return buildAgentStartupPlan({ ...inputs, prompt: 'triage' })?.launchCommand
}

async function launchedOptions(overrides: Record<string, unknown>) {
  const runtime = harness()
  await launch(runtime, overrides)
  expect(runtime.launchAgentTerminal).toHaveBeenCalledOnce()
  const launched = runtime.launchAgentTerminal.mock.calls[0]
  if (launched === undefined) {
    throw new Error('expected launchAgentTerminal to be called')
  }
  return launched[1]
}

describe('headless automation launch: fork per-automation args', () => {
  it('passes per-automation model, reasoning effort and agent profile into the spawned args', async () => {
    const opts = await launchedOptions({
      model: 'deepseek-v4-flash',
      reasoningEffort: 'xhigh',
      agentProfile: 'minimal'
    })
    expect(opts.launchPreferences).toEqual(
      buildAutomationModelLaunchPreferences('grok', 'deepseek-v4-flash', 'xhigh', 'minimal')
    )
    expect(opts.extraAgentArgs).toBeUndefined()
    expect(spawnedCommand(opts)).toContain(
      "'--agent' 'minimal' '-m' 'deepseek-v4-flash' '--reasoning-effort' 'xhigh'"
    )
  })

  it('passes agentFlags into the spawned args', async () => {
    const opts = await launchedOptions({ agentId: 'claude', agentFlags: '--verbose' })
    expect(opts.launchPreferences).toEqual({ extraArgs: '--verbose' })
    expect(opts.extraAgentArgs).toBeUndefined()
    expect(spawnedCommand(opts)).toContain("'--verbose'")
  })

  it('passes upstream extraAgentArgs into the spawned args', async () => {
    const opts = await launchedOptions({ agentId: 'claude', extraAgentArgs: '--effort high' })
    expect(opts.launchPreferences).toBeUndefined()
    expect(opts.extraAgentArgs).toBe('--effort high')
    const command = spawnedCommand(opts)
    expect(command).toContain('--effort')
    expect(command).toContain('high')
  })

  it('carries model, agentFlags and extraAgentArgs together', async () => {
    const opts = await launchedOptions({
      agentId: 'claude',
      model: 'opus',
      agentFlags: '--verbose',
      extraAgentArgs: '--add-dir docs'
    })
    expect(opts.launchPreferences).toEqual(
      buildAutomationModelLaunchPreferences('claude', 'opus', undefined, undefined, '--verbose')
    )
    expect(opts.extraAgentArgs).toBe('--add-dir docs')
    const command = spawnedCommand(opts) ?? ''
    expect(command).toContain("'--model' 'opus'")
    expect(command).toContain("'--verbose'")
    expect(command).toContain('--add-dir')
    expect(command).toContain('docs')
  })

  it('carries the same fork preferences on a new-per-run workspace create', async () => {
    const runtime = harness()
    await launch(runtime, {
      agentId: 'claude',
      workspaceMode: 'new_per_run',
      workspaceId: null,
      model: 'opus',
      agentFlags: '--verbose',
      extraAgentArgs: '--effort high'
    })
    const create = runtime.createManagedWorktree.mock.calls[0]![0]
    expect(create.startupLaunchPreferences).toEqual(
      buildAutomationModelLaunchPreferences('claude', 'opus', undefined, undefined, '--verbose')
    )
    expect(create.startupExtraAgentArgs).toBe('--effort high')
  })

  it('reuse-session refuses agentFlags with a clear message', () => {
    expect(() =>
      assertAutomationAgentFlags({ reuseSession: true, agentFlags: '--verbose' })
    ).toThrow(AGENT_FLAGS_REQUIRE_FRESH_SESSION)
    expect(() => assertAutomationAgentFlags({ reuseSession: true, agentFlags: '  ' })).not.toThrow()
    expect(() =>
      assertAutomationAgentFlags({ reuseSession: false, agentFlags: '--verbose' })
    ).not.toThrow()
  })
})
