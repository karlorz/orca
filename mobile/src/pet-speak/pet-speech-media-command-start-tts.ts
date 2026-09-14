export type MediaCommandTtsOutcome = 'RELEASE_AND_STOP_TTS' | 'RESUME' | 'IGNORE'

/** Media commands never start TTS. Fail-closed; not a leftover-held refuse cell. */
export function mediaShouldStartTts(_outcome: MediaCommandTtsOutcome): boolean {
  return false
}
