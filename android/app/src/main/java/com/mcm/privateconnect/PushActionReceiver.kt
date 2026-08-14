package com.mcm.privateconnect

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.work.Data

/**
 * Receiver aksi notifikasi TANPA UI (Balas, Tandai dibaca, Tolak).
 *
 * Aturan penting:
 * - TIDAK PERNAH `startActivity()` dari sini (notification trampoline diblokir
 *   Android 10+/12+). Aksi "Jawab" memakai PendingIntent Activity langsung.
 * - TIDAK melakukan jaringan di dalam `onReceive`; semua panggilan endpoint
 *   dijadwalkan ke `PushActionWorker` (WorkManager) agar retry aman.
 * - Token aksi berasal dari extras notifikasi (sekali-pakai), bukan bearer
 *   universal yang tersimpan di perangkat.
 */
class PushActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_REPLY = "com.mcm.privateconnect.REPLY"
        const val ACTION_READ = "com.mcm.privateconnect.READ"
        const val ACTION_CALL_DECLINE = "com.mcm.privateconnect.CALL_DECLINE"

        /** Sumber daya yang diikat ke token: conversationId ATAU callId. */
        const val EXTRA_RESOURCE = "resourceId"
        const val EXTRA_ACTION_TOKEN = "actionToken"
        const val EXTRA_ACTION_ID = "actionId"
        const val EXTRA_NOTIFICATION_ID = "notificationId"

        private const val MAX_BODY = 4000
    }

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, 0)
        val token = intent.getStringExtra(EXTRA_ACTION_TOKEN)
        val actionId = intent.getStringExtra(EXTRA_ACTION_ID)
        val resource = intent.getStringExtra(EXTRA_RESOURCE)
        if (token.isNullOrBlank() || actionId.isNullOrBlank() || resource.isNullOrBlank()) return

        when (intent.action) {
            ACTION_REPLY -> {
                val body = RemoteInput.getResultsFromIntent(intent)
                    ?.getCharSequence(PushDeliveryService.KEY_REPLY_TEXT)?.toString()?.trim()
                    .orEmpty()
                if (body.isEmpty() || body.length > MAX_BODY) return
                enqueue(
                    app, notificationId, "reply", actionId, resource,
                    Data.Builder().putString(PushActionWorker.KEY_BODY, body),
                    token,
                )
            }
            ACTION_READ -> {
                NotificationManagerCompat.from(app).cancel(notificationId)
                enqueue(app, notificationId, "read", actionId, resource, Data.Builder(), token)
            }
            ACTION_CALL_DECLINE -> {
                NotificationManagerCompat.from(app).cancel(notificationId)
                CallForegroundService.stop(app)
                enqueue(
                    app, notificationId, "call_decline", actionId, resource,
                    Data.Builder(), token,
                )
            }
        }
    }

    private fun enqueue(
        context: Context,
        notificationId: Int,
        action: String,
        actionId: String,
        resource: String,
        data: Data.Builder,
        token: String,
    ) {
        val input = data
            .putString(PushActionWorker.KEY_ACTION, action)
            .putString(PushActionWorker.KEY_RESOURCE, resource)
            .putString(PushActionWorker.KEY_TOKEN, token)
            .putString(PushActionWorker.KEY_ACTION_ID, actionId)
            .putInt(PushActionWorker.KEY_NOTIFICATION_ID, notificationId)
            .build()
        PushActionWorker.enqueue(context, input, "mcm_action:$actionId")
    }

}
