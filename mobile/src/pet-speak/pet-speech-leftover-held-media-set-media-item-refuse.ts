import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command SET-MEDIA-ITEM. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandSetMediaItem(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandSetMediaItem(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandSetMediaItem(state) === false
}
