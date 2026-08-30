package expo.modules.petspeech

import android.speech.tts.TextToSpeech

data class PetSpeechVoiceApplicationDecision(
    val shouldProceed: Boolean,
    val effectiveVoiceName: String?,
    val networkRequired: Boolean,
    val failureOutcome: PetSpeechOutcome? = null
)

object PetSpeechVoiceApplicationClassifier {

    fun evaluateVoiceApplication(
        requestedVoiceName: String?,
        matchingVoiceFound: Boolean,
        setVoiceResult: Int?,
        readbackVoiceName: String?,
        readbackNetwork: Boolean,
        exceptionThrown: Boolean = false
    ): PetSpeechVoiceApplicationDecision {
        if (exceptionThrown) {
            return PetSpeechVoiceApplicationDecision(
                shouldProceed = false,
                effectiveVoiceName = null,
                networkRequired = false,
                failureOutcome = PetSpeechOutcome.VoiceUnavailable
            )
        }

        if (requestedVoiceName.isNullOrBlank()) {
            return PetSpeechVoiceApplicationDecision(
                shouldProceed = true,
                effectiveVoiceName = readbackVoiceName,
                networkRequired = readbackNetwork,
                failureOutcome = null
            )
        }

        val trimmedRequested = requestedVoiceName.trim()

        if (!matchingVoiceFound) {
            return PetSpeechVoiceApplicationDecision(
                shouldProceed = false,
                effectiveVoiceName = null,
                networkRequired = false,
                failureOutcome = PetSpeechOutcome.VoiceUnavailable
            )
        }

        if (setVoiceResult != TextToSpeech.SUCCESS) {
            return PetSpeechVoiceApplicationDecision(
                shouldProceed = false,
                effectiveVoiceName = null,
                networkRequired = false,
                failureOutcome = PetSpeechOutcome.VoiceUnavailable
            )
        }

        if (readbackVoiceName == null || readbackVoiceName != trimmedRequested) {
            return PetSpeechVoiceApplicationDecision(
                shouldProceed = false,
                effectiveVoiceName = null,
                networkRequired = false,
                failureOutcome = PetSpeechOutcome.VoiceUnavailable
            )
        }

        return PetSpeechVoiceApplicationDecision(
            shouldProceed = true,
            effectiveVoiceName = readbackVoiceName,
            networkRequired = readbackNetwork,
            failureOutcome = null
        )
    }
}
