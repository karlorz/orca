export {
  formatFinalTranscriptSegment,
  shouldInsertSpaceBetweenFinalSegments
} from '../../../../shared/dictation-segment-format'

// Why: Apple Speech often never emits isFinal on stop; keep the last partial so
// desktop dictation can still insert the text the listening pill already showed.
export function unresolvedPartialTranscript(receivedFinal: boolean, lastPartial: string): string {
  if (receivedFinal) {
    return ''
  }
  return lastPartial.trim() ? lastPartial : ''
}

export type DictationStopTranscriptAction =
  | { type: 'commit'; text: string }
  | { type: 'empty' }
  | { type: 'none' }

export function shouldFinishDictationOnRemoteStop(state: string): boolean {
  return state === 'listening' || state === 'starting'
}

export function resolveDictationStopTranscript(input: {
  sessionErrored: boolean
  receivedFinal: boolean
  lastPartial: string
  capturedChunkCount: number
}): DictationStopTranscriptAction {
  if (input.sessionErrored || input.receivedFinal) {
    return { type: 'none' }
  }
  const leftover = unresolvedPartialTranscript(false, input.lastPartial)
  if (leftover) {
    return { type: 'commit', text: leftover }
  }
  if (input.capturedChunkCount > 0) {
    return { type: 'empty' }
  }
  return { type: 'none' }
}
