package expo.modules.petspeech

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PetSpeechPayloadValidatorTest {

    @Test
    fun acceptsValidLanguages() {
        assertTrue(PetSpeechPayloadValidator.isValid("ev-1", "你好呀", "yue"))
        assertTrue(PetSpeechPayloadValidator.isValid("ev-2", "早晨", "yue-HK"))
        assertTrue(PetSpeechPayloadValidator.isValid("ev-3", "食咗飯未", "zh-HK"))
        assertTrue(PetSpeechPayloadValidator.isValid("ev-4", "得唔得", "cantonese"))
        assertTrue(PetSpeechPayloadValidator.isValid("ev-5", "預設語言", null))
        assertTrue(PetSpeechPayloadValidator.isValid("ev-6", "Hello", "en-US"))
        assertTrue(PetSpeechPayloadValidator.isValid("ev-7", "Hello", "en"))
        assertTrue(PetSpeechPayloadValidator.isValid("ev-8", "你好", "zh-CN"))
        assertTrue(PetSpeechPayloadValidator.isValid("ev-9", "你好", "zh-TW"))
    }

    @Test
    fun rejectsEmptyOrBlankText() {
        assertFalse(PetSpeechPayloadValidator.isValid("ev-1", "", "yue"))
        assertFalse(PetSpeechPayloadValidator.isValid("ev-1", "   ", "yue"))
        assertFalse(PetSpeechPayloadValidator.isValid("ev-1", null, "yue"))
    }

    @Test
    fun rejectsEmptyOrBlankEventId() {
        assertFalse(PetSpeechPayloadValidator.isValid("", "你好", "yue"))
        assertFalse(PetSpeechPayloadValidator.isValid("   ", "你好", "yue"))
        assertFalse(PetSpeechPayloadValidator.isValid(null, "你好", "yue"))
    }

    @Test
    fun enforcesUnicodeCodePointBoundOnText() {
        assertTrue(PetSpeechLimits.MAX_TEXT_CODE_POINTS == 2000)

        val text70 = "廣".repeat(70)
        assertTrue(PetSpeechPayloadValidator.isValid("ev-1", text70, "yue"))

        val text91 = "廣".repeat(91)
        assertTrue(PetSpeechPayloadValidator.isValid("ev-1", text91, "yue"))

        val text2000 = "廣".repeat(2000)
        assertTrue(PetSpeechPayloadValidator.isValid("ev-1", text2000, "yue"))

        val text2001 = "廣".repeat(2001)
        assertFalse(PetSpeechPayloadValidator.isValid("ev-1", text2001, "yue"))

        val emoji2000 = "🦭".repeat(2000)
        assertTrue(PetSpeechPayloadValidator.isValid("ev-1", emoji2000, "yue"))

        val emoji2001 = "🦭".repeat(2001)
        assertFalse(PetSpeechPayloadValidator.isValid("ev-1", emoji2001, "yue"))
    }

    @Test
    fun enforcesUnicodeCodePointBoundOnEventId() {
        val id128 = "e".repeat(128)
        assertTrue(PetSpeechPayloadValidator.isValid(id128, "你好", "yue"))

        val id129 = "e".repeat(129)
        assertFalse(PetSpeechPayloadValidator.isValid(id129, "你好", "yue"))

        // Surrogate pairs for eventId: 128 surrogate code points
        val surrogateId128 = "𠮷".repeat(128)
        assertTrue(PetSpeechPayloadValidator.isValid(surrogateId128, "你好", "yue"))

        val surrogateId129 = "𠮷".repeat(129)
        assertFalse(PetSpeechPayloadValidator.isValid(surrogateId129, "你好", "yue"))
    }

    @Test
    fun rejectsUnknownOrAmbiguousLanguages() {
        assertFalse(PetSpeechPayloadValidator.isValid("ev-1", "Bonjour", "fr-FR"))
        assertFalse(PetSpeechPayloadValidator.isValid("ev-2", "Bonjour", "fr"))
        assertFalse(PetSpeechPayloadValidator.isValid("ev-3", "Hello", "zh"))
        assertFalse(PetSpeechPayloadValidator.isValid("ev-4", "Hello", "mandarin"))
        assertFalse(PetSpeechPayloadValidator.isValid("ev-5", "Hello", "auto"))
    }
}
