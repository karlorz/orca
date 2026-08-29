package expo.modules.petspeech

import java.util.Locale

object PetSpeechVoiceClassifier {
    /**
     * Determines whether a voice locale belongs to one of the canonical language groups:
     * - yue-HK: language "yue", or tag "zh-hk", or (language "zh" and country "HK")
     * - zh-CN: (language "zh" and country "CN"), or tag "zh-cn"
     * - zh-TW: (language "zh" and country "TW"), or tag "zh-tw"
     * - en-US: (language "en" and country "US"), or tag "en-us"
     */
    fun classifyCanonicalLanguage(locale: Locale?): String? {
        if (locale == null) return null
        val tag = locale.toLanguageTag().lowercase(Locale.ROOT)
        val lang = locale.language.lowercase(Locale.ROOT)
        val country = locale.country.uppercase(Locale.ROOT)

        if (lang == "yue" || tag == "zh-hk" || (lang == "zh" && country == "HK")) {
            return PetSpeechLanguageNormalizer.CANONICAL_YUE_HK
        }
        if (tag == "zh-cn" || (lang == "zh" && country == "CN")) {
            return PetSpeechLanguageNormalizer.CANONICAL_ZH_CN
        }
        if (tag == "zh-tw" || (lang == "zh" && country == "TW")) {
            return PetSpeechLanguageNormalizer.CANONICAL_ZH_TW
        }
        if (tag == "en-us" || (lang == "en" && country == "US") || (lang == "en" && country.isEmpty() && tag == "en")) {
            return PetSpeechLanguageNormalizer.CANONICAL_EN_US
        }
        return null
    }

    fun isSupportedVoiceLocale(locale: Locale?): Boolean {
        return classifyCanonicalLanguage(locale) != null
    }
}
