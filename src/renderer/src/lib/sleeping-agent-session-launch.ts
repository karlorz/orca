import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { buildAgentResumeStartupPlan } from '@/lib/tui-agent-startup'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { reconcileTabOrder } from '@/components/tab-bar/reconcile-order'
import {
  resolveAgentResumeLaunchTarget,
  type AgentResumeLaunchTarget
} from '@/lib/agent-resume-launch-target'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentSessionRecord
} from '../../../shared/agent-session-resume'
import type { AgentStartupPlan } from '../../../shared/tui-agent-startup'
import { translate } from '@/i18n/i18n'

export type ResumeSleepingAgentSessionsOptions = {
  suppressNavigation?: boolean
  /** Provider-session claim keys already woken in place by mounted panes
   *  (WAKE_HIBERNATED_AGENTS_WORKTREE_EVENT). Their sleeping records are
   *  cleared only after the in-place spawn succeeds, so the generic resume
   *  must neither launch nor clear them here. */
  skipClaimKeys?: ReadonlySet<string>
  /** Called with the tab id of each freshly launched resume tab, so
   *  navigation-suppressed callers can background-mount exactly those tabs. */
  onSessionLaunched?: (tabId: string) => void
}

function getResumeLaunchTarget(worktreeId: string): AgentResumeLaunchTarget {
  const state = useAppStore.getState()
  const worktree = state.getKnownWorktreeById(worktreeId)
  const repo = worktree ? state.repos.find((entry) => entry.id === worktree.repoId) : null
  // The resume tab is created without a shell override, so the global Windows shell wins.
  return resolveAgentResumeLaunchTarget({
    projectRuntime: getLocalProjectExecutionRuntimeContext(state, worktreeId),
    connectionId: repo?.connectionId,
    executionHostId: getExecutionHostIdForWorktree(state, worktreeId),
    worktreePath: worktree?.path,
    terminalWindowsShell: state.settings?.terminalWindowsShell
  })
}

function appendTabToWorktreeOrder(worktreeId: string, tabId: string): void {
  const state = useAppStore.getState()
  const termIds = (state.tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id)
  const editorIds = state.openFiles
    .filter((file) => file.worktreeId === worktreeId)
    .map((f) => f.id)
  const browserIds = (state.browserTabsByWorktree?.[worktreeId] ?? []).map((tab) => tab.id)
  const base = reconcileTabOrder(
    state.tabBarOrderByWorktree[worktreeId],
    termIds,
    editorIds,
    browserIds
  )
  const order = base.filter((id) => id !== tabId)
  order.push(tabId)
  state.setTabBarOrder(worktreeId, order)
}

function cannotResumeSession(): false {
  toast.error(
    translate(
      'auto.lib.resume.sleeping.agent.session.f235f604fd',
      'This agent session cannot be resumed.'
    )
  )
  return false
}

function openResumeTab(args: {
  worktreeId: string
  agent: SleepingAgentSessionRecord['agent']
  startupPlan: AgentStartupPlan
  providerSession?: AgentProviderSessionMetadata
  agentArgsOverride?: string
  options?: ResumeSleepingAgentSessionsOptions
}): boolean {
  const state = useAppStore.getState()
  const tab = state.createTab(args.worktreeId, undefined, undefined, {
    launchAgent: args.agent,
    pendingStartup: {
      command: args.startupPlan.launchCommand,
      ...(args.startupPlan.env ? { env: args.startupPlan.env } : {}),
      launchConfig: args.startupPlan.launchConfig,
      ...(args.providerSession ? { resumeProviderSession: args.providerSession } : {}),
      launchAgent: args.agent,
      ...(args.agentArgsOverride ? { agentArgsOverride: args.agentArgsOverride } : {}),
      ...(args.startupPlan.startupCommandDelivery
        ? { startupCommandDelivery: args.startupPlan.startupCommandDelivery }
        : {}),
      showSessionRestoredBanner: true,
      telemetry: {
        agent_kind: tuiAgentToAgentKind(args.agent),
        launch_source: 'sidebar',
        request_kind: 'resume'
      }
    },
    ...(args.providerSession
      ? {
          automaticResumeClaim: {
            worktreeId: args.worktreeId,
            launchAgent: args.agent,
            providerSession: args.providerSession
          }
        }
      : {}),
    ...(args.options?.suppressNavigation ? { activate: false, recordInteraction: false } : {})
  })
  if (!args.options?.suppressNavigation) {
    state.setActiveTabType('terminal', args.worktreeId)
  }
  appendTabToWorktreeOrder(args.worktreeId, tab.id)
  args.options?.onSessionLaunched?.(tab.id)
  return true
}

// Why: mobile-driven wake runs on the desktop host renderer, so it must create
// the resume tab without stealing the desktop's active worktree/tab/view.
export function launchSleepingAgentSession(
  record: SleepingAgentSessionRecord,
  options?: ResumeSleepingAgentSessionsOptions
): boolean {
  const state = useAppStore.getState()
  const launchConfig = record.launchConfig
  const resumeTarget = getResumeLaunchTarget(record.worktreeId)
  const startupPlan = buildAgentResumeStartupPlan({
    agent: record.agent,
    providerSession: record.providerSession,
    cmdOverrides: state.settings?.agentCmdOverrides ?? {},
    agentArgs:
      launchConfig !== undefined
        ? launchConfig.agentArgs
        : resolveTuiAgentLaunchArgs(record.agent, state.settings?.agentDefaultArgs),
    agentEnv:
      launchConfig !== undefined
        ? launchConfig.agentEnv
        : resolveTuiAgentLaunchEnv(record.agent, state.settings?.agentDefaultEnv),
    ...(launchConfig?.agentCommand ? { agentCommand: launchConfig.agentCommand } : {}),
    ...(launchConfig?.ompResumeFilePath
      ? { ompResumeFilePath: launchConfig.ompResumeFilePath }
      : {}),
    platform: resumeTarget.platform,
    shell: resumeTarget.shell
  })
  if (!startupPlan) {
    return cannotResumeSession()
  }

  const opened = openResumeTab({
    worktreeId: record.worktreeId,
    agent: record.agent,
    startupPlan,
    providerSession: record.providerSession,
    ...(launchConfig ? { agentArgsOverride: launchConfig.agentArgs } : {}),
    options
  })
  if (opened) {
    state.clearSleepingAgentSession(record.paneKey)
    if (!options?.suppressNavigation) {
      state.setActiveTabType('terminal', record.worktreeId)
    }
  }
  return opened
}
