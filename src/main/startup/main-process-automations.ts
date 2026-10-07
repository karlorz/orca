import type { AutomationService } from '../automations/service'
import { createRuntimeAutomationService } from '../automations/runtime-automation-service'
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
  const service = createRuntimeAutomationService({
    store,
    runtime,
    claudeUsage,
    codexUsage,
    agentResultSource: createAutomationAgentResultSource(agentHookServer),
    readAgentStatus: (paneKey) => agentHookServer.getStatusSnapshotForPane(paneKey),
    // Why: desktop clients mirror remote-host automations, but only a server process should execute remote_host_service-owned schedules.
    headless: state.isServeMode
  })
  state.automations = service
  return service
}
