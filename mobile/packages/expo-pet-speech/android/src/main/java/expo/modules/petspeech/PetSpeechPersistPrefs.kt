package expo.modules.petspeech

import android.content.Context

object PetSpeechPersistPrefs {
    const val PREFS_NAME = "expo.modules.petspeech.persist_prefs"
    const val KEY_MASTER_ENABLED = "key_master_enabled"
    const val KEY_PERSIST_ENABLED = "key_persist_enabled"
    const val KEY_KEEP_WHEN_NO_HOST = "key_keep_when_no_host"
    const val KEY_SHOW_SERVICE_ROW = "key_show_service_row"
    const val KEY_OVERLAY_WHILE_SPEAKING = "key_overlay_while_speaking"

    data class Snapshot(
        val masterEnabled: Boolean,
        val persistEnabled: Boolean,
        val keepWhenNoHost: Boolean,
        val showServiceRow: Boolean,
        val overlayWhileSpeaking: Boolean
    )

    fun read(context: Context): Snapshot {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return Snapshot(
            masterEnabled = prefs.getBoolean(KEY_MASTER_ENABLED, false),
            persistEnabled = prefs.getBoolean(KEY_PERSIST_ENABLED, false),
            keepWhenNoHost = prefs.getBoolean(KEY_KEEP_WHEN_NO_HOST, false),
            showServiceRow = prefs.getBoolean(KEY_SHOW_SERVICE_ROW, true),
            overlayWhileSpeaking = prefs.getBoolean(KEY_OVERLAY_WHILE_SPEAKING, false)
        )
    }

    fun write(
        context: Context,
        masterEnabled: Boolean? = null,
        persistEnabled: Boolean? = null,
        keepWhenNoHost: Boolean? = null,
        showServiceRow: Boolean? = null,
        overlayWhileSpeaking: Boolean? = null
    ) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val editor = prefs.edit()
        if (masterEnabled != null) {
            editor.putBoolean(KEY_MASTER_ENABLED, masterEnabled)
        }
        if (persistEnabled != null) {
            editor.putBoolean(KEY_PERSIST_ENABLED, persistEnabled)
        }
        if (keepWhenNoHost != null) {
            editor.putBoolean(KEY_KEEP_WHEN_NO_HOST, keepWhenNoHost)
        }
        if (showServiceRow != null) {
            editor.putBoolean(KEY_SHOW_SERVICE_ROW, showServiceRow)
        }
        if (overlayWhileSpeaking != null) {
            editor.putBoolean(KEY_OVERLAY_WHILE_SPEAKING, overlayWhileSpeaking)
        }
        editor.commit()
    }
}
