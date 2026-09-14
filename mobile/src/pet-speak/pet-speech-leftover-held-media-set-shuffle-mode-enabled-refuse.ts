import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command SET-SHUFFLE-MODE-ENABLED (onSetShuffleModeEnabled). Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandSetShuffleModeEnabled(
  _state: LeftoverHeldState
): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandSetShuffleModeEnabled(
  state: LeftoverHeldState
): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandSetShuffleModeEnabled(state) === false
}
