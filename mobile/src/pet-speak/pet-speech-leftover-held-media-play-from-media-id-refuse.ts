import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command PLAY-FROM-MEDIA-ID. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandPlayFromMediaId(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandPlayFromMediaId(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandPlayFromMediaId(state) === false
}
