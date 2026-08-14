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
 * Jalur pengiriman NYATA saat aplikasi ditutup atau prosesnya dimatikan sistem.
 *
 * Aturan PendingIntent:
 * - Hanya aksi Balas yang MUTABLE (sistem menyisipkan RemoteInput).
 * - Content / Tandai dibaca / Tolak / Jawab selalu IMMUTABLE dan explicit.
 * - "Jawab" menunjuk LANGSUNG ke MainActivity (tanpa trampoline receiver);
 *   token jawab diteruskan ke lapisan web yang memproses ke endpoint aman
 *   sebelum masuk media/foreground service.
 */
class PushDeliveryService : FirebaseMessagingService() {

    companion object {
        const val KEY_REPLY_TEXT = "mcm_reply_text"
        const val EXTRA_ROUTE = "mcm_route"
        const val EXTRA_ANSWER_CALL = "mcm_answer_call"
        const val EXTRA_ANSWER_TOKEN = "mcm_answer_token"
        const val EXTRA_ANSWER_ACTION_ID = "mcm_answer_action_id"

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
            "message" -> if (data["conversationId"] != null) handleMessage(data) else handleGeneric(data)
            else -> if (data["conversationId"] != null) handleMessage(data) else handleGeneric(data)
        }
    }

    // ---------------------------------------------------------------- pesan

    private fun handleMessage(data: Map<String, String>) {
        val conversationId = data["conversationId"] ?: return
        val group = data["group"] ?: conversationId
        val title = data["title"] ?: "MCM"
        val body = data["body"] ?: ""
        val canReply = data["canReply"] == "1"
        // SATU aksi berbeda per tombol: id + token sekali-pakai dari server.
        // `actionId` adalah batas idempotensi; perangkat tidak membuat kunci sendiri.
        val replyToken = data["replyToken"]
        val replyActionId = data["replyActionId"]
        val readToken = data["readToken"]
        val readActionId = data["readActionId"]
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

        if (canReply && !replyToken.isNullOrBlank() && !replyActionId.isNullOrBlank()) {
            val remoteInput = RemoteInput.Builder(KEY_REPLY_TEXT).setLabel("Balas").build()
            val replyIntent = mutableBroadcast(id) {
                it.action = PushActionReceiver.ACTION_REPLY
                it.putExtra(PushActionReceiver.EXTRA_RESOURCE, conversationId)
                it.putExtra(PushActionReceiver.EXTRA_ACTION_TOKEN, replyToken)
                it.putExtra(PushActionReceiver.EXTRA_ACTION_ID, replyActionId)
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

        if (!readToken.isNullOrBlank() && !readActionId.isNullOrBlank()) {
            val readIntent = immutableBroadcast(id + 1) {
                it.action = PushActionReceiver.ACTION_READ
                it.putExtra(PushActionReceiver.EXTRA_RESOURCE, conversationId)
                it.putExtra(PushActionReceiver.EXTRA_ACTION_TOKEN, readToken)
                it.putExtra(PushActionReceiver.EXTRA_ACTION_ID, readActionId)
                it.putExtra(PushActionReceiver.EXTRA_NOTIFICATION_ID, id)
            }
            builder.addAction(
                NotificationCompat.Action.Builder(0, "Tandai dibaca", readIntent)
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
                    .build()
            )
        }

        notify(id, builder.build())
    }

    // --------------------------------------------- event umum (tanpa chat)

    /**
     * Tugas penyiapan, penjualan/pesanan, hutang, dan pemberitahuan umum TIDAK
     * memiliki conversationId. Notifikasi tetap tampil dan tetap membuka rute.
     */
    private fun handleGeneric(data: Map<String, String>) {
        val kind = data["kind"] ?: "general"
        val group = data["group"] ?: kind
        val route = data["route"] ?: "/"
        val id = notificationId("$kind:$group")
        val channel = McmNotifications.channelFor(data["channel"], kind)

        val builder = NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.drawable.ic_stat_mcm)
            .setContentTitle(data["title"] ?: "MCM")
            .setContentText(data["body"] ?: "Ada pembaruan baru di MCM")
            .setStyle(NotificationCompat.BigTextStyle().bigText(data["body"] ?: ""))
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(route, id))

        notify(id, builder.build())
    }

    // ------------------------------------------------------------ panggilan

    private fun handleCall(data: Map<String, String>) {
        val callId = data["callId"] ?: return
        val allowPreview = data["preview"] != "0"
        val caller = if (allowPreview) (data["title"] ?: "Panggilan masuk") else "Panggilan masuk"
        // Jawab dan tolak memakai token BERBEDA; keduanya kedaluwarsa bersama dering.
        val answerToken = data["answerToken"]
        val answerActionId = data["answerActionId"]
        val declineToken = data["declineToken"]
        val declineActionId = data["declineActionId"]
        val id = notificationId("call:$callId")

        // Jawab = PendingIntent Activity langsung (tanpa trampoline receiver).
        val answer = answerActivityIntent(id + 2, callId, answerToken, answerActionId)
        val decline = immutableBroadcast(id + 3) {
            it.action = PushActionReceiver.ACTION_CALL_DECLINE
            it.putExtra(PushActionReceiver.EXTRA_RESOURCE, callId)
            it.putExtra(PushActionReceiver.EXTRA_ACTION_TOKEN, declineToken)
            it.putExtra(PushActionReceiver.EXTRA_ACTION_ID, declineActionId)
            it.putExtra(PushActionReceiver.EXTRA_NOTIFICATION_ID, id)
        }

        val builder = NotificationCompat.Builder(this, McmNotifications.CH_CALLS_INCOMING)
            .setSmallIcon(R.drawable.ic_stat_mcm)
            .setContentTitle(caller)
            .setContentText(if (allowPreview) (data["body"] ?: "Panggilan masuk") else "Panggilan masuk")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(answer)

        // Layar kunci tidak pernah menampilkan nama penelepon secara default:
        // isi lengkap PRIVATE, layar kunci melihat versi publik yang generik.
        builder.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        builder.setPublicVersion(genericCallNotification())

        // Full-screen intent hanya bila sistem benar-benar mengizinkan (API 34+).
        if (canUseFullScreenIntent()) builder.setFullScreenIntent(answer, true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // CallStyle memberi tampilan panggilan asli Android (12+).
            val person = Person.Builder().setName(caller).setImportant(true).build()
            builder.setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
        } else {
            builder.addAction(0, "Tolak", decline)
            builder.addAction(0, "Jawab", answer)
        }

        // Tidak ada foreground service saat berdering: Android 12+ melarang
        // memulai FGS dari latar. FGS mikrofon baru dimulai dari Activity
        // foreground setelah server menerima "answer".
        notify(id, builder.build())
    }

    private fun genericCallNotification(): Notification =
        NotificationCompat.Builder(this, McmNotifications.CH_CALLS_INCOMING)
            .setSmallIcon(R.drawable.ic_stat_mcm)
            .setContentTitle("MCM")
            .setContentText("Panggilan masuk")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()

    private fun canUseFullScreenIntent(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
        val nm = getSystemService(NotificationManager::class.java) ?: return false
        return nm.canUseFullScreenIntent()
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

    /** Jawab: Activity explicit + token sekali-pakai, IMMUTABLE & ONE_SHOT. */
    private fun answerActivityIntent(
        requestCode: Int,
        callId: String,
        actionToken: String?,
        actionId: String?,
    ): PendingIntent {
        val route = "/call/$callId"
        val intent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("https://mcmchat.id$route")
            putExtra(EXTRA_ROUTE, route)
            putExtra(EXTRA_ANSWER_CALL, callId)
            if (!actionId.isNullOrBlank()) putExtra(EXTRA_ANSWER_ACTION_ID, actionId)
            if (!actionToken.isNullOrBlank()) putExtra(EXTRA_ANSWER_TOKEN, actionToken)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            this, requestCode, intent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun immutableBroadcast(requestCode: Int, build: (Intent) -> Unit): PendingIntent =
        broadcast(requestCode, PendingIntent.FLAG_IMMUTABLE, build)

    /** MUTABLE HANYA untuk balas cepat (RemoteInput disisipkan sistem). */
    private fun mutableBroadcast(requestCode: Int, build: (Intent) -> Unit): PendingIntent =
        broadcast(requestCode, PendingIntent.FLAG_MUTABLE, build)

    private fun broadcast(requestCode: Int, mutability: Int, build: (Intent) -> Unit): PendingIntent {
        val intent = Intent(this, PushActionReceiver::class.java)
        build(intent)
        return PendingIntent.getBroadcast(
            this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or mutability
        )
    }
}
