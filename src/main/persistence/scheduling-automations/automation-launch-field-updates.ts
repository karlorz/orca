import { getAgentSessionOptionCatalog } from '../../../shared/agent-session-option-catalog'
import {
  isAutomationReasoningEffortSupported,
  normalizeAutomationModel,
  normalizeAutomationReasoningEffort,
  validateAutomationAgentFlags
} from '../../../shared/automation-model'
import type {
  Automation,
  AutomationCreateInput,
  AutomationUpdateInput
} from '../../../shared/automations-types'

type LaunchPatch = Partial<
  Pick<Automation, 'model' | 'reasoningEffort' | 'agentProfile' | 'agentFlags'>
>

export function launchFieldsForAutomationCreate(
  input: Pick<
    AutomationCreateInput,
    'agentId' | 'model' | 'reasoningEffort' | 'agentProfile' | 'agentFlags'
  >
): LaunchPatch {
  const model = normalizeAutomationModel(input.model)
  const reasoningEffort = normalizeAutomationReasoningEffort(input.reasoningEffort)
  const agentProfile = input.agentProfile === 'minimal' ? 'minimal' : undefined
  const agentFlags =
    input.agentFlags == null || input.agentFlags === ''
      ? undefined
      : validateAutomationAgentFlags(input.agentFlags)
  if (model && !getAgentSessionOptionCatalog(input.agentId)?.modelApply.launchArgs) {
    throw new Error('The selected agent does not support automation model overrides.')
  }
  if (
    input.reasoningEffort !== undefined &&
    input.reasoningEffort !== null &&
    !isAutomationReasoningEffortSupported(input.agentId, model, input.reasoningEffort)
  ) {
    throw new Error('Reasoning effort is not supported by the selected agent model.')
  }
  if (agentProfile && input.agentId !== 'grok') {
    throw new Error('Agent profile is only supported by Grok.')
  }
  return {
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(agentProfile ? { agentProfile } : {}),
    ...(agentFlags ? { agentFlags } : {})
  }
}

export function launchFieldUpdatesForAutomation(
  current: Automation,
  definedUpdates: AutomationUpdateInput
): LaunchPatch {
  // Why `Object.hasOwn` and not the spread alone: an empty or unlaunchable id has
  // to clear the stored model, or the automation keeps launching a model the user
  // removed. An absent field keeps it.
  const modelUpdate: Pick<Automation, 'model'> = Object.hasOwn(definedUpdates, 'model')
    ? { model: normalizeAutomationModel(definedUpdates.model) ?? null }
    : {}
  const reasoningEffortUpdate: Pick<Automation, 'reasoningEffort'> = Object.hasOwn(
    definedUpdates,
    'reasoningEffort'
  )
    ? {
        reasoningEffort: normalizeAutomationReasoningEffort(definedUpdates.reasoningEffort) ?? null
      }
    : {}
  const agentProfileUpdate: Pick<Automation, 'agentProfile'> = Object.hasOwn(
    definedUpdates,
    'agentProfile'
  )
    ? { agentProfile: definedUpdates.agentProfile === 'minimal' ? 'minimal' : null }
    : {}
  const agentFlagsUpdate: Pick<Automation, 'agentFlags'> = Object.hasOwn(
    definedUpdates,
    'agentFlags'
  )
    ? {
        agentFlags:
          definedUpdates.agentFlags == null || definedUpdates.agentFlags === ''
            ? null
            : (validateAutomationAgentFlags(definedUpdates.agentFlags) ?? null)
      }
    : {}
  const effectiveModel = Object.hasOwn(definedUpdates, 'model')
    ? normalizeAutomationModel(definedUpdates.model)
    : current.model
  const effectiveAgent = definedUpdates.agentId ?? current.agentId
  const effectiveEffort = Object.hasOwn(definedUpdates, 'reasoningEffort')
    ? normalizeAutomationReasoningEffort(definedUpdates.reasoningEffort)
    : current.reasoningEffort
  if (
    effectiveEffort &&
    !isAutomationReasoningEffortSupported(effectiveAgent, effectiveModel, effectiveEffort)
  ) {
    throw new Error('Reasoning effort is not supported by the selected agent model.')
  }
  if (effectiveModel && !getAgentSessionOptionCatalog(effectiveAgent)?.modelApply.launchArgs) {
    throw new Error('The selected agent does not support automation model overrides.')
  }
  if (definedUpdates.agentProfile === 'minimal' && effectiveAgent !== 'grok') {
    throw new Error('Agent profile is only supported by Grok.')
  }
  return {
    ...modelUpdate,
    ...reasoningEffortUpdate,
    ...agentProfileUpdate,
    ...agentFlagsUpdate
  }
}
