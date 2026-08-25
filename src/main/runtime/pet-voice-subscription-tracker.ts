export type PetVoiceSubscriptionTrackerOptions = {
  onPresenceChange?: (activeCount: number) => void | Promise<void>
  initialNotification?: boolean
}

export class PetVoiceSubscriptionTracker {
  private readonly activeSubscriptions = new Set<string>()
  private readonly onPresenceChange?: (activeCount: number) => void | Promise<void>

  constructor(options?: PetVoiceSubscriptionTrackerOptions) {
    this.onPresenceChange = options?.onPresenceChange
    if (options?.initialNotification) {
      this.notify()
    }
  }

  get activeCount(): number {
    return this.activeSubscriptions.size
  }

  registerSubscription(subscriptionId: string): () => void {
    let released = false
    this.activeSubscriptions.add(subscriptionId)
    this.notify()

    return () => {
      if (released) {
        return
      }
      released = true
      this.activeSubscriptions.delete(subscriptionId)
      this.notify()
    }
  }

  private notify(): void {
    try {
      void this.onPresenceChange?.(this.activeSubscriptions.size)
    } catch (error) {
      console.error('[pet-voice-subscription-tracker] presence change error:', error)
    }
  }
}
