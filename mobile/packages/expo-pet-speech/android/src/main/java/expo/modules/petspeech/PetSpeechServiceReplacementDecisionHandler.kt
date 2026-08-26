package expo.modules.petspeech

class PetSpeechServiceReplacementDecisionHandler(
    private val onStopSelf: () -> Unit,
    private val onStopForeground: () -> Unit,
    private val onUpdateNotification: (String) -> Unit
) {
    var isSessionHeld: Boolean = false
        private set

    var heldNotificationText: String = PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT
        private set

    var activeOwnerId: Long? = null
        private set
    private var activeEventId: String? = null
    private var onOutcomeCallback: ((String, PetSpeechOutcome) -> Unit)? = null
    private var currentText: String? = null

    fun holdSession(text: String = PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT) {
        isSessionHeld = true
        heldNotificationText = text
        if (activeOwnerId == null) {
            onUpdateNotification(text)
        }
    }

    fun updateHeldNotification(text: String) {
        if (isSessionHeld) {
            heldNotificationText = text
            if (activeOwnerId == null) {
                onUpdateNotification(text)
            }
        }
    }

    fun releaseSession() {
        isSessionHeld = false
        heldNotificationText = PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT
        if (activeOwnerId != null) {
            val cb = onOutcomeCallback
            val id = activeEventId
            onOutcomeCallback = null
            activeEventId = null
            activeOwnerId = null
            currentText = null

            if (id != null && cb != null) {
                cb.invoke(id, PetSpeechOutcome.Cancelled)
            }
        }
        onStopForeground()
        onStopSelf()
    }

    fun onStartCommand(ownerId: Long, text: String?) {
        val trimmed = text?.trim()
        if (!trimmed.isNullOrEmpty()) {
            activeOwnerId = ownerId
            currentText = trimmed
            onUpdateNotification(trimmed)
        }
    }

    fun beginPlayback(
        ownerId: Long,
        eventId: String,
        text: String,
        onOutcome: (String, PetSpeechOutcome) -> Unit
    ) {
        cancelPreviousSpeechWithoutStopSelf()
        this.activeOwnerId = ownerId
        this.activeEventId = eventId
        this.currentText = text
        this.onOutcomeCallback = onOutcome
    }

    fun cancelSpeech(ownerId: Long) {
        if (activeOwnerId == ownerId) {
            val cb = onOutcomeCallback
            val id = activeEventId
            onOutcomeCallback = null
            activeEventId = null
            activeOwnerId = null
            currentText = null

            if (id != null && cb != null) {
                cb.invoke(id, PetSpeechOutcome.Cancelled)
            }

            if (isSessionHeld) {
                onUpdateNotification(heldNotificationText)
            } else {
                onStopForeground()
                onStopSelf()
            }
        }
    }

    private fun cancelPreviousSpeechWithoutStopSelf() {
        val cb = onOutcomeCallback
        val id = activeEventId
        onOutcomeCallback = null
        activeEventId = null
        if (id != null && cb != null) {
            cb.invoke(id, PetSpeechOutcome.Cancelled)
        }
    }

    fun completePlayback(
        ownerId: Long,
        outcome: PetSpeechOutcome
    ) {
        if (activeOwnerId == ownerId) {
            val cb = onOutcomeCallback
            val id = activeEventId
            onOutcomeCallback = null
            activeEventId = null
            activeOwnerId = null
            currentText = null

            if (id != null && cb != null) {
                cb.invoke(id, outcome)
            }

            if (isSessionHeld) {
                onUpdateNotification(heldNotificationText)
            } else {
                onStopForeground()
                onStopSelf()
            }
        }
    }
}
