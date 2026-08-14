package com.mcm.privateconnect

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

/**
 * Channel notifikasi MCM.
 *
 * ID channel stabil dan sama persis dengan kontrak payload di
 * `src/lib/push/payload.ts`. Nama & deskripsi berbahasa Indonesia.
 */
object McmNotifications {

    const val CH_MESSAGES = "mcm_messages"
    const val CH_CALLS_INCOMING = "mcm_calls"
    const val CH_CALLS_ONGOING = "mcm_calls_ongoing"
    const val CH_TASKS = "mcm_tasks"
    const val CH_SALES = "mcm_sales"
    const val CH_LEDGER = "mcm_ledger"
    const val CH_GENERAL = "mcm_general"

    /** Semua channel yang WAJIB ada; dipakai juga oleh diagnostik Pengaturan. */
    val ALL = listOf(
        CH_MESSAGES, CH_CALLS_INCOMING, CH_CALLS_ONGOING,
        CH_TASKS, CH_SALES, CH_LEDGER, CH_GENERAL
    )

    fun ensure(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return

        fun channel(id: String, name: String, desc: String, importance: Int, block: (NotificationChannel) -> Unit = {}) {
            val ch = NotificationChannel(id, name, importance)
            ch.description = desc
            block(ch)
            nm.createNotificationChannel(ch)
        }

        channel(
            CH_MESSAGES, "Pesan", "Pesan chat masuk (pop-up di atas layar).",
            NotificationManager.IMPORTANCE_HIGH
        )
        channel(
            CH_CALLS_INCOMING, "Panggilan masuk",
            "Panggilan suara/video masuk. Tampil di layar kunci.",
            NotificationManager.IMPORTANCE_HIGH
        ) {
            it.setBypassDnd(true)
            it.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        }
        channel(
            CH_CALLS_ONGOING, "Panggilan aktif",
            "Notifikasi berjalan selama panggilan berlangsung.",
            NotificationManager.IMPORTANCE_LOW
        )
        channel(CH_TASKS, "Tugas Penyiapan", "Perintah penyiapan pegawai.", NotificationManager.IMPORTANCE_HIGH)
        channel(CH_SALES, "Penjualan & Pesanan", "Pembaruan pesanan dan penjualan.", NotificationManager.IMPORTANCE_DEFAULT)
        channel(CH_LEDGER, "Hutang & Pembayaran", "Pengingat hutang-piutang.", NotificationManager.IMPORTANCE_DEFAULT)
        channel(CH_GENERAL, "Umum", "Pemberitahuan lain dari MCM.", NotificationManager.IMPORTANCE_LOW)
    }

    /** Channel yang benar-benar terdaftar di sistem (untuk diagnostik jujur). */
    fun existing(context: Context): List<String> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return emptyList()
        val nm = context.getSystemService(NotificationManager::class.java) ?: return emptyList()
        return nm.notificationChannels.map { it.id }
    }
}
