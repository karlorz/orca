export const RESUME_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const GRACE_TOKEN_TTL_MS = 5 * 60 * 1000
export const INVITE_TOKEN_TTL_MS = 10 * 60 * 1000
export const INVITE_MAX_ATTEMPTS = 8

export type OwnMobileRelayInviteRecord = {
  inviteToken: string
  relayHostId: string
  relayDeviceId: string
  expiresAt: number
  remainingAttempts: number
}

export type OwnMobileRelayDeviceCredentialRecord = {
  relayHostId: string
  relayDeviceId: string
  lastInstallReqId: string
  currentResumeTokenHash: string
  currentVersion: number
  resumeExpiresAt: number
  authorizationMode: 'relay-basis' | 'authenticated-direct'
  graceResumeTokenHash?: string
  graceExpiresAt?: number
}
