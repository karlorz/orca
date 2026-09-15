import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command SET-PLAYBACK-SLOT. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandSetPlaybackSlot(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandSetPlaybackSlot(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandSetPlaybackSlot(state) === false
}
