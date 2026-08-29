export type PetSpeechAvailability = 'available' | 'disabled' | 'unavailable'

export type PetSpeechDeviceStatus = {
  installUuid: string
  modelName: string
  enabled: boolean
  availability: PetSpeechAvailability
  activeEngine?: string
  supportedLanguages?: string[]
  currentLanguage?: string
  selectedVoice?: string
  rate?: number
  lastOutcome?: string
  updatedAt?: number
  connected?: boolean
}

export type PetSpeechStatusReport = PetSpeechDeviceStatus & {
  connectionId?: string
}

export class PetSpeechDeviceRegistry {
  private readonly rows = new Map<string, PetSpeechStatusReport>()

  /**
   * Updates or inserts a device status report bound to a connection.
   */
  reportStatus(status: PetSpeechDeviceStatus, connectionId?: string): void {
    const installUuid = status.installUuid.trim()
    if (!installUuid) {
      return
    }

    const now = status.updatedAt ?? Date.now()
    const existing = this.rows.get(installUuid)
    const isDisabled = !status.enabled || status.availability === 'disabled'

    const next: PetSpeechStatusReport = {
      ...existing,
      ...status,
      installUuid,
      modelName: status.modelName.trim(),
      enabled: status.enabled,
      availability: status.availability,
      connected: true,
      updatedAt: now,
      connectionId: connectionId ?? existing?.connectionId
    }

    // Disabled reports must not keep leftover live presentation fields.
    if (isDisabled) {
      delete next.activeEngine
      delete next.supportedLanguages
      delete next.currentLanguage
      delete next.selectedVoice
      delete next.rate
      delete next.lastOutcome
    }

    this.rows.set(installUuid, next)
  }

  /**
   * Handles connection disconnect/unsubscribe: marks connection-scoped rows as disconnected.
   * If an installUuid was replaced by a newer connectionId, stale cleanup is safely ignored.
   */
  cleanupConnection(connectionId: string): void {
    if (!connectionId) {
      return
    }
    for (const [uuid, row] of this.rows.entries()) {
      if (row.connectionId === connectionId) {
        this.rows.set(uuid, {
          ...row,
          connected: false,
          updatedAt: Date.now()
        })
      }
    }
  }

  /**
   * Returns a snapshot of all registered devices.
   */
  getAllStatuses(): PetSpeechStatusReport[] {
    return Array.from(this.rows.values()).map((r) => ({ ...r }))
  }

  /**
   * Retrieves a specific device status by installUuid.
   */
  getStatus(installUuid: string): PetSpeechStatusReport | undefined {
    const row = this.rows.get(installUuid.trim())
    return row ? { ...row } : undefined
  }

  /**
   * Clears all status rows.
   */
  clear(): void {
    this.rows.clear()
  }
}
