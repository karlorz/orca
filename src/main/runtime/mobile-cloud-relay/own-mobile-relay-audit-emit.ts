import type { OwnMobileRelayAuditEvent, OwnMobileRelayAuditLog } from './own-mobile-relay-audit'

export async function emitAudit(
  auditLog: OwnMobileRelayAuditLog | undefined,
  type: string,
  fields: OwnMobileRelayAuditEvent['fields']
): Promise<void> {
  if (!auditLog) {
    return
  }
  try {
    await auditLog.append({
      at: Date.now(),
      type,
      fields
    })
  } catch {
    // Best-effort audit logging
  }
}
