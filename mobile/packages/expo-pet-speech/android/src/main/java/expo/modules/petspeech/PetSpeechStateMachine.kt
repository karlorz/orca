package expo.modules.petspeech

sealed class PetSpeechState {
    object Idle : PetSpeechState()
    data class Synthesizing(val eventId: String, val text: String, val tempFilePath: String) : PetSpeechState()
    data class RequestingFocus(val eventId: String, val text: String, val tempFilePath: String) : PetSpeechState()
    data class Playing(val eventId: String, val text: String, val tempFilePath: String) : PetSpeechState()
    data class Finished(val eventId: String, val outcome: PetSpeechOutcome) : PetSpeechState()
}

class PetSpeechStateMachine(
    private val onAction: (Action) -> Unit
) {
    sealed class Action {
        object RequestAudioFocus : Action()
        data class PlayAudioFile(val filePath: String) : Action()
        object AbandonAudioFocus : Action()
        object StopForeground : Action()
        data class DeleteTempFile(val filePath: String) : Action()
        data class NotifyOutcome(val eventId: String, val outcome: PetSpeechOutcome) : Action()
    }

    var currentState: PetSpeechState = PetSpeechState.Idle
        private set

    fun onStartSynthesis(eventId: String, text: String, tempFilePath: String) {
        currentState = PetSpeechState.Synthesizing(eventId, text, tempFilePath)
    }

    fun onSynthesisSuccess() {
        val state = currentState
        if (state is PetSpeechState.Synthesizing) {
            currentState = PetSpeechState.RequestingFocus(state.eventId, state.text, state.tempFilePath)
            onAction(Action.RequestAudioFocus)
        }
    }

    fun onAudioFocusGranted() {
        val state = currentState
        if (state is PetSpeechState.RequestingFocus) {
            currentState = PetSpeechState.Playing(state.eventId, state.text, state.tempFilePath)
            onAction(Action.PlayAudioFile(state.tempFilePath))
        }
    }

    fun onAudioFocusDenied() {
        val state = currentState
        if (state is PetSpeechState.RequestingFocus) {
            currentState = PetSpeechState.Finished(state.eventId, PetSpeechOutcome.Cancelled)
            onAction(Action.StopForeground)
            onAction(Action.DeleteTempFile(state.tempFilePath))
            onAction(Action.NotifyOutcome(state.eventId, PetSpeechOutcome.Cancelled))
            currentState = PetSpeechState.Idle
        }
    }

    fun onSynthesisFailed(outcome: PetSpeechOutcome = PetSpeechOutcome.PlaybackError) {
        val state = currentState
        if (state is PetSpeechState.Synthesizing) {
            currentState = PetSpeechState.Finished(state.eventId, outcome)
            onAction(Action.DeleteTempFile(state.tempFilePath))
            onAction(Action.NotifyOutcome(state.eventId, outcome))
            currentState = PetSpeechState.Idle
        }
    }

    fun onPlaybackComplete() {
        finishWith(PetSpeechOutcome.Spoken)
    }

    fun onPlaybackError() {
        finishWith(PetSpeechOutcome.PlaybackError)
    }

    fun onAudioFocusLost() {
        finishWith(PetSpeechOutcome.Cancelled)
    }

    fun onCancel() {
        finishWith(PetSpeechOutcome.Cancelled)
    }

    fun onServiceDestroyed() {
        finishWith(PetSpeechOutcome.Cancelled)
    }

    private fun finishWith(outcome: PetSpeechOutcome) {
        val state = currentState
        if (state is PetSpeechState.Idle || state is PetSpeechState.Finished) return

        val (eventId, tempFilePath) = when (state) {
            is PetSpeechState.Playing -> {
                onAction(Action.AbandonAudioFocus)
                onAction(Action.StopForeground)
                state.eventId to state.tempFilePath
            }
            is PetSpeechState.RequestingFocus -> {
                onAction(Action.StopForeground)
                state.eventId to state.tempFilePath
            }
            is PetSpeechState.Synthesizing -> {
                state.eventId to state.tempFilePath
            }
            else -> return
        }

        currentState = PetSpeechState.Finished(eventId, outcome)
        onAction(Action.DeleteTempFile(tempFilePath))
        onAction(Action.NotifyOutcome(eventId, outcome))
        currentState = PetSpeechState.Idle
    }
}
