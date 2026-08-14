package com.mcm.privateconnect

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.firebase.messaging.FirebaseMessaging

/**
 * Jembatan push native MCM.
 *
 * Menyediakan status kapabilitas yang JUJUR untuk halaman Pengaturan Notifikasi
 * (izin, token, channel, full-screen intent, optimasi baterai) dan menyimpan
 * kredensial aksi ke Keystore. Tidak pernah mengembalikan rahasia ke WebView.
 */
@CapacitorPlugin(
    name = "McmPush",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])]
)
class McmPushPlugin : Plugin() {

    override fun load() {
        McmNotifications.ensure(context)
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || granted()) {
            call.resolve(JSObject().put("granted", granted()))
            return
        }
        requestPermissionForAlias("notifications", call, "permissionResult")
    }

    @PermissionCallback
    private fun permissionResult(call: PluginCall) {
        McmNotifications.ensure(context)
        call.resolve(JSObject().put("granted", granted()))
    }

    @PluginMethod
    fun getToken(call: PluginCall) {
        if (!firebaseConfigured()) {
            call.resolve(JSObject().put("token", null as String?).put("reason", "firebase_missing"))
            return
        }
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { call.resolve(JSObject().put("token", it)) }
            .addOnFailureListener { call.resolve(JSObject().put("token", null as String?).put("reason", "fcm_failed")) }
    }

    @PluginMethod
    fun saveActionToken(call: PluginCall) {
        val token = call.getString("token")
        if (token.isNullOrBlank()) { call.reject("token_required"); return }
        ActionCredentials.save(context, token)
        call.resolve()
    }

    @PluginMethod
    fun clearActionToken(call: PluginCall) {
        ActionCredentials.clear(context)
        NotificationManagerCompat.from(context).cancelAll()
        call.resolve()
    }

    @PluginMethod
    fun capabilities(call: PluginCall) {
        val nm = context.getSystemService(NotificationManager::class.java)
        val channels = JSArray()
        McmNotifications.existing(context).forEach { channels.put(it) }

        val fullScreen = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            nm?.canUseFullScreenIntent() ?: false
        } else true

        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val unrestricted = pm?.isIgnoringBatteryOptimizations(context.packageName) ?: false

        call.resolve(
            JSObject()
                .put("backgroundReceiver", true)
                .put("permissionGranted", granted())
                .put("channels", channels)
                .put("requiredChannels", JSArray().also { a -> McmNotifications.ALL.forEach { a.put(it) } })
                .put("fullScreenIntent", fullScreen)
                .put("batteryUnrestricted", unrestricted)
                .put("firebaseConfigured", firebaseConfigured())
                .put("actionCredentialStored", ActionCredentials.has(context))
        )
    }

    @PluginMethod
    fun openNotificationSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
        call.resolve()
    }

    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val ok = runCatching { context.startActivity(intent); true }.getOrDefault(false)
        call.resolve(JSObject().put("opened", ok))
    }

    /** Notifikasi uji lokal — membuktikan channel & izin, bukan jalur FCM. */
    @PluginMethod
    fun sendTestNotification(call: PluginCall) {
        McmNotifications.ensure(context)
        if (!granted()) { call.resolve(JSObject().put("shown", false).put("reason", "permission")); return }
        val n = NotificationCompat.Builder(context, McmNotifications.CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_mcm)
            .setContentTitle("MCM")
            .setContentText("Notifikasi uji berhasil tampil di perangkat ini.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(777_001, n) }
        call.resolve(JSObject().put("shown", true))
    }

    @PluginMethod
    fun clearConversationNotifications(call: PluginCall) {
        val conv = call.getString("conversationId")
        if (conv.isNullOrBlank()) { call.resolve(); return }
        runCatching {
            NotificationManagerCompat.from(context)
                .cancel(PushDeliveryService.notificationId(conv))
        }
        call.resolve()
    }

    /** Rute deep link dari notifikasi yang membangunkan aplikasi (cold start). */
    @PluginMethod
    fun consumePendingRoute(call: PluginCall) {
        val route = (activity as? MainActivity)?.consumePendingRoute()
        call.resolve(JSObject().put("route", route))
    }

    @PluginMethod
    fun consumePendingFcmToken(call: PluginCall) {
        val prefs = context.getSharedPreferences("mcm_push", Context.MODE_PRIVATE)
        val token = prefs.getString("pending_fcm_token", null)
        if (token != null) prefs.edit().remove("pending_fcm_token").apply()
        call.resolve(JSObject().put("token", token))
    }

    private fun granted(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    private fun firebaseConfigured(): Boolean = runCatching {
        val id = context.resources.getIdentifier("google_app_id", "string", context.packageName)
        id != 0 && context.getString(id).isNotBlank()
    }.getOrDefault(false)

    @Suppress("unused")
    private fun unusedUri(): Uri = Uri.EMPTY
}
