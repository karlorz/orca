import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { buildAgentResumeStartupPlan } from '@/lib/tui-agent-startup'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { persistAgentLaunchTabOrder } from '@/lib/launch-agent-tab-order'
import {
  resolveSshHostReportedPlatform,
  resolveAgentResumeLaunchTarget,
  type AgentResumeLaunchTarget
} from '@/lib/agent-resume-launch-target'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { runtimeEnvironmentIdUnlessTwin } from '@/lib/resolve-owner'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import { resolveResumeLaunchRecipe } from '../../../shared/tui-agent-launch-defaults'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentSessionRecord
} from '../../../shared/agent-session-resume'
import type { AgentStartupPlan } from '../../../shared/tui-agent-startup'
import { translate } from '@/i18n/i18n'

export type ResumeSleepingAgentSessionsOptions = {
  suppressNavigation?: boolean
  // Mounted in-place wakes own these claim keys until spawn succeeds; generic resume must neither launch nor clear their records.
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
  const executionHostId = getExecutionHostIdForWorktree(state, worktreeId)
  return resolveAgentResumeLaunchTarget({
    projectRuntime: getLocalProjectExecutionRuntimeContext(state, worktreeId),
    connectionId: repo?.connectionId,
    executionHostId,
    worktreePath: worktree?.path,
    terminalWindowsShell: state.settings?.terminalWindowsShell,
    remotePlatform: resolveSshHostReportedPlatform(
      state,
      executionHostId,
      runtimeEnvironmentIdUnlessTwin(state, worktreeId)
    )
  })
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
  // Saved-record resumes carry the saved-origin admission so an open chat
  // continuing the conversation refuses the automatic restore (#30930).
  savedRecord?: SleepingAgentSessionRecord
  options?: ResumeSleepingAgentSessionsOptions
}): boolean {
  const state = useAppStore.getState()
  const saved = args.savedRecord
  const savedStatus = saved ? state.agentStatusByPaneKey[saved.paneKey] : undefined
  const tab = state.createTab(args.worktreeId, undefined, undefined, {
    launchAgent: args.agent,
    pendingStartup: {
      command: args.startupPlan.launchCommand,
      ...(args.startupPlan.env ? { env: args.startupPlan.env } : {}),
      launchConfig: args.startupPlan.launchConfig,
      ...(args.providerSession ? { resumeProviderSession: args.providerSession } : {}),
      ...(saved
        ? {
            resumeOrigin: 'saved' as const,
            resumeSource: {
              cancelled: false,
              record: saved,
              ...(savedStatus
                ? {
                    expectedStatus: {
                      paneKey: saved.paneKey,
                      receivedAt: savedStatus.updatedAt,
                      stateStartedAt: savedStatus.stateStartedAt
                    }
                  }
                : {})
            }
          }
        : {}),
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
  persistAgentLaunchTabOrder(args.worktreeId, tab.id)
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
    ...resolveResumeLaunchRecipe(launchConfig),
    platform: resumeTarget.platform,
    shell: resumeTarget.shell,
    launchCwd: state.getKnownWorktreeById(record.worktreeId)?.path
  })
  if (!startupPlan) {
    return cannotResumeSession()
  }

  const opened = openResumeTab({
    worktreeId: record.worktreeId,
    agent: record.agent,
    startupPlan,
    providerSession: record.providerSession,
    savedRecord: record,
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
