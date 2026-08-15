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
      data: { route: d.route || "/", conversationId: d.conversationId || "" },
    });
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = (event.notification.data && event.notification.data.route) || "/";
  event.waitUntil(
    (async () => {
      const clientsArr = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clientsArr) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          c.postMessage({ type: "mcm-push-route", route });
          return;
        }
      }
      await self.clients.openWindow(route);
    })(),
  );
});
