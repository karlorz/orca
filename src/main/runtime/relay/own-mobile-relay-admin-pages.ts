import { PASSWORD_PAGE_HEADERS } from './own-mobile-relay-password-page'

export const ADMIN_PAGE_HEADERS = { ...PASSWORD_PAGE_HEADERS }

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:sans-serif;margin:24px;color:#0f172a}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:6px 8px;font-size:13px}a{color:#1d4ed8}nav{margin-bottom:16px}pre{background:#f1f5f9;padding:12px;border:1px solid #cbd5e1;border-radius:4px;overflow-x:auto}</style>
</head><body>
<nav><a href="/admin">Overview</a> · <a href="/admin/events">Events</a> · <a href="/admin/pairing">Pairing</a> · <a href="/admin/incident">Incident</a>
<form method="post" action="/admin/logout" style="display:inline"><button type="submit">Logout</button></form></nav>
${body}</body></html>`
}

export function renderAdminLogin(error?: string): string {
  const err = error ? `<p role="alert">${escapeHtml(error)}</p>` : ''
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Relay operator login</title>
<style>body{font-family:sans-serif;margin:24px}</style></head><body>
<h1>Relay operator login</h1>${err}
<form method="post" action="/admin/login">
<label>Email <input type="email" name="email" required></label>
<label>Password <input type="password" name="password" required></label>
<button type="submit">Sign in</button>
</form></body></html>`
}

export function renderAdminOverview(input: {
  hostControlLive: boolean
  sessions: number
  grants: number
  devices: number
  events: number
}): string {
  return layout(
    'Relay operator overview',
    `<h1>Overview</h1>
<p>hostControlLive=${input.hostControlLive ? 'true' : 'false'}</p>
<ul>
<li>sessions: ${input.sessions}</li>
<li>grants: ${input.grants}</li>
<li>devices: ${input.devices}</li>
<li>events: ${input.events}</li>
</ul>`
  )
}

export function renderAdminEvents(
  events: { at: number; type: string; fields: Record<string, string | number | boolean | null> }[]
): string {
  const rows = events
    .map(
      (event) =>
        `<tr><td>${event.at}</td><td>${escapeHtml(event.type)}</td><td>${escapeHtml(JSON.stringify(event.fields))}</td></tr>`
    )
    .join('')
  return layout(
    'Relay operator events',
    `<h1>Events</h1><table><tr><th>at</th><th>type</th><th>fields</th></tr>${rows}</table>`
  )
}

export function renderAdminPairing(input: {
  devices: { relayHostId: string; relayDeviceId: string; revoked?: boolean | null; keyExpiryDisabled?: boolean }[]
  grants: { grantId: string; relayHostId: string; keyExpiryDisabled?: boolean }[]
}): string {
  const devices = input.devices
    .map(
      (device) => {
        const expiryDisabled = device.keyExpiryDisabled ?? true
        const expiryBadge = expiryDisabled ? ' <span style="background:#dcfce7;color:#166534;padding:2px 6px;border-radius:4px;font-size:11px">Expiry disabled</span>' : ''
        const toggleLabel = expiryDisabled ? 'Enable key expiry' : 'Disable key expiry'
        const toggleDisabledVal = expiryDisabled ? 'false' : 'true'
        return `<tr><td>${escapeHtml(device.relayHostId)}</td><td>${escapeHtml(device.relayDeviceId)}${expiryBadge}</td><td>${device.revoked ? 'revoked' : 'active'}</td>
<td>
<form method="post" action="/admin/pairing/devices/${encodeURIComponent(device.relayHostId)}/${encodeURIComponent(device.relayDeviceId)}/key-expiry" style="display:inline"><input type="hidden" name="disabled" value="${toggleDisabledVal}"><button type="submit">${toggleLabel}</button></form>
<form method="post" action="/admin/pairing/devices/${encodeURIComponent(device.relayHostId)}/${encodeURIComponent(device.relayDeviceId)}/revoke" style="display:inline"><button type="submit">Revoke</button></form>
</td></tr>`
      }
    )
    .join('')
  const grants = input.grants
    .map(
      (grant) => {
        const expiryDisabled = grant.keyExpiryDisabled ?? true
        const expiryBadge = expiryDisabled ? ' <span style="background:#dcfce7;color:#166534;padding:2px 6px;border-radius:4px;font-size:11px">Expiry disabled</span>' : ''
        const toggleLabel = expiryDisabled ? 'Enable key expiry' : 'Disable key expiry'
        const toggleDisabledVal = expiryDisabled ? 'false' : 'true'
        return `<tr><td>${escapeHtml(grant.grantId)}</td><td>${escapeHtml(grant.relayHostId)}${expiryBadge}</td>
<td>
<form method="post" action="/admin/pairing/hosts/${encodeURIComponent(grant.relayHostId)}/key-expiry" style="display:inline"><input type="hidden" name="disabled" value="${toggleDisabledVal}"><button type="submit">${toggleLabel}</button></form>
<form method="post" action="/admin/pairing/grants/${encodeURIComponent(grant.grantId)}/revoke" style="display:inline"><button type="submit">Revoke</button></form>
</td></tr>`
      }
    )
    .join('')
  return layout(
    'Relay operator pairing',
    `<h1>Pairing</h1>
<h2>Devices</h2><table><tr><th>host</th><th>device</th><th>state</th><th></th></tr>${devices}</table>
<h2>Grants</h2><table><tr><th>grant</th><th>host</th><th></th></tr>${grants}</table>`
  )
}

export function renderAdminIncident(input: { markdown: string; jsonText?: string }): string {
  const jsonSection = input.jsonText
    ? `<h2>JSON</h2><pre><code>${escapeHtml(input.jsonText)}</code></pre>`
    : ''
  return layout(
    'Relay operator incident bundle',
    `<h1>Incident Bundle</h1>
<h2>Markdown (for wiki issue)</h2>
<pre><code>${escapeHtml(input.markdown)}</code></pre>
${jsonSection}`
  )
}
