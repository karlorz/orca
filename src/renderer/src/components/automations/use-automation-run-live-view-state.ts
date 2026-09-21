import { useAppStore } from '@/store'
import type { AutomationRun } from '../../../../shared/automations-types'
import { selectAutomationRunPaneMounted } from './automation-run-open-target'
import { getAutomationRunViewState, type AutomationRunViewState } from './automation-run-view-state'

/** Subscribe to this run's tab so View run / Resume flips without leaving the page. */
export function useAutomationRunLiveViewState({
  run,
  workspaceExists
}: {
  run: AutomationRun
  workspaceExists: boolean
}): AutomationRunViewState {
  const terminalTargetExists = useAppStore((state) => selectAutomationRunPaneMounted(state, run))
  return getAutomationRunViewState({
    run,
    workspaceExists,
    terminalTargetExists
  })
}
