package com.mcm.privateconnect

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

    override fun onCreate(savedInstanceState: Bundle?) {
        applyScreenSecurity()
        super.onCreate(savedInstanceState)
        applyScreenSecurity()
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
                  screenSecurity: { flagSecure: true, recentsScreenshotDisabled: $recents }
                });
                """.trimIndent(),
                null
            )
        }
    }
}
