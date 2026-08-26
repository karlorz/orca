import type { RawData, WebSocket } from 'ws'

export const RESUME_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const GRACE_TOKEN_TTL_MS = 5 * 60 * 1000
export const INVITE_TOKEN_TTL_MS = 10 * 60 * 1000
export const INVITE_MAX_ATTEMPTS = 8

export type OwnMobileRelayOperatorConfig = {
  email: string
  password: string
  userId: string
  profileId: string
  organizationId: string
}

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

export type OwnMobileRelayBufferedFrame = {
  raw: RawData
  isBinary: boolean
}

export type PendingConnRecord = {
  connId: string
  connTicket: string
  relayHostId: string
  relayDeviceId: string
  expiresAt: number
  kind: 'invite' | 'resume'
  acceptedAs?: 'current' | 'grace'
  phoneSocket: WebSocket
  hostSocket?: WebSocket
  bufferedFrames?: OwnMobileRelayBufferedFrame[]
  bufferedBytes?: number
  attachTimer?: NodeJS.Timeout
  onPhoneMessage?: (raw: RawData, isBinary: boolean) => void
}

export type OwnMobileRelayRouter = {
  invites: Map<string, OwnMobileRelayInviteRecord>
  deviceCredentials: Map<string, OwnMobileRelayDeviceCredentialRecord>
  pendingConns: Map<string, PendingConnRecord>
  connsByTicket: Map<string, PendingConnRecord>
  activeHosts: Map<string, (msg: object) => void>
}
