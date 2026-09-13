package expo.modules.petspeech

object PetSpeechReleaseAftermathDecision {
    enum class Reason {
        PAUSE,
        MASTER_OFF,
        JS_RELEASE
    }

    enum class Aftermath {
        POST_RESUME_CHIP,
        CANCEL_ALL
    }

    fun decide(reason: Reason): Aftermath {
        return when (reason) {
            Reason.PAUSE -> Aftermath.POST_RESUME_CHIP
            Reason.MASTER_OFF, Reason.JS_RELEASE -> Aftermath.CANCEL_ALL
        }
    }
}
