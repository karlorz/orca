package expo.modules.petspeech

object PetSpeechHoldCommandDecision {
    const val ACTION_HOLD_SESSION = "expo.modules.petspeech.ACTION_HOLD_SESSION"
    const val ACTION_RESUME_FROM_CHIP = "expo.modules.petspeech.ACTION_RESUME_FROM_CHIP"
    const val EXTRA_HOLD_SOURCE = "extra_pet_speech_hold_source"

    enum class Source {
        RESUME_CHIP,
        MEDIA_PLAY_AFTER_PAUSE,
        JS_HOLD
    }

    data class Result(
        val serviceAction: String?,
        val reacquireHold: Boolean,
        val startTts: Boolean
    )

    fun decide(
        source: Source,
        persistEnabled: Boolean = true,
        masterEnabled: Boolean = true,
        keepWhenNoHost: Boolean = false,
        overlayWhileSpeaking: Boolean = false,
        afterKeepHoldPause: Boolean = false
    ): Result {
        val tapSource = source == Source.RESUME_CHIP || source == Source.MEDIA_PLAY_AFTER_PAUSE
        if (!masterEnabled || (tapSource && !persistEnabled)) {
            return Result(
                serviceAction = null,
                reacquireHold = false,
                startTts = false
            )
        }
        val startTts = !afterKeepHoldPauseDoesNotStartTts(
            keepWhenNoHost,
            overlayWhileSpeaking,
            afterKeepHoldPause
        )
        return Result(
            serviceAction = ACTION_HOLD_SESSION,
            reacquireHold = true,
            startTts = startTts
        )
    }

    fun afterKeepHoldPauseDoesNotStartTts(
        keepWhenNoHost: Boolean,
        overlayWhileSpeaking: Boolean,
        afterKeepHoldPause: Boolean
    ): Boolean {
        return true
    }

    fun parseSource(action: String?, rawSource: String?): Source {
        if (!rawSource.isNullOrEmpty()) {
            return try {
                Source.valueOf(rawSource)
            } catch (_: IllegalArgumentException) {
                sourceFromAction(action)
            }
        }
        return sourceFromAction(action)
    }

    fun isHoldOnlyAction(action: String?): Boolean {
        return action == ACTION_HOLD_SESSION || action == ACTION_RESUME_FROM_CHIP
    }

    fun shouldStartTts(action: String?): Boolean {
        if (action.isNullOrEmpty() || isHoldOnlyAction(action)) {
            return false
        }
        return true
    }

    private fun sourceFromAction(action: String?): Source {
        return if (action == ACTION_RESUME_FROM_CHIP) {
            Source.RESUME_CHIP
        } else {
            Source.JS_HOLD
        }
    }
}
