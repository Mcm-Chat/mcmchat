package com.mcm.privateconnect

/** Endpoint aksi latar MCM. Tidak memuat rahasia apa pun. */
object ApiConfig {
    const val ACTIONS_URL = "https://mcmchat.id/api/public/push/actions"
    const val CONNECT_TIMEOUT_MS = 10_000
    const val READ_TIMEOUT_MS = 15_000
    /** Percobaan ulang terkontrol saat jaringan sementara gagal. */
    const val MAX_ATTEMPTS = 3
}
