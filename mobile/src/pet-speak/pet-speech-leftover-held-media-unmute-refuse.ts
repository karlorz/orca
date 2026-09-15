import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command UNMUTE. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandUnmute(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandUnmute(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandUnmute(state) === false
}
