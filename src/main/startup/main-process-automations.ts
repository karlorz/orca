import { AutomationService } from '../automations/service'
import { buildAutomationModelLaunchPreferences } from '../../shared/automation-model'
import { buildHeadlessAutomationWorktreeCreateArgs } from '../automations/headless-workspace-create'
import { createRuntimeAutomationRunTerminalObserver } from '../automations/runtime-terminal-run-observer'
import { mainProcessState as state } from './main-process-state'
import { agentHookServer } from '../agent-hooks/server'
import { createAutomationAgentResultSource } from '../automations/automation-run-agent-result-source'

export function initializeMainProcessAutomations(): AutomationService {
  const store = state.store
  const runtime = state.runtime
  const claudeUsage = state.claudeUsage
  const codexUsage = state.codexUsage
  if (!store || !runtime || !claudeUsage || !codexUsage) {
    throw new Error('Runtime and usage stores must be initialized before automations')
  }
  const service = new AutomationService(store, {
    claudeUsage,
    codexUsage,
    agentResultSource: createAutomationAgentResultSource(agentHookServer),
    terminalObserver: createRuntimeAutomationRunTerminalObserver(runtime, (paneKey) =>
      agentHookServer.getStatusSnapshotForPane(paneKey)
    ),
    onAutomationsChanged: (payload) => runtime.notifyAutomationsChanged(payload),
    // Why: desktop clients mirror remote-host automations, but only a server process should execute remote_host_service-owned schedules.
    allowRemoteHostScheduling: state.isServeMode,
    headlessDispatcher: state.isServeMode
      ? async ({ automation, run, target }) => {
          const modelLaunchPreferences = buildAutomationModelLaunchPreferences(
            automation.agentId,
            automation.model,
            automation.reasoningEffort,
            automation.agentProfile,
            automation.extraArgs
          )
          let terminalSessionId: string | null = null
          let terminalPaneKey: string | null = null
          let terminalPtyId: string | null = null
          let workspaceId: string
          let workspaceDisplayName: string | null = null
          if (automation.workspaceMode === 'new_per_run') {
            const created = await runtime.createManagedWorktree(
              buildHeadlessAutomationWorktreeCreateArgs({ automation, run, repo: target.repo })
            )
            const startupTerminalHandle = created.startupTerminal?.handle ?? ''
            terminalSessionId = created.startupTerminal?.tabId ?? null
            terminalPaneKey = created.startupTerminal?.paneKey ?? null
            terminalPtyId = created.startupTerminal?.ptyId ?? null
            workspaceId = created.worktree.id
            workspaceDisplayName = created.worktree.displayName ?? null
            if (!startupTerminalHandle) {
              throw new Error(
                created.warning ||
                  'Automation workspace was created, but no agent terminal started.'
              )
            }
          } else {
            if (!automation.workspaceId) {
              throw new Error('The target workspace is no longer available.')
            }
            const terminal = await runtime.launchAgentTerminal(`id:${automation.workspaceId}`, {
              agent: automation.agentId,
              prompt: automation.prompt,
              ...(modelLaunchPreferences ? { launchPreferences: modelLaunchPreferences } : {}),
              title: run.title
            })
            terminalSessionId = terminal.tabId ?? null
            terminalPaneKey = terminal.paneKey ?? null
            terminalPtyId = terminal.ptyId ?? null
            workspaceId = terminal.worktreeId
            const worktree = await runtime.showManagedWorktree(`id:${workspaceId}`)
            workspaceDisplayName = worktree.displayName ?? null
          }
          return {
            workspaceId,
            workspaceDisplayName,
            terminalSessionId,
            terminalPaneKey,
            terminalPtyId
          }
        }
      : undefined
  })
  state.automations = service
  runtime.setAutomationService(service)
  return service
}
