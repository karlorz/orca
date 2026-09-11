export const PET_SPEAK_CANCEL_REASONS = [
  'operator_interruption',
  'queue_replacement',
  'tts_cancellation',
  'capacity_rejection',
  'background_lifecycle',
  'receipt_timeout',
  'disconnection',
  'transport_teardown'
] as const

export type PetSpeakCancelReason = (typeof PET_SPEAK_CANCEL_REASONS)[number]

export const PET_SPEAK_BOUNDARIES = [
  'grokpet_publish',
  'relay_receive',
  'relay_enqueue',
  'relay_write',
  'relay_receipt',
  'mobile_socket_receive',
  'mobile_queue_admission',
  'acceptance_send',
  'playback_start',
  'completion_send',
  'cancellation_send'
] as const

export type PetSpeakBoundary = (typeof PET_SPEAK_BOUNDARIES)[number]

export type PetSpeakBoundaryTimestamps = Partial<Record<PetSpeakBoundary, number>>

export type PetSpeakAdmissionDecision = {
  accepted: boolean
  reason?: PetSpeakCancelReason
}

export function isPetSpeakCancelReason(value: unknown): value is PetSpeakCancelReason {
  return (
    typeof value === 'string' && (PET_SPEAK_CANCEL_REASONS as readonly string[]).includes(value)
  )
}

export function stampBoundary(
  timestamps: PetSpeakBoundaryTimestamps,
  boundary: PetSpeakBoundary,
  at: number = Date.now()
): number {
  const existing = timestamps[boundary]
  if (typeof existing === 'number') {
    return existing
  }
  timestamps[boundary] = at
  return at
}

export function compactBoundaryTimestamps(
  timestamps: PetSpeakBoundaryTimestamps | undefined
): PetSpeakBoundaryTimestamps | undefined {
  if (!timestamps) {
    return undefined
  }
  const compact: PetSpeakBoundaryTimestamps = {}
  for (const boundary of PET_SPEAK_BOUNDARIES) {
    const value = timestamps[boundary]
    if (typeof value === 'number' && Number.isFinite(value)) {
      compact[boundary] = value
    }
  }
  return Object.keys(compact).length > 0 ? compact : undefined
}

export function normalizeAdmissionDecision(
  result: boolean | PetSpeakAdmissionDecision
): PetSpeakAdmissionDecision {
  if (typeof result === 'boolean') {
    return { accepted: result }
  }
  return {
    accepted: result.accepted === true,
    ...(result.reason && isPetSpeakCancelReason(result.reason) ? { reason: result.reason } : {})
  }
}
