import {
  getAgentResumeArgv,
  isResumableTuiAgent,
  providerSessionMetadataForAgentResume,
  type SleepingAgentSessionRecord
} from '../../../../shared/agent-session-resume'
import type { AutomationRun } from '../../../../shared/automations-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import { activateTerminalTabOnOwner } from '@/lib/terminal-tab-owner-activation'
import { activateWebRuntimeSessionTab } from '@/runtime/web-runtime-session'
import { resolveWebSessionVisibleTabId } from '@/runtime/web-session-focus-intent'
import {
  buildAutomationRunOpenLayout,
  getAutomationRunOpenTabId,
  getAutomationRunOwnerEnvironmentId,
  isAutomationRunPaneMounted,
  resolveAutomationRunOpenTarget,
  resolveAutomationRunTerminalTarget
} from './automation-run-open-target'
import { getAutomationRunViewState } from './automation-run-view-state'
import type { AutomationsPageActionContext } from './automations-page-action-context'
import { launchSleepingAgentSession } from '@/lib/sleeping-agent-session-launch'
import { findAutomationRunResumeTarget } from './automation-run-resume-target'

function findPreservedRunTerminalTab(run: AutomationRun) {
  const tabId = getAutomationRunOpenTabId(run)
  if (!tabId || !run.workspaceId) {
    return null
  }
  return (
    (useAppStore.getState().tabsByWorktree[run.workspaceId] ?? []).find(
      (tab) => tab.id === tabId
    ) ?? null
  )
}

function findRunSleepingSession(run: AutomationRun): SleepingAgentSessionRecord | undefined {
  if (!run.workspaceId || !run.terminalPaneKey) {
    return undefined
  }
  const record = useAppStore.getState().sleepingAgentSessionsByPaneKey[run.terminalPaneKey]
  return record?.worktreeId === run.workspaceId ? record : undefined
}

function ensureRunSleepingSession(
  run: AutomationRun,
  agent: TuiAgent | undefined
): SleepingAgentSessionRecord | undefined {
  const existing = findRunSleepingSession(run)
  if (existing) {
    return existing
  }
  const parsed = parsePaneKey(run.terminalPaneKey ?? '')
  if (!parsed || !run.workspaceId || !run.terminalPaneKey) {
    return undefined
  }
  const state = useAppStore.getState()
  if (state.agentStatusByPaneKey?.[run.terminalPaneKey]?.providerSession) {
    state.captureSleepingAgentSessionsByWorktree?.(run.workspaceId, [run.terminalPaneKey])
    const recaptured = findRunSleepingSession(run)
    if (recaptured) {
      return recaptured
    }
  }
  const resumeAgent = isResumableTuiAgent(agent) ? agent : undefined
  const liveSession = state.agentStatusByPaneKey?.[run.terminalPaneKey]?.providerSession
  const sessionId =
    liveSession?.id?.trim() ||
    run.providerSessionId?.trim() ||
    run.usage?.providerSessionId?.trim() ||
    undefined
  if (!sessionId || !resumeAgent) {
    return undefined
  }
  const providerSession =
    liveSession && getAgentResumeArgv(resumeAgent, liveSession)
      ? liveSession
      : providerSessionMetadataForAgentResume(resumeAgent, sessionId, liveSession?.transcriptPath)
  if (!providerSession || !getAgentResumeArgv(resumeAgent, providerSession)) {
    return undefined
  }
  const record: SleepingAgentSessionRecord = {
    paneKey: run.terminalPaneKey,
    tabId: parsed.tabId,
    worktreeId: run.workspaceId,
    agent: resumeAgent,
    providerSession,
    prompt: '',
    state: 'done',
    origin: 'live',
    capturedAt: Date.now(),
    updatedAt: Date.now(),
    restoreOnTabOpenOnly: true
  }
  useAppStore.setState({
    sleepingAgentSessionsByPaneKey: {
      ...useAppStore.getState().sleepingAgentSessionsByPaneKey,
      [record.paneKey]: record
    }
  })
  return record
}

/** Resume a closed run through a fresh pane identity so a retiring owner cannot be reused. */
function reopenClosedRunSessionTab(run: AutomationRun, agent: TuiAgent | undefined): string | null {
  const sleepingRecord = ensureRunSleepingSession(run, agent)
  if (!run.workspaceId || !sleepingRecord) {
    return null
  }
  const state = useAppStore.getState()
  const existingTarget = findAutomationRunResumeTarget(sleepingRecord, state)
  if (existingTarget) {
    const layout = state.terminalLayoutsByTabId[existingTarget.tabId]
    if (existingTarget.leafId && layout) {
      state.setTabLayout(existingTarget.tabId, { ...layout, activeLeafId: existingTarget.leafId })
    }
    return existingTarget.tabId
  }
  let launchedTabId: string | null = null
  const launched = launchSleepingAgentSession(sleepingRecord, {
    onSessionLaunched: (tabId) => {
      launchedTabId = tabId
    }
  })
  if (!launched || !launchedTabId) {
    return null
  }
  const title = run.title.trim()
  if (title) {
    useAppStore.getState().setTabCustomTitle(launchedTabId, title, { recordInteraction: false })
  }
  return launchedTabId
}

function workspaceUnavailableMessage(): string {
  return translate(
    'auto.components.automations.AutomationsPage.e1bf9b1512',
    'Workspace is not available.'
  )
}

