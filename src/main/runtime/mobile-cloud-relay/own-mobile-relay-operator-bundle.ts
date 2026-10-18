import type {
  SecurityStateRedactedAccessSession,
  SecurityStateRedactedDeviceCredential,
  SecurityStateRedactedRelayGrant
} from './own-mobile-relay-security-state'
import type { OwnMobileRelayAuditEvent } from './own-mobile-relay-audit'

export type OperatorIncidentBundleInput = {
  generatedAt: number
  hostControlLive: boolean
  sessions: SecurityStateRedactedAccessSession[]
  grants: SecurityStateRedactedRelayGrant[]
  devices: SecurityStateRedactedDeviceCredential[]
  events: OwnMobileRelayAuditEvent[]
}

export type OperatorIncidentBundle = {
  generatedAt: number
  overview: {
    ok: true
    hostControlLive: boolean
    counts: {
      sessions: number
      grants: number
      devices: number
      events: number
    }
  }
  pairing: {
    devices: SecurityStateRedactedDeviceCredential[]
    grants: SecurityStateRedactedRelayGrant[]
  }
  events: OwnMobileRelayAuditEvent[]
  markdown: string
}

export function buildOperatorIncidentMarkdown(input: OperatorIncidentBundleInput): string {
  const lines: string[] = []
  lines.push('# Own Relay Operator Incident Bundle')
  lines.push('')
  lines.push(
    `- **Generated At**: ${input.generatedAt} (${new Date(input.generatedAt).toISOString()})`
  )
  lines.push(`- **hostControlLive**: ${input.hostControlLive}`)
  lines.push('')
  lines.push('## Overview Counts')
  lines.push('')
  lines.push(`- Sessions: ${input.sessions.length}`)
  lines.push(`- Grants: ${input.grants.length}`)
  lines.push(`- Devices: ${input.devices.length}`)
  lines.push(`- Events: ${input.events.length}`)
  lines.push('')
  lines.push('## Pairing State')
  lines.push('')
  lines.push('### Devices')
  if (input.devices.length === 0) {
    lines.push('_None_')
  } else {
    for (const dev of input.devices) {
      lines.push(
        `- host: \`${dev.relayHostId}\` | device: \`${dev.relayDeviceId}\` | mode: \`${dev.authorizationMode}\` | state: \`${dev.revoked ? 'revoked' : 'active'}\``
      )
    }
  }
  lines.push('')
  lines.push('### Grants')
  if (input.grants.length === 0) {
    lines.push('_None_')
  } else {
    for (const grant of input.grants) {
      lines.push(
        `- grantId: \`${grant.grantId}\` | host: \`${grant.relayHostId}\` | expiresAt: ${grant.expiresAt}`
      )
    }
  }
  lines.push('')
  lines.push('## Audit Events')
  if (input.events.length === 0) {
    lines.push('_None_')
  } else {
    for (const event of input.events) {
      const fieldEntries = Object.entries(event.fields)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ')
      lines.push(`- [${event.at}] \`${event.type}\`${fieldEntries ? ` ${fieldEntries}` : ''}`)
    }
  }
  return lines.join('\n')
}

export function buildOperatorIncidentBundle(
  input: OperatorIncidentBundleInput
): OperatorIncidentBundle {
  return {
    generatedAt: input.generatedAt,
    overview: {
      ok: true,
      hostControlLive: input.hostControlLive,
      counts: {
        sessions: input.sessions.length,
        grants: input.grants.length,
        devices: input.devices.length,
        events: input.events.length
      }
    },
    pairing: {
      devices: input.devices,
      grants: input.grants
    },
    events: input.events,
    markdown: buildOperatorIncidentMarkdown(input)
  }
}
