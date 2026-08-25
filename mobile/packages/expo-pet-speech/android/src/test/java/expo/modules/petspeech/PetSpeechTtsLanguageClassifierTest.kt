package expo.modules.petspeech

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PetSpeechTtsLanguageClassifierTest {

    @Test
    fun acceptsValidLanguageAvailabilityCodes() {
        // TextToSpeech.LANG_AVAILABLE = 0
        assertTrue(PetSpeechTtsLanguageClassifier.isLanguageAvailable(0))
        // TextToSpeech.LANG_COUNTRY_AVAILABLE = 1
        assertTrue(PetSpeechTtsLanguageClassifier.isLanguageAvailable(1))
        // TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE = 2
        assertTrue(PetSpeechTtsLanguageClassifier.isLanguageAvailable(2))
    }

    @Test
    fun rejectsMissingDataOrNotSupportedCodes() {
        // TextToSpeech.LANG_MISSING_DATA = -1
        assertFalse(PetSpeechTtsLanguageClassifier.isLanguageAvailable(-1))
        // TextToSpeech.LANG_NOT_SUPPORTED = -2
        assertFalse(PetSpeechTtsLanguageClassifier.isLanguageAvailable(-2))
        // Any negative error code
        assertFalse(PetSpeechTtsLanguageClassifier.isLanguageAvailable(-3))
        assertFalse(PetSpeechTtsLanguageClassifier.isLanguageAvailable(-100))
    }
}
