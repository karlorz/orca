package expo.modules.petspeech

object PetSpeechVisibilityHoldDecision {
    const val ACTION_SCREEN_OFF = "android.intent.action.SCREEN_OFF"
    const val ACTION_USER_PRESENT = "android.intent.action.USER_PRESENT"
    const val ACTION_CLOSE_SYSTEM_DIALOGS = "android.intent.action.CLOSE_SYSTEM_DIALOGS"

    enum class Event {
        HOME,
        SCREEN_OFF,
        LOCK
    }

    data class Result(
        val keepHold: Boolean,
        val releaseSession: Boolean,
        val startForeground: Boolean,
        val startForegroundFromReceiver: Boolean,
        val fgsIsMediaStyle: Boolean,
        val startTts: Boolean
    )

    fun isVisibilityAction(action: String?): Boolean {
        return action == ACTION_SCREEN_OFF ||
            action == ACTION_USER_PRESENT ||
            action == ACTION_CLOSE_SYSTEM_DIALOGS
    }

    fun eventFromAction(action: String?): Event? {
        return when (action) {
            ACTION_SCREEN_OFF -> Event.SCREEN_OFF
            ACTION_USER_PRESENT -> Event.LOCK
            ACTION_CLOSE_SYSTEM_DIALOGS -> Event.HOME
            else -> null
        }
    }

    fun persistOffVisibilityEvents(): List<Event> {
        return listOf(Event.HOME, Event.SCREEN_OFF, Event.LOCK)
    }

    fun persistOnKeepHostVisibilityEvents(): List<Event> {
        return listOf(Event.SCREEN_OFF, Event.LOCK)
    }

    fun persistOffOverlayVisibilityEvents(): List<Event> {
        return listOf(Event.LOCK, Event.SCREEN_OFF)
    }

    fun keepWhenNoHostNeverStartsForeground(keepWhenNoHost: Boolean): Boolean {
        return false && keepWhenNoHost
    }

    fun overlayNeverStartsForeground(overlayWhileSpeaking: Boolean): Boolean {
        return overlayWhileSpeaking && PetSpeechOverlayPermissionDecision.mayStartOrHoldForeground()
    }

    fun applyAction(
        action: String?,
        persistEnabled: Boolean,
        masterEnabled: Boolean,
        sessionHeld: Boolean,
        keepWhenNoHost: Boolean = false,
        overlayWhileSpeaking: Boolean = false
    ): Result? {
        val event = eventFromAction(action) ?: return null
        return decide(
            event,
            persistEnabled,
            masterEnabled,
            sessionHeld,
            keepWhenNoHost,
            overlayWhileSpeaking
        )
    }

    fun mayStartMediaPlaybackFromVisibilityReceiver(): Boolean {
        return false
    }

    fun decide(
        @Suppress("UNUSED_PARAMETER") event: Event,
        @Suppress("UNUSED_PARAMETER") persistEnabled: Boolean,
        masterEnabled: Boolean,
        sessionHeld: Boolean,
        keepWhenNoHost: Boolean = false,
        overlayWhileSpeaking: Boolean = false
    ): Result {
        val keep = masterEnabled && sessionHeld
        val startFgs = keepWhenNoHostNeverStartsForeground(keepWhenNoHost) ||
            overlayNeverStartsForeground(overlayWhileSpeaking)
        return Result(
            keepHold = keep,
            releaseSession = sessionHeld && !masterEnabled,
            startForeground = startFgs,
            startForegroundFromReceiver = startFgs,
            fgsIsMediaStyle = keep,
            startTts = false
        )
    }

    fun notificationPlan(keepHold: Boolean, showServiceRow: Boolean): PetSpeechNotificationSetDecision.Plan {
        return if (keepHold) {
            PetSpeechNotificationSetDecision.whileHeld(showServiceRow)
        } else {
            PetSpeechNotificationSetDecision.afterMasterOff()
        }
    }

    fun mediaActionsWhileHeld(keepHold: Boolean): Long {
        return if (keepHold) {
            PetSpeechMediaHoldDecision.playbackActions()
        } else {
            0L
        }
    }
}
