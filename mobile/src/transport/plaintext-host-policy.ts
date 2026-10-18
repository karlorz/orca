// Why this lives in JS and not only in Android's network_security_config: that file grants
// cleartext by DOMAIN (<domain>), not by IP range, so "cleartext only to RFC1918 / loopback /
// link-local" cannot be expressed there. The config plugin
// (plugins/android-network-security-config.js) lists the fixed dev hosts it can name; this check is
// what narrows a plain ws:// address typed in Edit host to hosts that cannot be on the internet.

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function isPrivateIpv4(host: string): boolean {
  const match = IPV4.exec(host)
  if (!match) {
    return false
  }
  const [a, b] = match.slice(1, 3).map(Number)
  return (
    a === 10 || // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    a === 127 || // 127.0.0.0/8 loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local
    (a === 100 && b >= 64 && b <= 127) // 100.64.0.0/10 CGNAT: Tailscale addresses (WireGuard-encrypted)
  )
}

// IPv6 counterparts of the same classes: loopback ::1, link-local fe80::/10, unique-local fc00::/7.
function isPrivateIpv6(host: string): boolean {
  const lower = host.toLowerCase()
  if (lower === '::1') {
    return true
  }
  const firstGroup = lower.split(':')[0]
  if (!/^[0-9a-f]{1,4}$/.test(firstGroup)) {
    return false
  }
  const value = Number.parseInt(firstGroup, 16)
  return (value & 0xffc0) === 0xfe80 || (value & 0xfe00) === 0xfc00
}

/** True when a plaintext (ws://) connection to `hostname` stays on the local network. */
export function isLocalPlaintextHost(hostname: string): boolean {
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (host.includes(':')) {
    return isPrivateIpv6(host)
  }
  const lower = host.toLowerCase().replace(/\.$/, '')
  return (
    lower === 'localhost' ||
    lower.endsWith('.local') ||
    // Tailscale MagicDNS names; the tunnel is WireGuard-encrypted, so ws:// inside it is safe.
    lower.endsWith('.ts.net') ||
    isPrivateIpv4(lower)
  )
}

export const PLAINTEXT_HOST_ERROR =
  'ws:// is only allowed for LAN (10.x, 172.16–31.x, 192.168.x), Tailscale (100.64–127.x, *.ts.net), loopback, link-local or .local hosts. Use wss:// for anything else.'

export const PLAINTEXT_BARE_HOST_ERROR =
  'A bare hostname is not allowed over ws://. Use wss:// or the full name (for example desk.local or desk.your-tailnet.ts.net).'

/** Null when a plaintext (ws://) connection to `hostname` is allowed, else the message to show. */
export function plaintextHostError(hostname: string): string | null {
  if (isLocalPlaintextHost(hostname)) {
    return null
  }
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  // `localhost` is allowed above; any other dotless, colonless name is a bare hostname.
  return !host.includes('.') && !host.includes(':')
    ? PLAINTEXT_BARE_HOST_ERROR
    : PLAINTEXT_HOST_ERROR
}
