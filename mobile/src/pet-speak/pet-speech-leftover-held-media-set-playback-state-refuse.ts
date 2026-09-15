import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command SET-PLAYBACK-STATE. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandSetPlaybackState(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandSetPlaybackState(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandSetPlaybackState(state) === false
}
