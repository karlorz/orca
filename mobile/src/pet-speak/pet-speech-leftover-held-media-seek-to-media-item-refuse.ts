import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command SEEK-TO-MEDIA-ITEM. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandSeekToMediaItem(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandSeekToMediaItem(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandSeekToMediaItem(state) === false
}
