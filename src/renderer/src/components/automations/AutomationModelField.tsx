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
          onDraftChange((current) => ({ ...current, model: event.target.value }))
        }
        className={`font-mono text-xs ${pickerTriggerClassName}`}
      />
      <Select
        value={draft.reasoningEffort || 'default'}
        onValueChange={(value) =>
          onDraftChange((current) => ({
            ...current,
            reasoningEffort:
              value === 'default' ? '' : (value as 'low' | 'medium' | 'high' | 'xhigh')
          }))
        }
      >
        <SelectTrigger
          className={`mt-2 h-9 w-full ${pickerTriggerClassName}`}
          aria-label="Reasoning effort"
        >
          <SelectValue placeholder="Agent default" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Agent default</SelectItem>
          <SelectItem value="low">Low</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="high">High</SelectItem>
          <SelectItem value="xhigh">Extra high</SelectItem>
        </SelectContent>
      </Select>
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
          aria-label="Agent profile"
        >
          <SelectValue placeholder="Agent default" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Agent default</SelectItem>
          <SelectItem value="minimal">Minimal</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  )
}
