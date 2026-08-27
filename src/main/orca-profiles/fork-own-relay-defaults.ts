/**
 * Fork-main overlay for a self-hosted Mobile Relay (sg01 + own auth).
 *
 * Enabled because TLS DNS and services on sg01 are live. Packaged GUI launches
 * do not inherit shell env, so this points Sign in for Relay at our director.
 * Env still wins over the overlay so Stably can be restored.
 *
 * Deploy target: fleet host sg01.
 */
export type ForkOwnRelayDefaults = {
  enabled: boolean
  apiBaseUrl: string
  relayDirectorUrl: string
  clientId: string
}

export const FORK_OWN_MOBILE_RELAY: ForkOwnRelayDefaults = {
  enabled: true,
  apiBaseUrl: 'https://orca-auth.karldigi.dev',
  relayDirectorUrl: 'https://orca-relay.karldigi.dev',
  clientId: 'orca-desktop'
}
