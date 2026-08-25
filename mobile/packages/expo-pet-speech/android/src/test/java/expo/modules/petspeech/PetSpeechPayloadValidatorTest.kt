package expo.modules.petspeech

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PetSpeechPayloadValidatorTest {

    @Test
    fun acceptsValidCantoneseUtterance() {
        assertTrue(PetSpeechPayloadValidator.isValid("ev-1", "你好呀", "yue"))
        assertTrue(PetSpeechPayloadValidator.isValid("ev-2", "早晨", "yue-HK"))
        assertTrue(PetSpeechPayloadValidator.isValid("ev-3", "食咗飯未", "zh-HK"))
        assertTrue(PetSpeechPayloadValidator.isValid("ev-4", "得唔得", "cantonese"))
        assertTrue(PetSpeechPayloadValidator.isValid("ev-5", "預設語言", null))
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
        // Exactly 70 code points
        val text70 = "廣".repeat(70)
        assertTrue(PetSpeechPayloadValidator.isValid("ev-1", text70, "yue"))

        // 71 code points
        val text71 = "廣".repeat(71)
        assertFalse(PetSpeechPayloadValidator.isValid("ev-1", text71, "yue"))

        // Surrogate pairs (e.g. emoji 🦭 or CJK Extension B 𠮷): 70 emoji code points = 140 Java chars
        val emoji70 = "🦭".repeat(70)
        assertTrue(PetSpeechPayloadValidator.isValid("ev-1", emoji70, "yue"))

        val emoji71 = "🦭".repeat(71)
        assertFalse(PetSpeechPayloadValidator.isValid("ev-1", emoji71, "yue"))
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
    fun rejectsNonCantoneseLanguages() {
        assertFalse(PetSpeechPayloadValidator.isValid("ev-1", "Hello", "en-US"))
        assertFalse(PetSpeechPayloadValidator.isValid("ev-2", "你好", "zh-CN"))
        assertFalse(PetSpeechPayloadValidator.isValid("ev-3", "你好", "zh-TW"))
        assertFalse(PetSpeechPayloadValidator.isValid("ev-4", "Bonjour", "fr-FR"))
    }
}
