package com.mcm.privateconnect

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import com.getcapacitor.BridgeActivity

/**
 * MCM MainActivity.
 *
 * Proteksi layar bersifat fail-closed: FLAG_SECURE dipasang SEBELUM konten
 * dirender (onCreate, sebelum super) dan ditegakkan ulang di onResume, sehingga
 * tetap berlaku setelah rotation, activity recreation, deep link, notifikasi
 * push, panggilan masuk, dan kembali dari background.
 *
 * Tidak ada toggle pengguna untuk mematikannya. Tidak ada isi layar, isi chat,
 * token, atau media yang pernah dicatat ke log.
 */
class MainActivity : BridgeActivity() {

    /** Rute deep link dari notifikasi yang membangunkan aplikasi (cold start). */
    private var pendingRoute: String? = null

    /**
     * Aksi "Jawab" dari notifikasi panggilan. PendingIntent-nya menunjuk
     * langsung ke Activity ini (tanpa trampoline). Token sekali-pakai diteruskan
     * ke lapisan web yang memvalidasinya lewat endpoint aman sebelum media/FGS.
     */
    private var pendingAnswerCall: String? = null
    private var pendingAnswerToken: String? = null
    private var pendingAnswerActionId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        applyScreenSecurity()
        registerPlugin(McmPushPlugin::class.java)
        super.onCreate(savedInstanceState)
        applyScreenSecurity()
        McmNotifications.ensure(this)
        capturePendingRoute(intent)
        capturePendingAnswer(intent)
        markBridge()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        capturePendingRoute(intent)
        capturePendingAnswer(intent)
        markBridge()
    }

    override fun onResume() {
        super.onResume()
        applyScreenSecurity()
        markBridge()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        applyScreenSecurity()
    }

    /** Diambil sekali oleh lapisan web; setelah itu dikosongkan. */
    fun consumePendingRoute(): String? {
        val route = pendingRoute
        pendingRoute = null
        return route
    }

    /** Diambil sekali oleh lapisan web; setelah itu dikosongkan. */
    fun consumePendingCallAnswer(): Triple<String, String, String>? {
        val call = pendingAnswerCall
        val token = pendingAnswerToken
        val actionId = pendingAnswerActionId
        pendingAnswerCall = null
        pendingAnswerToken = null
        pendingAnswerActionId = null
        if (call.isNullOrBlank() || token.isNullOrBlank() || actionId.isNullOrBlank()) return null
        return Triple(call, token, actionId)
    }

    private fun capturePendingAnswer(intent: Intent?) {
        val call = intent?.getStringExtra(PushDeliveryService.EXTRA_ANSWER_CALL) ?: return
        val token = intent.getStringExtra(PushDeliveryService.EXTRA_ANSWER_TOKEN) ?: return
        val actionId = intent.getStringExtra(PushDeliveryService.EXTRA_ANSWER_ACTION_ID) ?: return
        pendingAnswerCall = call
        pendingAnswerToken = token
        pendingAnswerActionId = actionId
        // Extras dibersihkan agar token tidak terbawa ke recreate berikutnya.
        intent.removeExtra(PushDeliveryService.EXTRA_ANSWER_TOKEN)
    }

    private fun capturePendingRoute(intent: Intent?) {
        val extra = intent?.getStringExtra(PushDeliveryService.EXTRA_ROUTE)
        val fromData = intent?.data?.let { uri ->
            val path = uri.path.orEmpty()
            if (path.isBlank()) null else path + (uri.query?.let { "?$it" } ?: "")
        }
        val route = extra ?: fromData
        if (!route.isNullOrBlank() && route.startsWith("/")) pendingRoute = route
    }

    private fun applyScreenSecurity() {
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
        // Matikan snapshot Recent Apps secara eksplisit bila didukung (API 33+).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(false)
        }
    }

    /** Beri tahu lapisan web kapabilitas nyata (read-only, tanpa data sensitif). */
    private fun markBridge() {
        val recents = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        bridge?.webView?.post {
            bridge?.webView?.evaluateJavascript(
                """
                window.MCMNative = Object.assign(window.MCMNative || {}, {
                  screenSecurity: { flagSecure: true, recentsScreenshotDisabled: $recents },
                  backgroundReceiver: true
                });
                """.trimIndent(),
                null
            )
        }
    }
}
