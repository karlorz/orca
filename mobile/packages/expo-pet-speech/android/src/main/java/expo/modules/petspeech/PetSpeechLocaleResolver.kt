package expo.modules.petspeech

import java.util.Locale

sealed class PetSpeechOutcome(val name: String) {
    object Spoken : PetSpeechOutcome("spoken")
    object VoiceUnavailable : PetSpeechOutcome("voice-unavailable")
    object PlaybackError : PetSpeechOutcome("playback-error")
    object Cancelled : PetSpeechOutcome("cancelled")
}

object PetSpeechLocaleResolver {
    private val CANTONESE_LANG_CODES = setOf("yue", "cantonese", "yue-hk", "zh-hk")

    /**
     * Resolves the requested language strictly to Cantonese.
     * Order of preference: yue-HK then zh-HK.
     * Never English, never zh-CN, never zh-TW.
     * If neither is available, fails closed (returns null).
     */
    fun resolveLocale(requestedLang: String?, availableLocales: Set<Locale>): Locale? {
        val lang = (requestedLang ?: "yue").trim().lowercase()
        if (!CANTONESE_LANG_CODES.contains(lang)) {
            return null
        }

        // Search for yue-HK
        val yueHk = availableLocales.find {
            it.language.equals("yue", ignoreCase = true) && it.country.equals("HK", ignoreCase = true)
        } ?: availableLocales.find {
            it.toLanguageTag().equals("yue-HK", ignoreCase = true)
        }
        if (yueHk != null) {
            return yueHk
        }

        // Fallback to zh-HK
        val zhHk = availableLocales.find {
            it.language.equals("zh", ignoreCase = true) && it.country.equals("HK", ignoreCase = true)
        } ?: availableLocales.find {
            it.toLanguageTag().equals("zh-HK", ignoreCase = true)
        }
        if (zhHk != null) {
            return zhHk
        }

        return null
    }
}
