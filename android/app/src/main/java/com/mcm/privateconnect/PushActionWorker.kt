package com.mcm.privateconnect

import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * Pekerjaan jaringan untuk aksi notifikasi latar (balas, tandai dibaca, tolak).
 *
 * BroadcastReceiver TIDAK boleh menahan proses 30–45 detik untuk jaringan, jadi
 * receiver hanya menjadwalkan worker ini. WorkManager yang menangani retry.
 * Token aksi bersifat sekali-pakai per notifikasi; server tetap menjadi sumber
 * kebenaran untuk replay (idempotencyKey/actionId).
 */
class PushActionWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    companion object {
        const val KEY_ACTION = "action"
        const val KEY_TOKEN = "token"
        const val KEY_CONVERSATION = "conversationId"
        const val KEY_CALL = "callId"
        const val KEY_BODY = "body"
        const val KEY_ACTION_ID = "actionId"
        const val KEY_NOTIFICATION_ID = "notificationId"

        private const val MAX_RUNS = 3

        fun enqueue(context: Context, data: Data, uniqueName: String) {
            val request = OneTimeWorkRequestBuilder<PushActionWorker>()
                .setInputData(data)
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniqueWork(uniqueName, ExistingWorkPolicy.KEEP, request)
        }
    }

    override fun doWork(): Result {
        val action = inputData.getString(KEY_ACTION) ?: return Result.failure()
        val token = inputData.getString(KEY_TOKEN) ?: return Result.failure()
        val actionId = inputData.getString(KEY_ACTION_ID) ?: return Result.failure()
        val notificationId = inputData.getInt(KEY_NOTIFICATION_ID, 0)

        val payload = JSONObject().put("action", action).put("token", token)
            .put("actionId", actionId)
        when (action) {
            "reply" -> {
                payload.put("conversationId", inputData.getString(KEY_CONVERSATION) ?: return Result.failure())
                payload.put("body", inputData.getString(KEY_BODY) ?: return Result.failure())
            }
            "read" -> payload.put("conversationId", inputData.getString(KEY_CONVERSATION) ?: return Result.failure())
            "decline" -> payload.put("callId", inputData.getString(KEY_CALL) ?: return Result.failure())
            else -> return Result.failure()
        }

        val outcome = post(payload)
        return when {
            outcome.ok -> {
                NotificationManagerCompat.from(applicationContext).cancel(notificationId)
                Result.success()
            }
            // Hanya jaringan/5xx yang layak diulang; token sekali-pakai bisa kedaluwarsa.
            (outcome.error == "network" || outcome.error == "server") && runAttemptCount < MAX_RUNS ->
                Result.retry()
            else -> {
                if (action == "reply") feedback(notificationId, failureText(outcome.error))
                Result.failure()
            }
        }
    }

    // ---------------------------------------------------------------- http

    private data class Outcome(val ok: Boolean, val error: String?)

    private fun post(payload: JSONObject): Outcome {
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
                code in 200..299 -> Outcome(true, null)
                code >= 500 -> Outcome(false, "server")
                code == 401 || code == 403 -> Outcome(false, "denied")
                else -> Outcome(false, "invalid")
            }
        } catch (_: Exception) {
            Outcome(false, "network")
        } finally {
            conn?.disconnect()
        }
    }

    private fun failureText(error: String?): String = when (error) {
        "denied" -> "Balasan ditolak: percakapan ini hanya dapat dibaca."
        "server" -> "Server sedang bermasalah. Coba lagi dari aplikasi."
        else -> "Balasan gagal terkirim. Buka MCM untuk mencoba lagi."
    }

    /** Balasan yang gagal TIDAK pernah hilang diam-diam. */
    private fun feedback(notificationId: Int, text: String) {
        McmNotifications.ensure(applicationContext)
        val n = NotificationCompat.Builder(applicationContext, McmNotifications.CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_mcm)
            .setContentTitle("MCM")
            .setContentText(text)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(applicationContext).notify(notificationId + 900_000, n) }
    }
}
