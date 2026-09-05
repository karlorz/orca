import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { formatFinalTranscriptSegment } from './dictation-final-segments'
import { insertText, type DictationInsertionTarget } from './dictation-insertion-target'

export function showNoSpeechDetectedToast(): void {
  toast.message(
    translate('auto.components.dictation.DictationController.5d2c3e7ae3', 'No speech detected.')
  )
}

export function commitDictationFinalTranscript(
  text: string,
  target: DictationInsertionTarget | null,
  previousInsertedText: string,
  intentionalTargetCancellation: boolean
): string {
  if (!text) {
    return previousInsertedText
  }
  if (target) {
    const textToInsert = formatFinalTranscriptSegment(text, previousInsertedText)
    insertText(textToInsert, target)
    return previousInsertedText + textToInsert
  }
  if (!intentionalTargetCancellation) {
    toast.message(
      translate(
        'auto.components.dictation.DictationController.7afff43472',
        'Dictation finished, but no text field was focused.'
      )
    )
  }
  return previousInsertedText
}
