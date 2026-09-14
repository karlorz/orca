import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command PREPARE-FROM-MEDIA-ID. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandPrepareFromMediaId(
  _state: LeftoverHeldState
): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandPrepareFromMediaId(
  state: LeftoverHeldState
): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandPrepareFromMediaId(state) === false
}
