package expo.modules.petspeech

object PetSpeechTtsLanguageClassifier {
    // Android TextToSpeech constants:
    // LANG_AVAILABLE = 0, LANG_COUNTRY_AVAILABLE = 1, LANG_COUNTRY_VAR_AVAILABLE = 2
    // LANG_MISSING_DATA = -1, LANG_NOT_SUPPORTED = -2

    fun isLanguageAvailable(resultCode: Int): Boolean {
        return resultCode >= 0
    }
}
