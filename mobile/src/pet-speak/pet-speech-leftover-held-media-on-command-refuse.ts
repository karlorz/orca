import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command ON-COMMAND (onCommand). Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandOnCommand(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandOnCommand(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandOnCommand(state) === false
}
