import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { translate } from '@/i18n/i18n'
import type { VoiceSettings } from '../../../../shared/speech-types'
import {
  isMacSpeechSelected,
  resolveMacSpeechToggleUpdates
} from '../../../../shared/voice-dictation-selection'

type VoiceMacSpeechSectionProps = {
  voiceSettings: VoiceSettings
  onUpdateVoiceSettings: (updates: Partial<VoiceSettings>) => void
}

export function VoiceMacSpeechSection({
  voiceSettings,
  onUpdateVoiceSettings
}: VoiceMacSpeechSectionProps): React.JSX.Element {
  const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
  const checked = isMac && isMacSpeechSelected(voiceSettings)
  const disabled = !voiceSettings.enabled || !isMac

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <Label>
            {translate('auto.components.settings.VoicePane.useMacSpeech', 'Use Mac speech')}
          </Label>
          {!isMac && (
            <span className="text-[10px] text-muted-foreground">
              {translate('auto.components.settings.VoicePane.b5cda3665b', 'Mac only')}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.VoicePane.useMacSpeechDesc',
            'Use built-in Apple Speech. Language follows System Dictation. Speech Model is locked while this is on.'
          )}
        </p>
      </div>
      <Switch
        checked={checked}
        aria-label={translate(
          'auto.components.settings.VoicePane.useMacSpeech',
          'Use Mac speech'
        )}
        disabled={disabled}
        onCheckedChange={(nextChecked) => {
          onUpdateVoiceSettings(resolveMacSpeechToggleUpdates(voiceSettings, nextChecked))
        }}
      />
    </div>
  )
}
