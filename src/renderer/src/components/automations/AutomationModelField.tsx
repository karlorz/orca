import { nativeChatSessionChoiceLabel } from '@/components/native-chat/native-chat-session-option-labels'
import {
  getAutomationReasoningEffortChoices,
  normalizeAutomationReasoningEffort
} from '../../../../shared/automation-model'
import { normalizeAutomationDraftLaunchOptions } from './automation-draft-model'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { AUTOMATION_EDITOR_SECTION_LABEL_CLASS, Field } from './automation-page-parts'
import type { AutomationDraft } from './AutomationEditorDialog'

type AutomationModelFieldProps = {
  draft: AutomationDraft
  pickerTriggerClassName: string
  onDraftChange: (updater: (current: AutomationDraft) => AutomationDraft) => void
}

/** Free-form on purpose: model ids come from the user's own agent config, so
 *  Orca has no catalog to validate against. An empty value means "agent default". */
export function AutomationModelField({
  draft,
  pickerTriggerClassName,
  onDraftChange
}: AutomationModelFieldProps): React.JSX.Element {
  const effortChoices = getAutomationReasoningEffortChoices(draft.agentId, draft.model)
  return (
    <Field
      labelClassName={AUTOMATION_EDITOR_SECTION_LABEL_CLASS}
      label={translate('auto.components.automations.AutomationModelField.0c29384d39', 'Model')}
    >
      <Input
        value={draft.model}
        spellCheck={false}
        autoComplete="off"
        placeholder={translate(
          'auto.components.automations.AutomationModelField.d5bfdc61bd',
          'grok-4.5'
        )}
        aria-label={translate(
          'auto.components.automations.AutomationModelField.0c29384d39',
          'Model'
        )}
        onChange={(event) =>
          onDraftChange((current) =>
            normalizeAutomationDraftLaunchOptions({ ...current, model: event.target.value })
          )
        }
        className={`font-mono text-xs ${pickerTriggerClassName}`}
      />
      {effortChoices.length > 0 ? (
        <Select
          value={draft.reasoningEffort || 'default'}
          onValueChange={(value) =>
            onDraftChange((current) =>
              normalizeAutomationDraftLaunchOptions({
                ...current,
                reasoningEffort: normalizeAutomationReasoningEffort(value) ?? ''
              })
            )
          }
        >
          <SelectTrigger
            className={`mt-2 h-9 w-full ${pickerTriggerClassName}`}
            aria-label={translate(
              'auto.components.automations.AutomationModelField.reasoningEffort',
              'Reasoning effort'
            )}
          >
            <SelectValue
              placeholder={translate(
                'auto.components.automations.AutomationModelField.agentDefault',
                'Agent default'
              )}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">
              {translate(
                'auto.components.automations.AutomationModelField.agentDefault',
                'Agent default'
              )}
            </SelectItem>
            {effortChoices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {nativeChatSessionChoiceLabel(choice, 'effort')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {draft.agentId === 'grok' ? (
        <Select
          value={draft.agentProfile || 'default'}
          onValueChange={(value) =>
            onDraftChange((current) => ({
              ...current,
              agentProfile: value === 'default' ? '' : 'minimal'
            }))
          }
        >
          <SelectTrigger
            className={`mt-2 h-9 w-full ${pickerTriggerClassName}`}
            aria-label={translate(
              'auto.components.automations.AutomationModelField.agentProfile',
              'Agent profile'
            )}
          >
            <SelectValue
              placeholder={translate(
                'auto.components.automations.AutomationModelField.agentDefault',
                'Agent default'
              )}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">
              {translate(
                'auto.components.automations.AutomationModelField.agentDefault',
                'Agent default'
              )}
            </SelectItem>
            <SelectItem value="minimal">
              {translate('auto.components.automations.AutomationModelField.minimal', 'Minimal')}
            </SelectItem>
          </SelectContent>
        </Select>
      ) : null}
    </Field>
  )
}
