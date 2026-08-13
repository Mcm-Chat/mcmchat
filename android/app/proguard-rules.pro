# Capacitor bridge dipanggil lewat refleksi/JS: jangan di-obfuscate.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * { @com.getcapacitor.PluginMethod public <methods>; }
-keep class com.mcm.privateconnect.** { *; }

# Firebase Cloud Messaging
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**

# LiveKit / WebRTC (JNI)
-keep class org.webrtc.** { *; }
-keep class io.livekit.** { *; }
-dontwarn io.livekit.**
-dontwarn org.webrtc.**

# Kotlin coroutines & serialization
-dontwarn kotlinx.**
