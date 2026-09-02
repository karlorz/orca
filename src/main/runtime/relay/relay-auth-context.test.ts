import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaCloudAuthConfig } from '../../orca-profiles/profile-cloud-auth-config'
import type { ActiveOrcaProfileState } from '../../orca-profiles/profile-index-store'
import type { OrcaCloudSession } from '../../orca-profiles/profile-cloud-session-store'

const fakes = vi.hoisted(() => ({
  ensureActiveOrcaProfile: vi.fn(),
  readFreshOrcaCloudSession: vi.fn(),
  forceRefreshOrcaCloudSession: vi.fn(),
  readOrcaCloudSession: vi.fn()
}))

vi.mock('../../orca-profiles/profile-index-store', () => ({
  ensureActiveOrcaProfile: fakes.ensureActiveOrcaProfile
}))

vi.mock('../../orca-profiles/profile-cloud-session-refresh', () => ({
  readFreshOrcaCloudSession: fakes.readFreshOrcaCloudSession,
  forceRefreshOrcaCloudSession: fakes.forceRefreshOrcaCloudSession
}))

vi.mock('../../orca-profiles/profile-cloud-session-store', () => ({
  readOrcaCloudSession: fakes.readOrcaCloudSession
}))

import { readRelayAuthContext } from './relay-auth-context'

const authConfig = {
  relayDirectorUrl: 'https://relay.example.test',
  relayTokenEndpoint: 'https://login.example.test/relay-token'
} as OrcaCloudAuthConfig
const userDataPath = '/tmp/test-user-data'

const sampleActiveProfile: ActiveOrcaProfileState = {
  index: {
    schemaVersion: 1,
    activeProfileId: 'profile-1',
    profiles: []
  },
  profile: {
    id: 'profile-1',
    name: 'Profile 1',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    kind: 'local',
    avatar: { kind: 'initials', initials: 'P', color: 'neutral' },
    cloud: {
      userId: 'user-1',
      email: 'user-1@example.test',
      cloudProfileId: 'cloud-profile-1',
      activeOrgId: 'org-1',
      linkedAt: 1
    }
  },
  dataFile: '/tmp/test-user-data/profile-1.json',
  profileDirectory: '/tmp/test-user-data/profile-1'
}

const sampleSession: OrcaCloudSession = {
  accessToken: 'access-token-1',
  refreshToken: 'refresh-token-1',
  expiresAt: Date.now() + 3_600_000,
  capabilities: { flags: { 'relay.use': true }, refreshedAt: Date.now() }
}

describe('readRelayAuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses lazy readFresh by default', async () => {
    fakes.ensureActiveOrcaProfile.mockReturnValue(sampleActiveProfile)
    fakes.readFreshOrcaCloudSession.mockResolvedValue({
      status: 'found',
      session: sampleSession
    })

    const context = await readRelayAuthContext(authConfig, userDataPath)

    expect(fakes.readFreshOrcaCloudSession).toHaveBeenCalledWith(
      authConfig,
      sampleActiveProfile,
      userDataPath
    )
    expect(fakes.forceRefreshOrcaCloudSession).not.toHaveBeenCalled()
    expect(context).toEqual({
      identity: {
        userId: 'user-1',
        profileId: 'cloud-profile-1',
        organizationId: 'org-1'
      },
      accessToken: 'access-token-1',
      relayEntitled: true
    })
  })

  it('uses forceRefreshOrcaCloudSession when forceRefresh is true', async () => {
    fakes.ensureActiveOrcaProfile.mockReturnValue(sampleActiveProfile)
    const storedSession: OrcaCloudSession = {
      accessToken: 'old-access-token',
      refreshToken: 'refresh-token-1',
      expiresAt: Date.now() + 60_000, // <= 120s leftover
      capabilities: { flags: { 'relay.use': true }, refreshedAt: Date.now() }
    }
    const refreshedSession: OrcaCloudSession = {
      accessToken: 'rotated-access-token',
      refreshToken: 'refresh-token-2',
      expiresAt: Date.now() + 3_600_000, // full TTL
      capabilities: { flags: { 'relay.use': true }, refreshedAt: Date.now() }
    }
    fakes.readOrcaCloudSession.mockReturnValue({
      status: 'found',
      session: storedSession
    })
    fakes.forceRefreshOrcaCloudSession.mockResolvedValue({
      status: 'found',
      session: refreshedSession
    })

    const context = await readRelayAuthContext(authConfig, userDataPath, { forceRefresh: true })

    expect(fakes.readFreshOrcaCloudSession).not.toHaveBeenCalled()
    expect(fakes.readOrcaCloudSession).toHaveBeenCalledWith('profile-1', userDataPath)
    expect(fakes.forceRefreshOrcaCloudSession).toHaveBeenCalledWith(
      authConfig,
      sampleActiveProfile,
      userDataPath,
      storedSession
    )
    expect(context).toEqual({
      identity: {
        userId: 'user-1',
        profileId: 'cloud-profile-1',
        organizationId: 'org-1'
      },
      accessToken: 'rotated-access-token',
      relayEntitled: true
    })
  })

  it('returns null when forceRefresh finds no stored session', async () => {
    fakes.ensureActiveOrcaProfile.mockReturnValue(sampleActiveProfile)
    fakes.readOrcaCloudSession.mockReturnValue({ status: 'missing' })

    const context = await readRelayAuthContext(authConfig, userDataPath, { forceRefresh: true })

    expect(context).toBeNull()
    expect(fakes.forceRefreshOrcaCloudSession).not.toHaveBeenCalled()
  })

  it('returns null when forceRefresh returns reconnect-required', async () => {
    fakes.ensureActiveOrcaProfile.mockReturnValue(sampleActiveProfile)
    fakes.readOrcaCloudSession.mockReturnValue({
      status: 'found',
      session: sampleSession
    })
    fakes.forceRefreshOrcaCloudSession.mockResolvedValue({
      status: 'reconnect-required'
    })

    const context = await readRelayAuthContext(authConfig, userDataPath, { forceRefresh: true })

    expect(context).toBeNull()
  })
})
