package expo.modules.petspeech

import java.util.Locale

object PetSpeechPayloadValidator {

    fun isValid(eventId: String?, text: String?, lang: String?): Boolean {
        if (eventId == null || text == null) {
            return false
        }
        val trimmedEventId = eventId.trim()
        val trimmedText = text.trim()

        if (trimmedEventId.isEmpty() || trimmedText.isEmpty()) {
            return false
        }

        if (trimmedEventId.codePointCount(0, trimmedEventId.length) > PetSpeechLimits.MAX_EVENT_ID_CODE_POINTS) {
            return false
        }

        if (trimmedText.codePointCount(0, trimmedText.length) > PetSpeechLimits.MAX_TEXT_CODE_POINTS) {
            return false
        }

        if (lang != null) {
            val normalized = PetSpeechLanguageNormalizer.normalize(lang)
            if (normalized == null) {
                return false
            }
        }

        return true
    }
}
