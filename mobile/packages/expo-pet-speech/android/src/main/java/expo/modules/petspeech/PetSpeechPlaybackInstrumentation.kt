package expo.modules.petspeech

data class PetSpeechPlaybackMetrics(
    val eventId: String,
    val playerImplementation: String,
    val selectedRate: Float,
    val synthesisCompletedAtMs: Long = 0L,
    val playerStartedAtMs: Long = 0L,
    val playerCompletedAtMs: Long = 0L,
    val durationMs: Long = -1L,
    val outcome: PetSpeechOutcome? = null,
    val failureReason: String? = null
)

interface PetSpeechPlaybackObserver {
    fun onSynthesisCompleted(eventId: String, timestampMs: Long)
    fun onPlayerStarted(eventId: String, playerImplementation: String, selectedRate: Float, timestampMs: Long)
    fun onPlayerCompleted(eventId: String, durationMs: Long, timestampMs: Long)
    fun onPlayerFailed(eventId: String, failureReason: String, timestampMs: Long)
}

object PetSpeechPlaybackInstrumentation {
    private val lock = Any()
    private val listeners = mutableListOf<PetSpeechPlaybackObserver>()
    private var lastRecordedMetrics: PetSpeechPlaybackMetrics? = null

    fun addObserver(observer: PetSpeechPlaybackObserver) {
        synchronized(lock) {
            listeners.add(observer)
        }
    }

    fun removeObserver(observer: PetSpeechPlaybackObserver) {
        synchronized(lock) {
            listeners.remove(observer)
        }
    }

    fun clearObservers() {
        synchronized(lock) {
            listeners.clear()
            lastRecordedMetrics = null
        }
    }

    val lastMetrics: PetSpeechPlaybackMetrics?
        get() = synchronized(lock) { lastRecordedMetrics }

    fun recordSynthesisCompleted(eventId: String, timestampMs: Long = System.currentTimeMillis()) {
        synchronized(lock) {
            val current = lastRecordedMetrics
            lastRecordedMetrics = if (current?.eventId == eventId) {
                current.copy(synthesisCompletedAtMs = timestampMs)
            } else {
                PetSpeechPlaybackMetrics(
                    eventId = eventId,
                    playerImplementation = "",
                    selectedRate = 1.0f,
                    synthesisCompletedAtMs = timestampMs
                )
            }
            listeners.toList().forEach { it.onSynthesisCompleted(eventId, timestampMs) }
        }
    }

    fun recordPlayerStarted(
        eventId: String,
        playerImplementation: String,
        selectedRate: Float,
        timestampMs: Long = System.currentTimeMillis()
    ) {
        synchronized(lock) {
            val current = lastRecordedMetrics
            lastRecordedMetrics = if (current?.eventId == eventId) {
                current.copy(
                    playerImplementation = playerImplementation,
                    selectedRate = selectedRate,
                    playerStartedAtMs = timestampMs
                )
            } else {
                PetSpeechPlaybackMetrics(
                    eventId = eventId,
                    playerImplementation = playerImplementation,
                    selectedRate = selectedRate,
                    playerStartedAtMs = timestampMs
                )
            }
            listeners.toList().forEach { it.onPlayerStarted(eventId, playerImplementation, selectedRate, timestampMs) }
        }
    }

    fun recordPlayerCompleted(
        eventId: String,
        durationMs: Long,
        timestampMs: Long = System.currentTimeMillis()
    ) {
        synchronized(lock) {
            val current = lastRecordedMetrics
            lastRecordedMetrics = if (current?.eventId == eventId) {
                current.copy(
                    playerCompletedAtMs = timestampMs,
                    durationMs = durationMs,
                    outcome = PetSpeechOutcome.Spoken
                )
            } else {
                PetSpeechPlaybackMetrics(
                    eventId = eventId,
                    playerImplementation = "",
                    selectedRate = 1.0f,
                    playerCompletedAtMs = timestampMs,
                    durationMs = durationMs,
                    outcome = PetSpeechOutcome.Spoken
                )
            }
            listeners.toList().forEach { it.onPlayerCompleted(eventId, durationMs, timestampMs) }
        }
    }

    fun recordPlayerFailed(
        eventId: String,
        failureReason: String,
        timestampMs: Long = System.currentTimeMillis()
    ) {
        synchronized(lock) {
            val current = lastRecordedMetrics
            lastRecordedMetrics = if (current?.eventId == eventId) {
                current.copy(
                    failureReason = failureReason,
                    outcome = PetSpeechOutcome.PlaybackError
                )
            } else {
                PetSpeechPlaybackMetrics(
                    eventId = eventId,
                    playerImplementation = "",
                    selectedRate = 1.0f,
                    failureReason = failureReason,
                    outcome = PetSpeechOutcome.PlaybackError
                )
            }
            listeners.toList().forEach { it.onPlayerFailed(eventId, failureReason, timestampMs) }
        }
    }
}
