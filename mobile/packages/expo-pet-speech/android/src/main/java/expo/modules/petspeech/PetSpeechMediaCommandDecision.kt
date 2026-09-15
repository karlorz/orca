package expo.modules.petspeech

object PetSpeechMediaCommandDecision {
    const val KEYCODE_MEDIA_PLAY_PAUSE = 85
    const val KEYCODE_MEDIA_STOP = 86
    const val KEYCODE_MEDIA_PLAY = 126
    const val KEYCODE_MEDIA_PAUSE = 127

    enum class Command {
        PAUSE,
        STOP,
        PLAY,
        PLAY_PAUSE
    }

    enum class Outcome {
        RELEASE_AND_STOP_TTS,
        RESUME,
        IGNORE
    }

    fun commandFromKeyCode(keyCode: Int): Command? {
        return when (keyCode) {
            KEYCODE_MEDIA_PAUSE -> Command.PAUSE
            KEYCODE_MEDIA_STOP -> Command.STOP
            KEYCODE_MEDIA_PLAY -> Command.PLAY
            KEYCODE_MEDIA_PLAY_PAUSE -> Command.PLAY_PAUSE
            else -> null
        }
    }

    fun decide(
        command: Command,
        sessionHeld: Boolean,
        speechActive: Boolean,
        persistEnabled: Boolean = true,
        masterEnabled: Boolean = true,
        keepWhenNoHost: Boolean = false,
        overlayWhileSpeaking: Boolean = false,
        visibilityKeepHold: Boolean = false
    ): Outcome {
        return when (command) {
            Command.PAUSE, Command.STOP ->
                if (keepHoldMatrixDoesNotBlockPause(
                        visibilityKeepHold,
                        keepWhenNoHost,
                        overlayWhileSpeaking
                    )
                ) {
                    Outcome.RELEASE_AND_STOP_TTS
                } else {
                    Outcome.IGNORE
                }
            Command.PLAY_PAUSE ->
                if (speechActive || sessionHeld) {
                    Outcome.RELEASE_AND_STOP_TTS
                } else if (persistEnabled && masterEnabled) {
                    Outcome.RESUME
                } else {
                    Outcome.IGNORE
                }
            Command.PLAY ->
                when {
                    speechActive -> Outcome.RELEASE_AND_STOP_TTS
                    playAfterKeepHoldPauseResumes(
                        sessionHeld,
                        persistEnabled,
                        masterEnabled
                    ) -> Outcome.RESUME
                    secondPlayWhileHeldIdleIgnores(sessionHeld, speechActive) -> Outcome.IGNORE
                    else -> Outcome.IGNORE
                }
        }
    }

    fun serviceAction(outcome: Outcome): String? {
        return when (outcome) {
            Outcome.RELEASE_AND_STOP_TTS -> "expo.modules.petspeech.ACTION_RELEASE_SESSION"
            Outcome.RESUME -> PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION
            Outcome.IGNORE -> null
        }
    }

    fun shouldStopTts(outcome: Outcome): Boolean {
        return outcome == Outcome.RELEASE_AND_STOP_TTS
    }

    fun releaseReason(
        persistEnabled: Boolean = true,
        masterEnabled: Boolean = true
    ): PetSpeechReleaseAftermathDecision.Reason {
        return PetSpeechPersistSettingsWriteDecision.releaseReason(
            persistEnabled = persistEnabled,
            masterEnabled = masterEnabled
        ) ?: PetSpeechReleaseAftermathDecision.Reason.PAUSE
    }

    fun persistOffStopDoesNotHold(outcome: Outcome): Boolean {
        return serviceAction(outcome) != PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION
    }

    fun keepHoldMatrixDoesNotBlockPause(
        visibilityKeepHold: Boolean,
        keepWhenNoHost: Boolean,
        overlayWhileSpeaking: Boolean
    ): Boolean {
        return true
    }

    fun doesNotRestartFgs(outcome: Outcome): Boolean {
        return outcome != Outcome.RESUME &&
            serviceAction(outcome) != PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION
    }

    fun playAfterKeepHoldPauseResumes(
        sessionHeld: Boolean,
        persistEnabled: Boolean,
        masterEnabled: Boolean
    ): Boolean {
        return !sessionHeld && persistEnabled && masterEnabled
    }

    fun persistOffPlayAfterKeepHoldPauseIgnores(
        sessionHeld: Boolean,
        persistEnabled: Boolean,
        masterEnabled: Boolean
    ): Boolean {
        return !sessionHeld && !persistEnabled && masterEnabled
    }

    fun masterOffPlayAfterKeepHoldPauseIgnores(
        sessionHeld: Boolean,
        masterEnabled: Boolean
    ): Boolean {
        return !sessionHeld && !masterEnabled
    }

    fun secondPlayWhileHeldIdleIgnores(
        sessionHeld: Boolean,
        speechActive: Boolean
    ): Boolean {
        return sessionHeld && !speechActive
    }
}