async function openRunTerminalOnOwner(
  worktreeId: string,
  environmentId: string,
  paneRef: { tabId: string; leafId: string }
): Promise<void> {
  const opened = await activateWebRuntimeSessionTab({
    worktreeId,
    tabId: paneRef.tabId,
    environmentId,
    leafId: paneRef.leafId,
    expectedCurrentLocalTabId: resolveWebSessionVisibleTabId(useAppStore.getState(), worktreeId)
  })
  if (!opened) {
    toast.error(
      translate('components.automations.runTerminalUnavailable', 'Run terminal is unavailable.')
    )
  }
}

/** Opens the original run terminal when its host-qualified workspace is alive. */
export function createAutomationRunWorkspaceAction({ store, list }: AutomationsPageActionContext) {
  const { repoForRow, worktreeForRow } = store
  const { selectedRow } = list
  return function openRunWorkspace(run: AutomationRun): void {
    const runWorktree =
      run.workspaceId && selectedRow
        ? (worktreeForRow(selectedRow, repoForRow(selectedRow), run.workspaceId) ?? null)
        : null
    const appStore = useAppStore.getState()
    const ownerEnvironmentId = runWorktree
      ? getAutomationRunOwnerEnvironmentId(appStore, run.workspaceId, runWorktree.hostId)
      : null
    const openTabId = getAutomationRunOpenTabId(run)
    const terminalTabExists = Boolean(findPreservedRunTerminalTab(run))
    const currentLayout = openTabId ? appStore.terminalLayoutsByTabId[openTabId] : null
    const livePtyIds = openTabId ? (appStore.ptyIdsByTabId[openTabId] ?? []) : []
    const paneMounted = isAutomationRunPaneMounted({
      run,
      terminalTabExists,
      currentLayout
    })
    const localTarget = resolveAutomationRunOpenTarget({
      run,
      terminalTabExists,
      currentLayout,
      livePtyIds
    })
    const terminalTarget =
      localTarget ??
      resolveAutomationRunTerminalTarget(
        run,
        {
          hasTerminalTab: (tabId) => Boolean(appStore.getTab(tabId)),
          terminalLayoutsByTabId: appStore.terminalLayoutsByTabId,
          ptyIdsByTabId: appStore.ptyIdsByTabId
        },
        ownerEnvironmentId
      )
    const runViewState = getAutomationRunViewState({
      run,
      workspaceExists: Boolean(runWorktree),
      terminalTargetExists: paneMounted || terminalTarget !== null,
      terminalOnPairedServer: ownerEnvironmentId !== null
    })
    if (!run.workspaceId || !runWorktree || !runViewState.canOpen) {
      toast.error(runViewState.statusLabel)
      return
    }
    const paneRef = parsePaneKey(run.terminalPaneKey ?? '')
    if (runViewState.availability === 'terminal' && !terminalTarget) {
      if (!ownerEnvironmentId || !paneRef) {
        toast.error(runViewState.statusLabel)
        return
      }
      if (!activateAndRevealWorktree(run.workspaceId)) {
        toast.error(workspaceUnavailableMessage())
        return
      }
      // Why: the mirror may not hold the pane yet; the server focuses it when it arrives.
      void openRunTerminalOnOwner(run.workspaceId, ownerEnvironmentId, paneRef)
      return
    }
    const workspaceId = run.workspaceId
    const revealWorkspace = (): boolean => {
      if (activateAndRevealWorktree(workspaceId)) {
        return true
      }
      toast.error(workspaceUnavailableMessage())
      return false
    }
    // Why: a still-mounted pane is View run — never launch another --resume into it.
    if (paneMounted) {
      if (!revealWorkspace()) {
        return
      }
      if (terminalTarget && currentLayout && terminalTarget.tabId === openTabId) {
        appStore.setTabLayout(
          terminalTarget.tabId,
          buildAutomationRunOpenLayout({ target: terminalTarget, currentLayout })
        )
        appStore.setActiveTab(terminalTarget.tabId)
        appStore.setActiveTabType('terminal', workspaceId)
        activateTerminalTabOnOwner(workspaceId, terminalTarget.tabId, terminalTarget.leafId)
      }
      return
    }
    if (terminalTarget) {
      const targetLayout = appStore.terminalLayoutsByTabId[terminalTarget.tabId]
      if (targetLayout && revealWorkspace()) {
        appStore.setTabLayout(
          terminalTarget.tabId,
          buildAutomationRunOpenLayout({ target: terminalTarget, currentLayout: targetLayout })
        )
        appStore.setActiveTab(terminalTarget.tabId)
        appStore.setActiveTabType('terminal', workspaceId)
        activateTerminalTabOnOwner(workspaceId, terminalTarget.tabId, terminalTarget.leafId)
        return
      }
    }
    // Why: remount first so worktree activation cannot steal another sleeping tab.
    const remountedTabId = reopenClosedRunSessionTab(run, selectedRow?.automation.agentId)
    if (!revealWorkspace()) {
      return
    }
    if (remountedTabId) {
      const focused = useAppStore.getState()
      focused.setActiveTab(remountedTabId)
      focused.setActiveTabType('terminal', workspaceId)
      return
    }
    toast.message(runViewState.statusLabel)
  }
}

export type AutomationRunWorkspaceAction = ReturnType<typeof createAutomationRunWorkspaceAction>
