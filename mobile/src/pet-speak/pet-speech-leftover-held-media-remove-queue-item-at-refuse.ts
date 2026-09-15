import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command REMOVE-QUEUE-ITEM-AT (onRemoveQueueItemAt). Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandRemoveQueueItemAt(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandRemoveQueueItemAt(
  state: LeftoverHeldState
): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandRemoveQueueItemAt(state) === false
}
