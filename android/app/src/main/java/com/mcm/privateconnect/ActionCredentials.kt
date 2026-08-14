package com.mcm.privateconnect

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Penyimpanan kredensial aksi latar (`<prefix>.<secret>`) di Android Keystore.
 *
 * Nilai TIDAK PERNAH dicatat ke log, tidak pernah dikirim ke WebView, dan tidak
 * pernah dimasukkan ke payload notifikasi. Hanya receiver latar yang membacanya
 * untuk memanggil endpoint aksi tervalidasi.
 */
object ActionCredentials {

    private const val FILE = "mcm_secure_prefs"
    private const val KEY_ACTION_TOKEN = "action_token"

    private fun prefs(context: Context): SharedPreferences {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            FILE,
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun save(context: Context, token: String) {
        prefs(context).edit().putString(KEY_ACTION_TOKEN, token).apply()
    }

    fun read(context: Context): String? = runCatching {
        prefs(context).getString(KEY_ACTION_TOKEN, null)
    }.getOrNull()

    fun clear(context: Context) {
        runCatching { prefs(context).edit().remove(KEY_ACTION_TOKEN).apply() }
    }

    fun has(context: Context): Boolean = !read(context).isNullOrBlank()
}
