export function buildDeviceStatusMessage(
  status: Record<string, unknown>,
  reporterId: string,
  connectionId?: string
): Record<string, unknown> {
  return {
    kind: 'device-status',
    deviceStatus: {
      ...status,
      ...(connectionId ? { connectionId } : {})
    },
    speak: false,
    reporter: reporterId
  }
}

export const PET_SPEAK_DEFAULT_RATE = 1.2
export const PET_SPEAK_MIN_RATE = 0.5
export const PET_SPEAK_MAX_RATE = 2.5

export function parsePetSpeakRate(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
  if (!Number.isFinite(n)) {
    return PET_SPEAK_DEFAULT_RATE
  }
  return Math.min(PET_SPEAK_MAX_RATE, Math.max(PET_SPEAK_MIN_RATE, Math.round(n * 100) / 100))
}
