/**
 * Invarian native Android untuk push & panggilan.
 *
 * Diuji langsung terhadap sumber Kotlin/manifest supaya regresi kebijakan
 * Android modern (trampoline, mutability, FGS phoneCall, full-screen intent)
 * tertangkap sebelum build native.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ANDROID = join(process.cwd(), "android/app/src/main");
const read = (p: string) => readFileSync(join(ANDROID, p), "utf8");

const delivery = read("java/com/mcm/privateconnect/PushDeliveryService.kt");
const receiver = read("java/com/mcm/privateconnect/PushActionReceiver.kt");
const worker = read("java/com/mcm/privateconnect/PushActionWorker.kt");
const channels = read("java/com/mcm/privateconnect/McmNotifications.kt");
const fgs = read("java/com/mcm/privateconnect/CallForegroundService.kt");
const plugin = read("java/com/mcm/privateconnect/McmPushPlugin.kt");
const manifest = read("AndroidManifest.xml");

describe("mutability PendingIntent", () => {
  it("hanya balas cepat yang MUTABLE", () => {
    const mutable = delivery.match(/FLAG_MUTABLE/g) ?? [];
    expect(mutable).toHaveLength(1);
    expect(delivery).toMatch(/mutableBroadcast\(id\)\s*{[\s\S]*?ACTION_REPLY/);
  });

  it("read, decline, content, dan answer selalu IMMUTABLE", () => {
    for (const fragment of ["ACTION_READ", "ACTION_CALL_DECLINE"]) {
      const idx = delivery.indexOf(fragment);
      expect(idx).toBeGreaterThan(-1);
      const before = delivery.slice(Math.max(0, idx - 400), idx);
      expect(before).toMatch(/immutableBroadcast/);
    }
    expect(delivery).toMatch(/getActivity\([\s\S]*?FLAG_IMMUTABLE/);
    expect(delivery).toMatch(/FLAG_ONE_SHOT or PendingIntent\.FLAG_IMMUTABLE/);
  });
});

describe("tidak ada notification trampoline", () => {
  it("receiver tidak pernah startActivity", () => {
    expect(receiver).not.toMatch(/startActivity/);
    expect(worker).not.toMatch(/startActivity/);
  });

  it("aksi jawab memakai PendingIntent Activity explicit ke MainActivity", () => {
    expect(delivery).toMatch(/answerActivityIntent/);
    expect(delivery).toMatch(/Intent\(this, MainActivity::class\.java\)/);
    expect(receiver).not.toMatch(/CALL_ANSWER/);
  });

  it("receiver tidak melakukan jaringan; retry lewat WorkManager", () => {
    expect(receiver).not.toMatch(/HttpURLConnection|goAsync/);
    expect(receiver).toMatch(/PushActionWorker\.enqueue/);
    expect(worker).toMatch(/class PushActionWorker/);
    expect(worker).toMatch(/Result\.retry\(\)/);
  });
});

describe("token aksi per notifikasi", () => {
  it("tidak ada bearer persisten di perangkat", () => {
    expect(plugin).not.toMatch(/ActionCredentials|EncryptedSharedPreferences/);
    expect(receiver).toMatch(/EXTRA_ACTION_TOKEN/);
    expect(delivery).toMatch(/data\["actionToken"\]/);
  });
});

describe("foreground service panggilan", () => {
  it("tidak memakai tipe/permission phoneCall", () => {
    expect(fgs).not.toMatch(/FOREGROUND_SERVICE_TYPE_PHONE_CALL/);
    expect(manifest).not.toMatch(/FOREGROUND_SERVICE_PHONE_CALL/);
    expect(manifest).toMatch(/android:foregroundServiceType="microphone"/);
  });

  it("FGS hanya dimulai dari Activity foreground setelah jawab", () => {
    expect(delivery).not.toMatch(/CallForegroundService\.start/);
    expect(receiver).not.toMatch(/CallForegroundService\.start/);
    expect(plugin).toMatch(/fun startCallForeground/);
  });
});

describe("full-screen intent & privasi panggilan", () => {
  it("full-screen intent bersyarat canUseFullScreenIntent", () => {
    expect(delivery).toMatch(/canUseFullScreenIntent\(\)/);
    expect(delivery).toMatch(/if \(canUseFullScreenIntent\(\)\) builder\.setFullScreenIntent/);
  });

  it("ada jalur setelan izin full-screen intent", () => {
    expect(plugin).toMatch(/ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT/);
  });

  it("notifikasi panggilan PRIVATE dengan publicVersion generik", () => {
    expect(delivery).toMatch(/setVisibility\(NotificationCompat\.VISIBILITY_PRIVATE\)/);
    expect(delivery).toMatch(/setPublicVersion\(genericCallNotification\(\)\)/);
  });

  it("channel panggilan tidak melewati Jangan Ganggu", () => {
    expect(channels).not.toMatch(/setBypassDnd\(true\)/);
    expect(channels).toMatch(/VISIBILITY_PRIVATE/);
  });
});

describe("event generik tanpa conversationId", () => {
  it("task/sale/ledger/general tetap tampil dan membuka rute", () => {
    expect(delivery).toMatch(/private fun handleGeneric/);
    expect(delivery).toMatch(/handleGeneric\(data\)/);
    const start = delivery.indexOf("private fun handleGeneric");
    const body = delivery.slice(start, delivery.indexOf("// ------------------------------------------------------------ panggilan", start));
    expect(body).not.toMatch(/conversationId/);
    expect(body).toMatch(/setContentIntent\(openAppIntent\(route, id\)\)/);
    expect(channels).toMatch(/fun channelFor/);
  });
});
