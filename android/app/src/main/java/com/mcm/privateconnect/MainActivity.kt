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

    override fun onCreate(savedInstanceState: Bundle?) {
        applyScreenSecurity()
        registerPlugin(McmPushPlugin::class.java)
        super.onCreate(savedInstanceState)
        applyScreenSecurity()
        McmNotifications.ensure(this)
        capturePendingRoute(intent)
        markBridge()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        capturePendingRoute(intent)
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
