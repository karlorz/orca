import {
  deleteHostPageCache,
  forgetHostUpdateFailures
} from '../mobile-web-shell/removed-host-shell-cache'
import {
  clearWatermark,
  forgetHostNotificationSession
} from '../notifications/notification-reconnect-catchup'
import { unregisterPushForRemovedHost } from '../notifications/push-registration'
import { clearPetSpeakWatermark } from '../pet-speak/pet-speak-watermark'
import { forgetHostDescriptor } from './host-descriptor-store'
import { removeHost } from './host-store'

export async function removeHostAndCloseClient(
  hostId: string,
  forgetHostClient: (hostId: string) => void
): Promise<void> {
  // Unregister before removal while the client is authenticated; desktop revocation covers undelivered requests.
  const restorePushRegistration = await unregisterPushForRemovedHost(hostId)
  // Close only after metadata commits so storage failure cannot strand a still-paired host.
  try {
    await removeHost(hostId)
  } catch (error) {
    restorePushRegistration()
    throw error
  }
  forgetHostClient(hostId)
  forgetHostDescriptor(hostId)
  // Why: the notification session outlives the socket by design (it must survive
  // reconnects), so removal is the only thing that can retire it. Left behind, a
  // re-pair of the same host would inherit a watermark for a counter it never saw.
  forgetHostNotificationSession(hostId)
  void clearWatermark(hostId)
  void clearPetSpeakWatermark(hostId)
  // Why after the commit and not awaited: state about a host that is gone, never a reason to hold
  // the removal or fail it. A cache that fails to delete is reclaimed by the next eviction.
  void forgetHostUpdateFailures(hostId).catch(() => undefined)
  void deleteHostPageCache(hostId).catch(() => undefined)
}
