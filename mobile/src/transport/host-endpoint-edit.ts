import {
  displayHostEndpoint,
  endpointPort,
  endpointScheme,
  normalizeHostEndpoint
} from './host-endpoint'
import { plaintextHostError } from './plaintext-host-policy'

export type HostEndpointEditResolution =
  | { kind: 'unchanged'; endpoint: string }
  | { kind: 'changed'; endpoint: string }
  | { kind: 'invalid'; error: string }

export function resolveHostEndpointEdit(
  storedEndpoint: string,
  input: string
): HostEndpointEditResolution {
  const displayedEndpoint = displayHostEndpoint(storedEndpoint)
  if (input.trim() === displayedEndpoint) {
    return { kind: 'unchanged', endpoint: storedEndpoint }
  }

  const fallbackScheme = endpointScheme(storedEndpoint)
  const fallbackPort =
    endpointPort(storedEndpoint) ?? (fallbackScheme === 'wss' ? '443' : undefined)
  const options = { fallbackPort, fallbackScheme }
  const normalizedInput = normalizeHostEndpoint(input, options)
  if (!normalizedInput.ok) {
    return { kind: 'invalid', error: normalizedInput.error }
  }

  const normalizedDisplay = normalizeHostEndpoint(displayedEndpoint, options)
  if (
    sameEndpointAuthority(normalizedInput.endpoint, storedEndpoint) ||
    (normalizedDisplay.ok &&
      sameEndpointAuthority(normalizedInput.endpoint, normalizedDisplay.endpoint))
  ) {
    return { kind: 'unchanged', endpoint: storedEndpoint }
  }

  // Only a new address is held to the plaintext rule: an untouched stored endpoint (paired by the
  // desktop) is returned above as unchanged, so editing just the name never locks a host out.
  // This JS check IS the enforcement point for the private-range rule: Android's
  // network_security_config matches cleartext by domain, not IP range, so RFC1918 / 100.64/10 /
  // link-local cannot be expressed there and its base-config must stay permissive for LAN pairing
  // (see plugins/android-network-security-config.js and plaintext-host-policy.ts).
  const plaintextError = plaintextEndpointError(normalizedInput.endpoint)
  if (plaintextError) {
    return { kind: 'invalid', error: plaintextError }
  }

  return {
    kind: 'changed',
    endpoint: normalizedInput.endpoint + endpointRouteSuffix(storedEndpoint)
  }
}

function sameEndpointAuthority(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}

function endpointRouteSuffix(endpoint: string): string {
  const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*(.*)$/.exec(endpoint)
  return match?.[1] ?? ''
}

function plaintextEndpointError(endpoint: string): string | null {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'ws:' ? plaintextHostError(url.hostname) : null
  } catch {
    return 'Not a valid address.'
  }
}
