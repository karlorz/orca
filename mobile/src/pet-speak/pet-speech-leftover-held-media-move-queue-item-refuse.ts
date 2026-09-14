import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command MOVE-QUEUE-ITEM. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandMoveQueueItem(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandMoveQueueItem(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandMoveQueueItem(state) === false
}
