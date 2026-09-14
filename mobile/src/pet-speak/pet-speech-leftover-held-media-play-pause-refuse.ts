import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command PLAY-PAUSE. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandPlayPause(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandPlayPause(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandPlayPause(state) === false
}
