import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command SET-AUDIO-ATTRIBUTES. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandSetAudioAttributes(
  _state: LeftoverHeldState
): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandSetAudioAttributes(
  state: LeftoverHeldState
): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandSetAudioAttributes(state) === false
}
