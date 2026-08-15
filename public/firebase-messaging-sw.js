/* Service worker pesan latar MCM (Firebase Cloud Messaging Web).
 * BUKAN app-shell cache: tidak pernah meng-cache HTML/asset.
 * Konfigurasi Firebase (publik) dikirim lewat query string saat registrasi. */
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

const q = new URL(self.location.href).searchParams;
const config = {
  apiKey: q.get("apiKey") || "",
  projectId: q.get("projectId") || "",
  messagingSenderId: q.get("senderId") || "",
  appId: q.get("appId") || "",
};

/** Rute internal aman dari payload; sejajar dengan routeFromPush() di aplikasi. */
function routeFromData(d) {
  const raw = d.route || "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  if (d.kind === "call") return d.callId ? `/call/${d.callId}` : "/calls";
  if (d.kind === "message")
    return d.conversationId
      ? `/chat/${d.conversationId}${d.messageId ? `?m=${d.messageId}` : ""}`
      : "/chat";
  if (d.kind === "task_assigned" || d.kind === "task_completed")
    return d.jobId ? `/tasks/${d.jobId}` : "/tasks";
  if (d.kind === "sale" || d.kind === "order") return d.orderId ? `/catalog/${d.orderId}` : "/finance";
  if (d.kind === "ledger") return d.ledgerId ? `/ledger/${d.ledgerId}` : "/finance";
  return "/chat";
}

if (config.apiKey && config.appId && config.messagingSenderId) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const d = payload.data || {};
    if (d.kind === "call_end") {
      self.registration.getNotifications({ tag: d.group || d.callId }).then((ns) => {
        for (const n of ns) n.close();
      });
      return;
    }
    const title = d.title || "MCM";
    self.registration.showNotification(title, {
      body: d.body || "",
      tag: d.group || d.conversationId || d.callId || "mcm",
      renotify: true,
      icon: "/icon-512.png",
      badge: "/favicon.png",
      silent: d.sound === "0",
      vibrate: d.vibrate === "0" ? undefined : [120, 60, 120],
      requireInteraction: d.kind === "call",
      data: {
        route: routeFromData(d),
        conversationId: d.conversationId || "",
        callId: d.callId || "",
      },
    });
  });
}

/** Kirim rute ke tab dan tunggu konfirmasi; false bila aplikasi belum siap. */
function deliverRoute(client, route) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      if (event.data && event.data.type === "mcm-push-route-ack") finish(true);
    };
    setTimeout(() => finish(false), 900);
    try {
      client.postMessage({ type: "mcm-push-route", route }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const route = typeof data.route === "string" && data.route.startsWith("/") && !data.route.startsWith("//")
    ? data.route
    : "/chat";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const sameOrigin = all.filter((c) => {
        try {
          return new URL(c.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      // Tab yang terlihat lebih dulu, agar rute mendarat di jendela yang dipakai.
      sameOrigin.sort((a, b) => (a.visibilityState === "visible" ? -1 : 0) - (b.visibilityState === "visible" ? -1 : 0));

      for (const client of sameOrigin) {
        try {
          await client.focus();
        } catch {
          /* fokus bisa ditolak; tetap coba kirim rute */
        }
        // Aplikasi hidup → navigasi in-app tanpa reload.
        if (await deliverRoute(client, route)) return;
        // Tab ada tapi belum siap (masih memuat / SW baru) → paksa buka rute.
        if (typeof client.navigate === "function") {
          try {
            await client.navigate(route);
            return;
          } catch {
            /* lanjut ke kandidat berikutnya */
          }
        }
      }
      await self.clients.openWindow(route);
    })(),
  );
});
