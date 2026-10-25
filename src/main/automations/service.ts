import {
  AutomationDispatchCancelledError,
  type AutomationRendererChannel
} from './automation-dispatch-request'
import {
  dispatchAutomationRun,
  evaluateScheduledAutomation,
  resolveAutomationDispatchTarget,
  type AutomationScheduledDispatchHost
} from './automation-scheduled-dispatch'
export type { AutomationRendererChannel } from './automation-dispatch-request'
import type { Store } from '../persistence'
import {
  isFinalAutomationRunStatus,
  type AutomationDispatchResult,
  type AutomationPrecheckResult,
  type AutomationRun
} from '../../shared/automations-types'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import { failedPrecheckResult, runAutomationPrecheck } from './precheck-runner'
import { captureLegacyRunTarget } from './run-target-resolution'
import { writeAutomationRunUsage } from './run-usage-collection'
import type { HeadlessAutomationDispatcher } from './headless-dispatch'
import { runKeyedSerializedOperation } from '../cli/keyed-promise-queue'
import { clearAutomationDispatchTokens } from './dispatch-tokens'
import {
  AutomationRunCompletionWatcher,
  type AutomationRunTerminalObserver
} from './run-completion-watcher'
import { createAutomationRunWriter, type AutomationRunWriter } from './automation-run-writer'
import { createAutomationRunResultCapture } from './automation-run-result-capture'
import { reportAutomationScheduleDrift } from './schedule-drift-report'
import { recordRefusedAutomationRun, recordUnevaluableAutomation } from './dispatch-refusal'
import type {
  AutomationsChangedPayload,
  PublishAutomationsChanged
} from '../../shared/runtime-client-events'

const DEFAULT_TICK_MS = 60 * 1000

export class AutomationService {
  private readonly store: Store
  private readonly tickMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private webContents: AutomationRendererChannel | null = null
  private rendererReady = false
  private evaluating = false
  private stopped = false
  private dispatchGeneration = 0
  private readonly claudeUsage: ClaudeUsageStore | null
  private readonly codexUsage: CodexUsageStore | null
  private readonly allowRemoteHostScheduling: boolean
  private readonly headlessDispatcher: HeadlessAutomationDispatcher | null
  private readonly automationLanes = new Map<string, Promise<void>>()
  /** Close unused completed terminals on headless hosts; return the count. */
  releaseFinishedRunTerminals: (() => Promise<number>) | null = null
  private readonly publish: PublishAutomationsChanged | null
  private readonly runs: AutomationRunWriter
  private readonly completionWatcher: AutomationRunCompletionWatcher | null
  private readonly resultCapture: ReturnType<typeof createAutomationRunResultCapture>
  /** Installed by desktop IPC registration, where external probes live; null on
   *  runtime servers. Orca's own automation traffic parks queued external
   *  probes behind this lease, whichever transport carried it. */
  externalProbePriority: (<T>(run: () => T) => T) | null = null

  constructor(
    store: Store,
    opts: {
      tickMs?: number
      claudeUsage?: ClaudeUsageStore
      codexUsage?: CodexUsageStore
      allowRemoteHostScheduling?: boolean
      headlessDispatcher?: HeadlessAutomationDispatcher
      terminalObserver?: AutomationRunTerminalObserver
      agentResultSource?: Parameters<typeof createAutomationRunResultCapture>[0]
      onAutomationsChanged?: PublishAutomationsChanged
    } = {}
  ) {
    this.store = store
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS
    this.claudeUsage = opts.claudeUsage ?? null
    this.codexUsage = opts.codexUsage ?? null
    this.allowRemoteHostScheduling = opts.allowRemoteHostScheduling ?? false
    this.headlessDispatcher = opts.headlessDispatcher ?? null
    this.publish = opts.onAutomationsChanged ?? null
    this.runs = createAutomationRunWriter(store, this.publish)
    this.resultCapture = createAutomationRunResultCapture(opts.agentResultSource, store, this.runs)
    this.completionWatcher = opts.terminalObserver
      ? new AutomationRunCompletionWatcher({
          observer: opts.terminalObserver,
          readRun: (automationId, runId) =>
            this.store.listAutomationRuns(automationId).find((entry) => entry.id === runId) ?? null,
          markDispatchResult: (result) => this.markDispatchResult(result)
        })
      : null
  }

  publishAutomationsChanged(payload: AutomationsChangedPayload = {}): void {
    this.publish?.(payload)
  }

  setWebContents(webContents: AutomationRendererChannel | null): void {
    this.webContents = webContents
    this.rendererReady = false
  }

  setRendererReady(): void {
    this.rendererReady = true
    // Pane lookup becomes authoritative after the renderer publishes its window graph.
    this.completionWatcher?.markTerminalSurfaceReady()
    void this.evaluateDueRuns()
  }

  start(): void {
    if (this.timer) {
      return
    }
    this.stopped = false
    this.timer = setInterval(() => {
      void this.evaluateDueRuns()
    }, this.tickMs)
    this.completionWatcher?.reconcileRetainedRuns(this.store.listAutomationRuns())
    reportAutomationScheduleDrift(this.store.listAutomations())
    // Headless hosts need startup catch-up without a renderer-ready notification.
    if (this.rendererReady || this.headlessDispatcher) {
      // Serve adopts PTYs and publishes its graph before start().
      this.completionWatcher?.markTerminalSurfaceReady()
      void this.evaluateDueRuns()
    }
  }

