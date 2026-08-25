package expo.modules.petspeech

object PetSpeechForegroundStart {
    const val IDLE_NOTIFICATION_TEXT = "Pet voice connected"

    fun tryStartForeground(startForeground: () -> Unit): Boolean {
        return try {
            startForeground()
            true
        } catch (e: Throwable) {
            if (isForegroundServiceStartNotAllowed(e)) {
                false
            } else {
                throw e
            }
        }
    }

    fun isForegroundServiceStartNotAllowed(throwable: Throwable?): Boolean {
        var current: Throwable? = throwable
        while (current != null) {
            val name = current.javaClass.name
            val message = current.message ?: ""
            if (name == "android.app.ForegroundServiceStartNotAllowedException" ||
                name.endsWith("ForegroundServiceStartNotAllowedException") ||
                message.contains("ForegroundServiceStartNotAllowedException")
            ) {
                return true
            }
            current = current.cause
        }
        return false
    }
}
