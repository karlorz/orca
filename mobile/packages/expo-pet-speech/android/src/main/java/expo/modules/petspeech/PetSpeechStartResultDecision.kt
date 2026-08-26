package expo.modules.petspeech

import android.app.Service

object PetSpeechStartResultDecision {
    fun computeStartResult(isHeld: Boolean): Int {
        return if (isHeld) {
            Service.START_STICKY
        } else {
            Service.START_NOT_STICKY
        }
    }
}
