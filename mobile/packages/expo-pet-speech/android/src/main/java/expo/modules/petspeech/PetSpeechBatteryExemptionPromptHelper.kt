package expo.modules.petspeech

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

object PetSpeechBatteryExemptionPromptHelper {

    private const val PREFS_NAME = "expo.modules.petspeech.battery_prefs"
    private const val KEY_BATTERY_PROMPTED = "key_battery_exemption_prompted"

    fun requestExemptionIfNeeded(
        isPrompted: () -> Boolean,
        isIgnoringBatteryOptimizations: () -> Boolean,
        markPrompted: () -> Unit,
        startExemptionActivity: () -> Unit
    ): Boolean {
        if (isPrompted()) {
            return false
        }
        if (isIgnoringBatteryOptimizations()) {
            markPrompted()
            return false
        }
        markPrompted()
        startExemptionActivity()
        return true
    }

    fun promptBatteryExemptionOnce(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return
        }

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(KEY_BATTERY_PROMPTED, false)) {
            return
        }
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager

        requestExemptionIfNeeded(
            isPrompted = { prefs.getBoolean(KEY_BATTERY_PROMPTED, false) },
            isIgnoringBatteryOptimizations = {
                powerManager?.isIgnoringBatteryOptimizations(context.packageName) ?: false
            },
            markPrompted = {
                prefs.edit().putBoolean(KEY_BATTERY_PROMPTED, true).apply()
            },
            startExemptionActivity = {
                try {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:${context.packageName}")
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    context.startActivity(intent)
                } catch (_: Exception) {}
            }
        )
    }
}
