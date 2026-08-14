package com.mcm.privateconnect

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Receiver aksi notifikasi latar (Balas, Tandai dibaca, Jawab, Tolak).
 *
 * Tidak ada penulisan database langsung: semuanya melewati
 * `/api/public/push/actions` dengan kredensial aksi perangkat. Kredensial dan
 * isi balasan TIDAK PERNAH dicatat ke log.
 */
class PushActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_REPLY = "com.mcm.privateconnect.REPLY"
        const val ACTION_READ = "com.mcm.privateconnect.READ"
        const val ACTION_CALL_ANSWER = "com.mcm.privateconnect.CALL_ANSWER"
        const val ACTION_CALL_DECLINE = "com.mcm.privateconnect.CALL_DECLINE"

        const val EXTRA_CONVERSATION = "conversationId"
        const val EXTRA_CALL = "callId"
        const val EXTRA_ROUTE = "route"
        const val EXTRA_ACTION_TOKEN = "actionToken"
        const val EXTRA_ACTION_ID = "actionId"
        const val EXTRA_NOTIFICATION_ID = "notificationId"

        private val pool = Executors.newFixedThreadPool(2)
        private const val MAX_BODY = 4000
    }

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, 0)
        val pending = goAsync()

        pool.execute {
            try {
                when (intent.action) {
                    ACTION_REPLY -> doReply(app, intent, notificationId)
                    ACTION_READ -> doRead(app, intent, notificationId)
                    ACTION_CALL_ANSWER -> doCall(app, intent, "answer", notificationId, open = true)
                    ACTION_CALL_DECLINE -> doCall(app, intent, "decline", notificationId, open = false)
                }
            } finally {
                pending.finish()
            }
        }
    }

    // ------------------------------------------------------------- actions

    private fun doReply(context: Context, intent: Intent, notificationId: Int) {
        val conversationId = intent.getStringExtra(EXTRA_CONVERSATION) ?: return
        val raw = RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence(PushDeliveryService.KEY_REPLY_TEXT)?.toString()
        val body = raw?.trim().orEmpty()
        if (body.isEmpty()) {
            feedback(context, notificationId, "Balasan kosong tidak dikirim.")
            return
        }
        if (body.length > MAX_BODY) {
            feedback(context, notificationId, "Balasan terlalu panjang.")
            return
        }
        val token = intent.getStringExtra(EXTRA_ACTION_TOKEN)
        if (token.isNullOrBlank()) {
            feedback(context, notificationId, "Buka MCM untuk mengaktifkan balas cepat.")
            return
        }

        val payload = JSONObject()
            .put("action", "reply")
            .put("token", token)
            .put("conversationId", conversationId)
            .put("body", body)
            // Id aksi unik per notifikasi: retry receiver tidak menggandakan balasan.
            .put("actionId", actionId(intent, "reply"))

        val result = post(payload)
        if (result.ok) {
            NotificationManagerCompat.from(context).cancel(notificationId)
        } else {
            feedback(context, notificationId, failureText(result.error))
        }
    }

    private fun doRead(context: Context, intent: Intent, notificationId: Int) {
        val conversationId = intent.getStringExtra(EXTRA_CONVERSATION) ?: return
        val token = intent.getStringExtra(EXTRA_ACTION_TOKEN) ?: return
        val payload = JSONObject()
            .put("action", "read")
            .put("token", token)
            .put("conversationId", conversationId)
            .put("actionId", actionId(intent, "read"))
        if (post(payload).ok) NotificationManagerCompat.from(context).cancel(notificationId)
    }

    private fun doCall(context: Context, intent: Intent, action: String, notificationId: Int, open: Boolean) {
        val callId = intent.getStringExtra(EXTRA_CALL) ?: return
        val token = intent.getStringExtra(EXTRA_ACTION_TOKEN)
        NotificationManagerCompat.from(context).cancel(notificationId)

        var accepted = false
        if (!token.isNullOrBlank()) {
            accepted = post(
                JSONObject()
                    .put("action", action)
                    .put("token", token)
                    .put("callId", callId)
                    .put("actionId", actionId(intent, action))
            ).ok
        }

        if (open) {
            // FGS panggilan hanya dimulai setelah server menerima "answer".
            if (accepted) CallForegroundService.start(context, callId, "Panggilan aktif", ringing = false)
            context.startActivity(
                Intent(context, MainActivity::class.java).apply {
                    this.action = Intent.ACTION_VIEW
                    data = Uri.parse("https://mcmchat.id/call/$callId")
                    putExtra(PushDeliveryService.EXTRA_ROUTE, "/call/$callId")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                }
            )
        } else {
            CallForegroundService.stop(context)
        }
    }

    // ---------------------------------------------------------------- http

    private data class Result(val ok: Boolean, val error: String?)

    private fun post(payload: JSONObject): Result {
        var lastError: String? = "network"
        repeat(ApiConfig.MAX_ATTEMPTS) { attempt ->
            val outcome = attempt(payload)
            if (outcome.ok) return outcome
            lastError = outcome.error
            // Hanya kegagalan jaringan/5xx yang layak diulang.
            if (outcome.error != "network" && outcome.error != "server") return outcome
            Thread.sleep(500L * (attempt + 1))
        }
        return Result(false, lastError)
    }

    private fun attempt(payload: JSONObject): Result {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(ApiConfig.ACTIONS_URL).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = ApiConfig.CONNECT_TIMEOUT_MS
                readTimeout = ApiConfig.READ_TIMEOUT_MS
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
            val code = conn.responseCode
            when {
                code in 200..299 -> Result(true, null)
                code >= 500 -> Result(false, "server")
                code == 401 || code == 403 -> Result(false, "denied")
                else -> Result(false, "invalid")
            }
        } catch (_: Exception) {
            Result(false, "network")
        } finally {
            conn?.disconnect()
        }
    }

    /** Id aksi unik & stabil per notifikasi + jenis aksi. */
    private fun actionId(intent: Intent, suffix: String): String {
        val base = intent.getStringExtra(EXTRA_ACTION_ID)
            ?: UUID.nameUUIDFromBytes(
                (intent.getStringExtra(EXTRA_CONVERSATION)
                    ?: intent.getStringExtra(EXTRA_CALL) ?: "mcm").toByteArray()
            ).toString()
        return "$base:$suffix"
    }

    private fun failureText(error: String?): String = when (error) {
        "denied" -> "Balasan ditolak: percakapan ini hanya dapat dibaca."
        "server" -> "Server sedang bermasalah. Coba lagi dari aplikasi."
        else -> "Balasan gagal terkirim. Buka MCM untuk mencoba lagi."
    }

    /** Balasan yang gagal TIDAK pernah hilang diam-diam. */
    private fun feedback(context: Context, notificationId: Int, text: String) {
        McmNotifications.ensure(context)
        val n = NotificationCompat.Builder(context, McmNotifications.CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_mcm)
            .setContentTitle("MCM")
            .setContentText(text)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(notificationId + 900_000, n) }
    }
}
