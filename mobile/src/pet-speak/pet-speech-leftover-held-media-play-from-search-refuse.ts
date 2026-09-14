import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command PLAY-FROM-SEARCH. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandPlayFromSearch(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandPlayFromSearch(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandPlayFromSearch(state) === false
}
