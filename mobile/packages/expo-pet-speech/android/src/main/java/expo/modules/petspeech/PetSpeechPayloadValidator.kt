package expo.modules.petspeech

import java.util.Locale

object PetSpeechPayloadValidator {
    private val ALLOWED_LANGUAGES = setOf("yue", "cantonese", "yue-hk", "zh-hk")
    private const val MAX_TEXT_CODE_POINTS = 70
    private const val MAX_EVENT_ID_CODE_POINTS = 128

    fun isValid(eventId: String?, text: String?, lang: String?): Boolean {
        if (eventId == null || text == null) {
            return false
        }
        val trimmedEventId = eventId.trim()
        val trimmedText = text.trim()

        if (trimmedEventId.isEmpty() || trimmedText.isEmpty()) {
            return false
        }

        if (trimmedEventId.codePointCount(0, trimmedEventId.length) > MAX_EVENT_ID_CODE_POINTS) {
            return false
        }

        if (trimmedText.codePointCount(0, trimmedText.length) > MAX_TEXT_CODE_POINTS) {
            return false
        }

        if (lang != null) {
            val normalizedLang = lang.trim().lowercase(Locale.ROOT)
            if (!ALLOWED_LANGUAGES.contains(normalizedLang)) {
                return false
            }
        }

        return true
    }
}
