package expo.modules.petspeech

class PetSpeechServiceReplacementDecisionHandler(
    private val onStopSelf: () -> Unit,
    private val onStopForeground: () -> Unit,
    private val onUpdateNotification: (String) -> Unit
) {
    var isSessionHeld: Boolean = false
        private set

    var activeOwnerId: Long? = null
        private set
    private var activeEventId: String? = null
    private var onOutcomeCallback: ((String, PetSpeechOutcome) -> Unit)? = null
    private var currentText: String? = null

    fun holdSession() {
        isSessionHeld = true
        if (activeOwnerId == null) {
            onUpdateNotification(PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT)
        }
    }

    fun releaseSession() {
        isSessionHeld = false
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
                onUpdateNotification(PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT)
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
                onUpdateNotification(PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT)
            } else {
                onStopForeground()
                onStopSelf()
            }
        }
    }
}
