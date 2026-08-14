package com.mcm.privateconnect

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * Foreground service panggilan (tipe microphone).
 *
 * HANYA dimulai dari Activity yang sedang foreground setelah pengguna menekan
 * "Jawab" dan server menerima aksi tersebut. Tidak pernah dimulai saat
 * berdering di latar (dilarang Android 12+).
 *
 * HANYA aktif selama panggilan berdering atau sedang berlangsung. Bukan service
 * "selalu hidup" dan tidak dipakai untuk polling. Berhenti dan melepas wake lock
 * begitu panggilan mencapai status terminal.
 */
class CallForegroundService : Service() {

    companion object {
        private const val NOTIFICATION_ID = 424_242
        private const val EXTRA_CALL = "callId"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_RINGING = "ringing"

        fun start(context: Context, callId: String, title: String, ringing: Boolean) {
            val intent = Intent(context, CallForegroundService::class.java)
                .putExtra(EXTRA_CALL, callId)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_RINGING, ringing)
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, CallForegroundService::class.java)) }
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        McmNotifications.ensure(this)
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Panggilan MCM"
        val ringing = intent?.getBooleanExtra(EXTRA_RINGING, false) ?: false

        val notification = NotificationCompat.Builder(this, McmNotifications.CH_CALLS_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_mcm)
            .setContentTitle(title)
            .setContentText(if (ringing) "Berdering…" else "Panggilan sedang berlangsung")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Tipe phoneCall butuh MANAGE_OWN_CALLS + ConnectionService atau
            // ROLE_DIALER yang TIDAK dimiliki aplikasi ini; pakai microphone.
            startForeground(
                NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        if (wakeLock == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mcm:call").apply {
                setReferenceCounted(false)
                acquire(60 * 60 * 1000L)
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }
}
