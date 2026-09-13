package expo.modules.petspeech

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.widget.TextView

object PetSpeechSpeakOverlayHelper {
    private var overlayView: TextView? = null

    fun showIfAllowed(context: Context, text: String) {
        hide(context)
        val prefs = PetSpeechPersistPrefs.read(context)
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
        if (!PetSpeechOverlayPermissionDecision.shouldShowOverlay(
                switchOn = prefs.overlayWhileSpeaking,
                speaking = true,
                permissionGranted = granted
            )
        ) {
            return
        }
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return
        val view = TextView(context).apply {
            this.text = text
            textSize = 14f
            setPadding(24, 16, 24, 16)
            setBackgroundColor(0xCC111111.toInt())
            setTextColor(0xFFFFFFFF.toInt())
        }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.END
            x = 24
            y = 120
        }
        try {
            wm.addView(view, params)
            overlayView = view
        } catch (_: Exception) {
            overlayView = null
        }
    }

    fun hide(context: Context) {
        val view = overlayView ?: return
        overlayView = null
        try {
            val wm = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
            wm?.removeView(view)
        } catch (_: Exception) {
        }
    }
}
