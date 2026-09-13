package expo.modules.petspeech

object PetSpeechChecklistIntentDecision {
    const val ACTION_APP_NOTIFICATION_SETTINGS = "android.settings.APP_NOTIFICATION_SETTINGS"
    const val ACTION_APPLICATION_DETAILS_SETTINGS = "android.settings.APPLICATION_DETAILS_SETTINGS"
    const val ACTION_REQUEST_IGNORE_BATTERY = "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"
    const val ACTION_IGNORE_BATTERY_SETTINGS = "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS"
    const val ACTION_CHANNEL_NOTIFICATION_SETTINGS = "android.settings.CHANNEL_NOTIFICATION_SETTINGS"
    const val ACTION_MANAGE_OVERLAY = "android.settings.action.MANAGE_OVERLAY_PERMISSION"
    const val EXTRA_APP_PACKAGE = "android.provider.extra.APP_PACKAGE"
    const val EXTRA_CHANNEL_ID = "android.provider.extra.CHANNEL_ID"

    data class Target(
        val action: String,
        val usePackageUri: Boolean,
        val extras: Map<String, String>,
        val componentPackage: String? = null,
        val componentClass: String? = null
    )

    fun targets(item: String, packageName: String, playbackChannelId: String): List<Target> {
        return when (item) {
            "notifications" -> listOf(
                Target(
                    action = ACTION_APP_NOTIFICATION_SETTINGS,
                    usePackageUri = false,
                    extras = mapOf(
                        EXTRA_APP_PACKAGE to packageName,
                        "app_package" to packageName
                    )
                ),
                Target(
                    action = ACTION_APPLICATION_DETAILS_SETTINGS,
                    usePackageUri = true,
                    extras = emptyMap()
                )
            )
            "battery" -> listOf(
                Target(
                    action = ACTION_REQUEST_IGNORE_BATTERY,
                    usePackageUri = true,
                    extras = emptyMap()
                ),
                Target(
                    action = ACTION_IGNORE_BATTERY_SETTINGS,
                    usePackageUri = false,
                    extras = emptyMap()
                ),
                Target(
                    action = ACTION_APPLICATION_DETAILS_SETTINGS,
                    usePackageUri = true,
                    extras = emptyMap()
                )
            )
            "lock-channel" -> listOf(
                Target(
                    action = ACTION_CHANNEL_NOTIFICATION_SETTINGS,
                    usePackageUri = false,
                    extras = mapOf(
                        EXTRA_APP_PACKAGE to packageName,
                        EXTRA_CHANNEL_ID to playbackChannelId
                    )
                ),
                Target(
                    action = ACTION_APP_NOTIFICATION_SETTINGS,
                    usePackageUri = false,
                    extras = mapOf(EXTRA_APP_PACKAGE to packageName)
                )
            )
            "overlay" -> listOf(
                Target(
                    action = ACTION_MANAGE_OVERLAY,
                    usePackageUri = true,
                    extras = emptyMap()
                )
            )
            "device-guard" -> listOf(
                Target(
                    action = "",
                    usePackageUri = false,
                    extras = emptyMap(),
                    componentPackage = PetSpeechOemAutostartDecision.MOTOROLA_DEVICE_GUARD_PACKAGE,
                    componentClass = PetSpeechOemAutostartDecision.MOTOROLA_PORTAL_ACTIVITY
                )
            )
            else -> emptyList()
        }
    }
}
