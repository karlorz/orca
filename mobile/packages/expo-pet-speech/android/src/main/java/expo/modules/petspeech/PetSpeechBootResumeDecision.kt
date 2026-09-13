package expo.modules.petspeech

object PetSpeechBootResumeDecision {
    data class Result(
        val postResumeNotification: Boolean,
        val startForeground: Boolean
    )

    fun decide(persistEnabled: Boolean, masterEnabled: Boolean): Result {
        return Result(
            postResumeNotification = persistEnabled && masterEnabled,
            startForeground = false
        )
    }
}
