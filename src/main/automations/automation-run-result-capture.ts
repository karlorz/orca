import type { AutomationRun, AutomationRunOutputSnapshot } from '../../shared/automations-types'
import type {
  AutomationAgentResultSource,
  AutomationAgentResultStatus
} from './automation-run-agent-result-source'
import { selectFreshExplicitAgentStatusRow } from '../runtime/runtime-hook-agent-row-selection'
import { createHeadlessAutomationOutputSnapshotBuffer } from './headless-dispatch'
import type { Store } from '../persistence'
import type { AutomationRunWriter } from './automation-run-writer'

const MAX_TRACKED_RESULT_PANES = 128

type ResultBinding = {
  run: Pick<
    AutomationRun,
    | 'id'
    | 'automationId'
    | 'terminalPaneKey'
    | 'workspaceId'
    | 'startedAt'
    | 'dispatchedAt'
    | 'createdAt'
  >
  turnStartedAt?: number
  providerPromptId?: string
  providerSessionId?: string
  launchToken?: string
  terminalHandle?: string
  connectionId?: string | null
  agentType?: string
  doneSeen: boolean
}

export function createAutomationRunResultCapture(
  source: AutomationAgentResultSource | undefined,
  store: Pick<Store, 'listAutomationRuns'>,
  writer: Pick<AutomationRunWriter, 'updateRun'>
): AutomationRunResultCapture | null {
  return source
    ? new AutomationRunResultCapture({
        source,
        readRun: (automationId, runId) =>
          store.listAutomationRuns(automationId).find((run) => run.id === runId) ?? null,
        writeSnapshot: (run, outputSnapshot) =>
          writer.updateRun({
            runId: run.id,
            status: run.status,
            error: run.error,
            outputSnapshot
          })
      })
    : null
}

export class AutomationRunResultCapture {
  private readonly bindings = new Map<string, ResultBinding>()
  private readonly unsubscribe: () => void
  private disposed = false

  constructor(
    private readonly opts: {
      source: AutomationAgentResultSource
      readRun: (automationId: string, runId: string) => AutomationRun | null
      writeSnapshot: (
        run: AutomationRun,
        snapshot: AutomationRunOutputSnapshot
      ) => Promise<AutomationRun>
    }
  ) {
    const status = opts.source.subscribe((row) => {
      const binding = this.bindings.get(row.paneKey)
      if (!binding || !this.accept(row, binding)) {
        return
      }
      const current = opts.readRun(binding.run.automationId, binding.run.id)
      if (!current) {
        this.bindings.delete(row.paneKey)
        return
      }
      void this.refreshCurrent(current, current).catch((error) => {
        console.error('[automations] Failed to capture late agent result:', error)
      })
    })
    const clear = opts.source.subscribeClear((paneKey) => this.bindings.delete(paneKey))
    this.unsubscribe = () => {
      status()
      clear()
    }
  }

  track(run: AutomationRun): void {
    if (
      this.disposed ||
      !run.terminalPaneKey ||
      this.bindings.get(run.terminalPaneKey)?.run.id === run.id
    ) {
      return
    }
    const binding: ResultBinding = {
      run: {
        id: run.id,
        automationId: run.automationId,
        terminalPaneKey: run.terminalPaneKey,
        workspaceId: run.workspaceId,
        startedAt: run.startedAt,
        dispatchedAt: run.dispatchedAt,
        createdAt: run.createdAt
      },
      doneSeen: false
    }
    this.bindings.delete(run.terminalPaneKey)
    this.bindings.set(run.terminalPaneKey, binding)
    if (this.bindings.size > MAX_TRACKED_RESULT_PANES) {
      const oldest = this.bindings.keys().next().value
      if (oldest !== undefined) {
        this.bindings.delete(oldest)
      }
    }
    this.readBindingRow(binding)
  }

  async refresh(run: AutomationRun): Promise<AutomationRun> {
    return this.refreshCurrent(run, this.opts.readRun(run.automationId, run.id))
  }

