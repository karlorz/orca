package expo.modules.petspeech

import java.util.concurrent.atomic.AtomicBoolean

class PetSpeechEngineLifecycle<T>(
    val engine: T,
    private val onStop: (T) -> Unit,
    private val onShutdown: (T) -> Unit
) {
    private val _isReleased = AtomicBoolean(false)
    val isReleased: Boolean
        get() = _isReleased.get()

    fun release() {
        if (_isReleased.compareAndSet(false, true)) {
            try {
                onStop(engine)
            } catch (_: Exception) {}
            try {
                onShutdown(engine)
            } catch (_: Exception) {}
        }
    }

    fun onSynthesisComplete() {
        release()
    }

    fun onSynthesisFailed() {
        release()
    }

    fun onCancelled() {
        release()
    }
}
