import type { PasswordRecord } from './own-mobile-relay-password'

export type InternalAccountRecord = {
  accountId: string
  email: string
  userId: string
  profileId: string
  organizationId: string
  verifierVersion: number
  authEpoch: number
  passwordRecord: PasswordRecord
  createdAt: number
  updatedAt: number
}

export type InternalSessionRecord = {
  sessionId: string
  accountId: string
  authEpoch: number
  accessTokenHash: string
  expiresAt: number
  createdAt: number
  revokedAt?: number
  identity: {
    userId: string
    profileId: string
    organizationId: string
    email: string
    cloudProfileId: string
  }
}

export type InternalGrantRecord = {
  grantId: string
  accountId: string
  parentSessionId: string
  relayTokenHash: string
  relayHostId: string
  hostPublicKeyB64: string
  authEpoch: number
  expiresAt: number
  createdAt: number
  revokedAt?: number
  identity: {
    userId: string
    profileId: string
    organizationId: string
  }
}

export type InternalDeviceRecord = {
  relayHostId: string
  relayDeviceId: string
  lastInstallReqId: string
  currentResumeTokenHash: string
  currentVersion: number
  resumeExpiresAt: number
  authorizationMode: 'relay-basis' | 'authenticated-direct'
  graceResumeTokenHash?: string
  graceExpiresAt?: number
  revokedAt?: number
}

export type InternalOperatorSessionRecord = {
  sessionId: string
  accountId: string
  tokenHash: string
  authEpoch: number
  expiresAt: number
  createdAt: number
  revokedAt?: number
}
