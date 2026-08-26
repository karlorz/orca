/**
 * Fork-main overlay for a self-hosted Mobile Relay (sg01 + own auth).
 *
 * Leave `enabled` false until the HTTPS origins exist. Packaged GUI launches
 * do not inherit shell env, so flipping this (or passing the overlay into
 * getOrcaCloudAuthConfig) is what points Sign in for Relay at our director.
 * Env still wins over the overlay so Stably can be restored.
 *
 * Deploy target: fleet host sg01. Fill origins when TLS DNS is live.
 */
export type ForkOwnRelayDefaults = {
  enabled: boolean
  apiBaseUrl: string
  relayDirectorUrl: string
  clientId: string
}

export const FORK_OWN_MOBILE_RELAY: ForkOwnRelayDefaults = {
  enabled: false,
  apiBaseUrl: '',
  relayDirectorUrl: '',
  clientId: 'orca-desktop'
}
