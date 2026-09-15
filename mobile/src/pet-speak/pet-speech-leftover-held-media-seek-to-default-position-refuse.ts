import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command SEEK-TO-DEFAULT-POSITION. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandSeekToDefaultPosition(
  _state: LeftoverHeldState
): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandSeekToDefaultPosition(
  state: LeftoverHeldState
): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandSeekToDefaultPosition(state) === false
}
