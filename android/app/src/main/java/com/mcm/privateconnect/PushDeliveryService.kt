package com.mcm.privateconnect

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Penerima FCM latar MCM.
 *
 * Ini adalah jalur pengiriman NYATA saat aplikasi ditutup atau prosesnya
 * dimatikan sistem — WebSocket/realtime WebView tidak berjalan pada kondisi itu.
 *
 * Service ini TIDAK menulis ke database secara langsung. Semua aksi
 * (balas, tandai dibaca, jawab/tolak panggilan) melewati endpoint aksi
 * tervalidasi dengan kredensial perangkat.
 */
class PushDeliveryService : FirebaseMessagingService() {

    companion object {
        const val KEY_REPLY_TEXT = "mcm_reply_text"
        const val EXTRA_ROUTE = "mcm_route"

        fun notificationId(group: String): Int = group.hashCode()
    }

    override fun onNewToken(token: String) {
        // Token disimpan lokal; pendaftaran ke server dilakukan lapisan web saat
        // aplikasi dibuka (butuh sesi pengguna). Tidak ada token auth di sini.
        getSharedPreferences("mcm_push", Context.MODE_PRIVATE)
            .edit().putString("pending_fcm_token", token).apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data.isEmpty()) return
        McmNotifications.ensure(this)

        when (data["kind"]) {
            "call" -> handleCall(data)
            "call_terminal" -> cancelCall(data)
            else -> handleMessage(data)
        }
    }

    // ---------------------------------------------------------------- pesan

    private fun handleMessage(data: Map<String, String>) {
        val conversationId = data["conversationId"] ?: return
        val group = data["group"] ?: conversationId
        val title = data["title"] ?: "MCM"
        val body = data["body"] ?: ""
        val canReply = data["canReply"] == "1"
        val id = notificationId(group)

        val person = Person.Builder().setName(title).build()
        val style = NotificationCompat.MessagingStyle(person)
            .addMessage(body, System.currentTimeMillis(), person)

        val builder = NotificationCompat.Builder(this, McmNotifications.CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_mcm)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(style)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setGroup(group)
            .setContentIntent(openAppIntent(data["route"] ?: "/chat/$conversationId", id))

        if (canReply) {
            val remoteInput = RemoteInput.Builder(KEY_REPLY_TEXT).setLabel("Balas").build()
            val replyIntent = actionIntent(id) {
                it.action = PushActionReceiver.ACTION_REPLY
                it.putExtra(PushActionReceiver.EXTRA_CONVERSATION, conversationId)
                it.putExtra(PushActionReceiver.EXTRA_NOTIFICATION_ID, id)
            }
            builder.addAction(
                NotificationCompat.Action.Builder(0, "Balas", replyIntent)
                    .addRemoteInput(remoteInput)
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                    .setAllowGeneratedReplies(false)
                    .build()
            )
        }

        val readIntent = actionIntent(id + 1) {
            it.action = PushActionReceiver.ACTION_READ
            it.putExtra(PushActionReceiver.EXTRA_CONVERSATION, conversationId)
            it.putExtra(PushActionReceiver.EXTRA_NOTIFICATION_ID, id)
        }
        builder.addAction(
            NotificationCompat.Action.Builder(0, "Tandai dibaca", readIntent)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
                .build()
        )

        notify(id, builder.build())
    }

    // ------------------------------------------------------------ panggilan

    private fun handleCall(data: Map<String, String>) {
        val callId = data["callId"] ?: return
        val caller = data["title"] ?: "Panggilan masuk"
        val id = notificationId("call:$callId")

        val answer = actionIntent(id + 2) {
            it.action = PushActionReceiver.ACTION_CALL_ANSWER
            it.putExtra(PushActionReceiver.EXTRA_CALL, callId)
            it.putExtra(PushActionReceiver.EXTRA_ROUTE, "/call/$callId")
            it.putExtra(PushActionReceiver.EXTRA_NOTIFICATION_ID, id)
        }
        val decline = actionIntent(id + 3) {
            it.action = PushActionReceiver.ACTION_CALL_DECLINE
            it.putExtra(PushActionReceiver.EXTRA_CALL, callId)
            it.putExtra(PushActionReceiver.EXTRA_NOTIFICATION_ID, id)
        }
        val fullScreen = openAppIntent("/call/$callId", id + 4)

        val builder = NotificationCompat.Builder(this, McmNotifications.CH_CALLS_INCOMING)
            .setSmallIcon(R.drawable.ic_stat_mcm)
            .setContentTitle(caller)
            .setContentText(data["body"] ?: "Panggilan masuk")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(fullScreen)
            .setFullScreenIntent(fullScreen, true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // CallStyle memberi tampilan panggilan asli Android (12+).
            val person = Person.Builder().setName(caller).setImportant(true).build()
            builder.setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
        } else {
            builder.addAction(0, "Tolak", decline)
            builder.addAction(0, "Jawab", answer)
        }

        notify(id, builder.build())
        CallForegroundService.start(this, callId, caller, ringing = true)
    }

    /** Panggilan berakhir di perangkat lain: bersihkan notifikasi di sini. */
    private fun cancelCall(data: Map<String, String>) {
        val callId = data["callId"] ?: return
        NotificationManagerCompat.from(this).cancel(notificationId("call:$callId"))
        CallForegroundService.stop(this)
    }

    // ------------------------------------------------------------- helpers

    private fun notify(id: Int, notification: Notification) {
        val nm = NotificationManagerCompat.from(this)
        if (!nm.areNotificationsEnabled()) return
        runCatching { nm.notify(id, notification) }
    }

    private fun openAppIntent(route: String, requestCode: Int): PendingIntent {
        val intent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("https://mcmchat.id$route")
            putExtra(EXTRA_ROUTE, route)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun actionIntent(requestCode: Int, build: (Intent) -> Unit): PendingIntent {
        val intent = Intent(this, PushActionReceiver::class.java)
        build(intent)
        // MUTABLE hanya diperlukan agar sistem dapat menyisipkan RemoteInput.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        return PendingIntent.getBroadcast(this, requestCode, intent, flags)
    }
}
