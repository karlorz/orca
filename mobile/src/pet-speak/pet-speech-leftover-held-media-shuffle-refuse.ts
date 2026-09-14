import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command SHUFFLE. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandShuffle(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandShuffle(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandShuffle(state) === false
}
