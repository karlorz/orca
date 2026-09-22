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
import {
  buildAutomationRunOpenLayout,
  getAutomationRunOpenTabId,
  isAutomationRunPaneMounted,
  resolveAutomationRunOpenTarget
} from './automation-run-open-target'
import { getAutomationRunViewState } from './automation-run-view-state'
import type { AutomationsPageActionContext } from './automations-page-action-context'

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

/** Remount the run's pane so in-place `--resume` can use its sleeping record. */
function reopenClosedRunSessionTab(run: AutomationRun, agent: TuiAgent | undefined): string | null {
  const parsed = parsePaneKey(run.terminalPaneKey ?? '')
  const sleepingRecord = ensureRunSleepingSession(run, agent)
  if (!parsed || !run.workspaceId || !sleepingRecord) {
    return null
  }
  const state = useAppStore.getState()
  const tab = state.createTab(run.workspaceId, undefined, undefined, {
    id: parsed.tabId,
    initialLeafId: parsed.leafId,
    launchAgent: sleepingRecord.agent,
    activate: true
  })
  if (tab.id !== parsed.tabId) {
    return null
  }
  const title = run.title.trim()
  if (title) {
    state.setTabCustomTitle(tab.id, title, { recordInteraction: false })
  }
  return tab.id
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
    const openTabId = getAutomationRunOpenTabId(run)
    const terminalTabExists = Boolean(findPreservedRunTerminalTab(run))
    const currentLayout = openTabId ? appStore.terminalLayoutsByTabId[openTabId] : null
    const livePtyIds = openTabId ? (appStore.ptyIdsByTabId[openTabId] ?? []) : []
    const paneMounted = isAutomationRunPaneMounted({
      run,
      terminalTabExists,
      currentLayout
    })
    const terminalTarget = resolveAutomationRunOpenTarget({
      run,
      terminalTabExists,
      currentLayout,
      livePtyIds
    })
    const runViewState = getAutomationRunViewState({
      run,
      workspaceExists: Boolean(runWorktree),
      terminalTargetExists: paneMounted
    })
    if (!run.workspaceId || !runWorktree || !runViewState.canOpen) {
      toast.error(runViewState.statusLabel)
      return
    }
    const workspaceId = run.workspaceId
    const revealWorkspace = (): boolean => {
      if (activateAndRevealWorktree(workspaceId)) {
        return true
      }
      toast.error(
        translate(
          'auto.components.automations.AutomationsPage.e1bf9b1512',
          'Workspace is not available.'
        )
      )
      return false
    }
    // Why: a still-mounted pane is View run — never launch another --resume into it.
    if (paneMounted) {
      if (!revealWorkspace()) {
        return
      }
      if (terminalTarget && currentLayout) {
        appStore.setTabLayout(
          terminalTarget.tabId,
          buildAutomationRunOpenLayout({ target: terminalTarget, currentLayout })
        )
        appStore.setActiveTab(terminalTarget.tabId)
        appStore.setActiveTabType('terminal')
      }
      return
    }
    // Why: remount first so worktree activation cannot steal another sleeping tab.
    const remountedTabId = reopenClosedRunSessionTab(run, selectedRow?.automation.agentId)
    if (!revealWorkspace()) {
      return
    }
    if (remountedTabId) {
      const focused = useAppStore.getState()
      focused.setActiveTab(remountedTabId)
      focused.setActiveTabType('terminal')
      return
    }
    toast.message(runViewState.statusLabel)
  }
}

export type AutomationRunWorkspaceAction = ReturnType<typeof createAutomationRunWorkspaceAction>