  private async refreshCurrent(
    run: AutomationRun,
    current: AutomationRun | null
  ): Promise<AutomationRun> {
    const paneKey = run.terminalPaneKey
    const binding = paneKey ? this.bindings.get(paneKey) : undefined
    if (this.disposed || !binding || binding.run.id !== run.id || !current) {
      if (!current && paneKey) {
        this.bindings.delete(paneKey)
      }
      return current ?? run
    }
    if (current.status !== 'completed' && current.status !== 'dispatch_failed') {
      return current
    }
    const row = this.readBindingRow(binding)
    if (!row || binding.turnStartedAt === undefined) {
      if (binding.turnStartedAt === undefined && paneKey) {
        this.bindings.delete(paneKey)
      }
      return current
    }
    if (
      (row.mainAgent?.state ?? row.state) !== 'done' ||
      row.lastAssistantMessageIsToolOutput === true ||
      !row.lastAssistantMessage?.trim() ||
      current.workspaceId !== binding.run.workspaceId ||
      current.terminalPaneKey !== binding.run.terminalPaneKey ||
      (current.providerSessionId && row.providerSession?.id !== current.providerSessionId)
    ) {
      return current
    }
    const buffer = createHeadlessAutomationOutputSnapshotBuffer()
    buffer.append(row.lastAssistantMessage)
    const snapshot = buffer.snapshot()
    if (!snapshot || current.outputSnapshot?.content === snapshot.content) {
      return current
    }
    const written = await this.opts.writeSnapshot(current, snapshot)
    return this.opts.readRun(run.automationId, run.id) ?? written
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.unsubscribe()
    this.bindings.clear()
  }

  private readBindingRow(binding: ResultBinding): AutomationAgentResultStatus | undefined {
    const row = this.opts.source
      .readPane(binding.run.terminalPaneKey ?? '')
      .find((candidate) => this.accept(candidate, binding))
    return row
  }

  private accept(row: AutomationAgentResultStatus, binding: ResultBinding): boolean {
    const paneKey = binding.run.terminalPaneKey
    const fresh = selectFreshExplicitAgentStatusRow({
      paneKeys: paneKey ? [paneKey] : [],
      handles: [],
      hookRows: [row]
    })
    const start = binding.run.startedAt ?? binding.run.dispatchedAt ?? binding.run.createdAt
    if (
      row.paneKey !== paneKey ||
      row.isReplay === true ||
      !fresh ||
      row.turnStartedAt === undefined ||
      row.turnStartedAt < start ||
      (row.evidenceObservedAt ?? row.receivedAt) < start ||
      row.worktreeId !== binding.run.workspaceId ||
      !row.agentType ||
      row.agentType === 'unknown'
    ) {
      return false
    }
    const state = row.mainAgent?.state ?? row.state
    if (
      (binding.providerSessionId && !row.providerSession?.id) ||
      (binding.launchToken && !row.launchToken) ||
      (binding.terminalHandle && !row.terminalHandle)
    ) {
      return false
    }
    if (
      binding.turnStartedAt !== undefined &&
      (row.turnStartedAt !== binding.turnStartedAt ||
        row.agentType !== binding.agentType ||
        row.connectionId !== binding.connectionId ||
        (binding.providerPromptId &&
          row.providerPromptId &&
          row.providerPromptId !== binding.providerPromptId) ||
        (binding.providerSessionId && row.providerSession?.id !== binding.providerSessionId) ||
        (binding.launchToken && row.launchToken !== binding.launchToken) ||
        (binding.terminalHandle && row.terminalHandle !== binding.terminalHandle) ||
        (binding.doneSeen && state !== 'done'))
    ) {
      if (paneKey) {
        this.bindings.delete(paneKey)
      }
      return false
    }
    if (row.sessionBoundary === true && !binding.doneSeen) {
      return false
    }
    if (binding.turnStartedAt === undefined) {
      binding.turnStartedAt = row.turnStartedAt
      binding.connectionId = row.connectionId
      binding.agentType = row.agentType
    }
    binding.providerPromptId ??= row.providerPromptId
    binding.providerSessionId ??= row.providerSession?.id
    binding.launchToken ??= row.launchToken
    binding.terminalHandle ??= row.terminalHandle
    binding.doneSeen ||= state === 'done'
    return true
  }
}
