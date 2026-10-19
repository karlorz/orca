import type { Store } from '../persistence'
import type {
  Automation,
  AutomationDispatchResult,
  AutomationPrecheckResult,
  AutomationRun
} from '../../shared/automations-types'
import {
  requestAutomationDispatch,
  type AutomationRendererChannel
} from './automation-dispatch-request'
import { resolveAutomationRunTarget, type AutomationRunTargetResult } from './run-target-resolution'
import {
  describeScheduledRefusal,
  missedBeyondGrace,
  recordMissedRun,
  WSL_MOVE_OWNED_BY_HOST
} from './dispatch-refusal'
import type { AutomationRunWriter } from './automation-run-writer'
import type { HeadlessAutomationDispatcher } from './headless-dispatch'
import type { AutomationRunCompletionWatcher } from './run-completion-watcher'

export type AutomationScheduledDispatchHost = {
  store: Store
  runInAutomationLane<T>(id: string, operation: () => Promise<T>): Promise<T>
  runs: AutomationRunWriter
  tickMs: number
  isStopped: () => boolean
  dispatchGeneration: () => number
  headlessDispatcher: HeadlessAutomationDispatcher | null
  allowRemoteHostScheduling: boolean
  webContents: () => AutomationRendererChannel | null
  rendererReady: () => boolean
  completionWatcher: AutomationRunCompletionWatcher | null
  runPrecheck(automationId: string, runId: string): Promise<AutomationPrecheckResult | null>
  markDispatchResult(result: AutomationDispatchResult): Promise<AutomationRun>
}

export function resolveAutomationDispatchTarget(
  host: Pick<AutomationScheduledDispatchHost, 'store' | 'allowRemoteHostScheduling'>,
  automation: Automation
): AutomationRunTargetResult {
  return resolveAutomationRunTarget(host.store, automation, {
    allowRemoteHostScheduling: host.allowRemoteHostScheduling
  })
}

export function canDispatchAutomationToRenderer(
  host: Pick<AutomationScheduledDispatchHost, 'webContents' | 'rendererReady'>
): boolean {
  const webContents = host.webContents()
  return Boolean(webContents && !webContents.isDestroyed() && host.rendererReady())
}

export function dispatchAutomationRun(
  host: AutomationScheduledDispatchHost,
  automation: Automation,
  run: AutomationRun,
  target: AutomationRunTargetResult,
  generation: number
): Promise<AutomationRun> {
  return host.runInAutomationLane(automation.id, () =>
    requestAutomationDispatch(
      {
        store: host.store,
        runs: host.runs,
        isActive: () => !host.isStopped() && generation === host.dispatchGeneration(),
        getRenderer: () => (canDispatchAutomationToRenderer(host) ? host.webContents() : null),
        headlessDispatcher: host.headlessDispatcher,
        resolveTarget: (current) => resolveAutomationDispatchTarget(host, current),
        runPrecheck: () => host.runPrecheck(automation.id, run.id),
        markDispatchResult: (result) => host.markDispatchResult(result),
        watchRun: (dispatched) => host.completionWatcher?.watch(dispatched)
      },
      automation,
      run,
      target
    )
  )
}

export async function evaluateScheduledAutomation(
  host: AutomationScheduledDispatchHost,
  automation: Automation,
  now: number
): Promise<void> {
  const generation = host.dispatchGeneration()
  const scheduledFor = host.store.getLatestAutomationOccurrence(automation, now)
  if (scheduledFor === null) {
    await host.runs.advanceNextRun(automation.id, now)
    return
  }
  if (missedBeyondGrace({ automation, scheduledFor, now, tickMs: host.tickMs })) {
    await recordMissedRun({ runs: host.runs, automation, scheduledFor })
    await host.runs.advanceNextRun(automation.id, now)
    return
  }

  const target = resolveAutomationDispatchTarget(host, automation)
  const canDispatch = canDispatchAutomationToRenderer(host) || Boolean(host.headlessDispatcher)
  const refusal = describeScheduledRefusal({ target, canDispatch })
  if (refusal === WSL_MOVE_OWNED_BY_HOST) {
    await host.runs.advanceNextRun(automation.id, now)
    return
  }
  if (refusal && (await host.runs.repeatSkip(automation.id, refusal, scheduledFor))) {
    await host.runs.advanceNextRun(automation.id, now)
    return
  }

  await dispatchAutomationRun(
    host,
    automation,
    await host.runs.createRun(automation, scheduledFor),
    target,
    generation
  )
  await host.runs.advanceNextRun(automation.id, now)
}