  stop(): void {
    this.stopped = true
    this.dispatchGeneration += 1
    this.completionWatcher?.dispose()
    this.resultCapture?.dispose()
    if (!this.timer) {
      return
    }
    clearInterval(this.timer)
    this.timer = null
  }

  async runNow(automationId: string): Promise<AutomationRun> {
    const generation = this.dispatchGeneration
    const listed = this.store.listAutomations().find((entry) => entry.id === automationId)
    if (!listed) {
      throw new Error('Automation not found.')
    }
    const automation = captureLegacyRunTarget(this.store, listed, this.allowRemoteHostScheduling)
    const target = resolveAutomationDispatchTarget(this.dispatchHost(), automation)
    const run = await this.runs.createRun(automation, Date.now(), 'manual')
    return await dispatchAutomationRun(this.dispatchHost(), automation, run, target, generation)
  }

  async recordRefusedRun(automationId: string): Promise<void> {
    const automation = this.store.listAutomations().find((entry) => entry.id === automationId)
    if (automation) {
      await recordRefusedAutomationRun({
        store: this.store,
        runs: this.runs,
        automation,
        allowRemoteHostScheduling: this.allowRemoteHostScheduling
      })
    }
  }

  async runPrecheck(automationId: string, runId: string): Promise<AutomationPrecheckResult | null> {
    const automation = this.store.listAutomations().find((entry) => entry.id === automationId)
    if (!automation) {
      throw new Error('Automation not found.')
    }
    const run = this.store.listAutomationRuns(automationId).find((entry) => entry.id === runId)
    if (!run) {
      throw new Error('Automation run not found.')
    }
    if (run.trigger !== 'scheduled' || !automation.precheck) {
      return null
    }
    const target = resolveAutomationDispatchTarget(this.dispatchHost(), automation)
    if (!target.ok) {
      return failedPrecheckResult(automation.precheck, Date.now(), target.error)
    }
    return await runAutomationPrecheck({
      precheck: automation.precheck,
      target:
        automation.executionTargetType === 'ssh'
          ? { type: 'ssh', cwd: target.cwd, connectionId: automation.executionTargetId }
          : { type: 'local', cwd: target.cwd }
    })
  }

  async markDispatchResult(result: AutomationDispatchResult): Promise<AutomationRun> {
    let run = await this.runs.updateRun(result)
    clearAutomationDispatchTokens(run.automationId, run.id)
    if (!isFinalAutomationRunStatus(run.status)) {
      if (run.status === 'dispatched') {
        this.resultCapture?.track(run)
        this.completionWatcher?.watch(run)
      }
      return run
    }
    this.completionWatcher?.forget(run.id)
    run = (await this.resultCapture?.refresh(run)) ?? run
    // Why: the renderer's mark-completed effect can re-fire for the same run
    // before refresh() flips its status snapshot off 'dispatched'. Re-running
    // collectRunUsage advances the attribution window and can rewrite an
    // already-collected 'known' usage to 'unavailable'/'ambiguous_session'.
    if (run.usage) {
      return run
    }
    return await writeAutomationRunUsage({
      store: this.store,
      runs: this.runs,
      run,
      claudeUsage: this.claudeUsage,
      codexUsage: this.codexUsage
    })
  }

  private async evaluateDueRuns(): Promise<void> {
    if (this.evaluating || this.stopped) {
      return
    }
    this.evaluating = true
    const generation = this.dispatchGeneration
    try {
      const now = Date.now()
      for (const automation of this.store.listAutomations()) {
        if (this.stopped || generation !== this.dispatchGeneration) {
          break
        }
        if (!automation.enabled || automation.nextRunAt > now) {
          continue
        }
        // A malformed schedule must not prevent later due rows from running.
        try {
          await evaluateScheduledAutomation(this.dispatchHost(), automation, now)
        } catch (error) {
          if (
            !(error instanceof AutomationDispatchCancelledError) &&
            !this.stopped &&
            generation === this.dispatchGeneration &&
            this.store.listAutomations().some((current) => current.id === automation.id)
          ) {
            await recordUnevaluableAutomation({ runs: this.runs, automation, error })
          }
        }
      }
    } finally {
      this.evaluating = false
    }
  }

  /**
   * One run of an automation at a time claims, prechecks, picks, prompts and records its agent,
   * and headless retention closes that automation's terminals in the same lane, so no two ever
   * claim one pane. Held only until the run is dispatched, never while its agent works.
   */
  runInAutomationLane<T>(automationId: string, operation: () => Promise<T>): Promise<T> {
    return runKeyedSerializedOperation(this.automationLanes, automationId, operation)
  }

  private dispatchHost(): AutomationScheduledDispatchHost {
    return {
      store: this.store,
      runs: this.runs,
      runInAutomationLane: (id, operation) => this.runInAutomationLane(id, operation),
      tickMs: this.tickMs,
      isStopped: () => this.stopped,
      dispatchGeneration: () => this.dispatchGeneration,
      headlessDispatcher: this.headlessDispatcher,
      allowRemoteHostScheduling: this.allowRemoteHostScheduling,
      webContents: () => this.webContents,
      rendererReady: () => this.rendererReady,
      completionWatcher: this.completionWatcher,
      runPrecheck: (automationId, runId) => this.runPrecheck(automationId, runId),
      markDispatchResult: (result) => this.markDispatchResult(result)
    }
  }
}
