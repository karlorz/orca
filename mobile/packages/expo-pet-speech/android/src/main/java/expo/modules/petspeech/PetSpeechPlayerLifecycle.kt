package expo.modules.petspeech

class PetSpeechPlayerLifecycle<T>(
    private val release: (T) -> Unit
) {
    var current: T? = null

    fun releaseCurrent() {
        val player = current ?: return
        current = null
        release(player)
    }
}
