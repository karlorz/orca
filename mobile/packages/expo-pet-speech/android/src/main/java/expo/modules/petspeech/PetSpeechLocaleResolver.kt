package expo.modules.petspeech

import java.util.Locale

sealed class PetSpeechOutcome(val name: String) {
    object Spoken : PetSpeechOutcome("spoken")
    object VoiceUnavailable : PetSpeechOutcome("voice-unavailable")
    object PlaybackError : PetSpeechOutcome("playback-error")
    object Cancelled : PetSpeechOutcome("cancelled")
}

object PetSpeechLocaleResolver {
    /**
     * Resolves the target locale for pet speech within the requested canonical language.
     * Order of preference:
     * - yue-HK: exact yue-HK, then exact zh-HK. Never zh-CN, zh-TW, or en.
     * - zh-CN: exact zh-CN only. Never zh-TW / zh-HK / yue / en.
     * - zh-TW: exact zh-TW only. Never zh-CN / zh-HK / yue / en.
     * - en-US: exact en-US, then another installed locale whose language is en.
     * If no same-language match is available, fails closed (returns null).
     */
    fun resolveLocale(requestedLang: String?, availableLocales: Set<Locale>): Locale? {
        val canonical = PetSpeechLanguageNormalizer.normalize(requestedLang ?: "yue") ?: return null

        when (canonical) {
            PetSpeechLanguageNormalizer.CANONICAL_YUE_HK -> {
                // Search for yue-HK
                val yueHk = availableLocales.find {
                    (it.language.equals("yue", ignoreCase = true) && it.country.equals("HK", ignoreCase = true)) ||
                        it.toLanguageTag().equals("yue-HK", ignoreCase = true)
                }
                if (yueHk != null) {
                    return yueHk
                }

                // Fallback to zh-HK
                val zhHk = availableLocales.find {
                    (it.language.equals("zh", ignoreCase = true) && it.country.equals("HK", ignoreCase = true)) ||
                        it.toLanguageTag().equals("zh-HK", ignoreCase = true)
                }
                if (zhHk != null) {
                    return zhHk
                }

                return null
            }
            PetSpeechLanguageNormalizer.CANONICAL_ZH_CN -> {
                // Exact zh-CN only
                return availableLocales.find {
                    (it.language.equals("zh", ignoreCase = true) && it.country.equals("CN", ignoreCase = true)) ||
                        it.toLanguageTag().equals("zh-CN", ignoreCase = true)
                }
            }
            PetSpeechLanguageNormalizer.CANONICAL_ZH_TW -> {
                // Exact zh-TW only
                return availableLocales.find {
                    (it.language.equals("zh", ignoreCase = true) && it.country.equals("TW", ignoreCase = true)) ||
                        it.toLanguageTag().equals("zh-TW", ignoreCase = true)
                }
            }
            PetSpeechLanguageNormalizer.CANONICAL_EN_US -> {
                // Exact en-US first
                val enUs = availableLocales.find {
                    (it.language.equals("en", ignoreCase = true) && it.country.equals("US", ignoreCase = true)) ||
                        it.toLanguageTag().equals("en-US", ignoreCase = true)
                }
                if (enUs != null) {
                    return enUs
                }

                // Fallback to another installed locale whose language is "en"
                return availableLocales.find {
                    it.language.equals("en", ignoreCase = true)
                }
            }
            else -> return null
        }
    }
}
