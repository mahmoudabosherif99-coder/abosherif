// ========== Service Worker: مزارع أبوشريف ==========
// مسؤول عن استقبال إشعارات Push من السيرفر وعرضها حتى لو البرنامج مقفول تماماً

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// وصول إشعار جديد من السيرفر
self.addEventListener("push", (event) => {
  let payload = { title: "🔔 مزارع أبوشريف", body: "في تحديث جديد على البرنامج" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    dir: "rtl",
    lang: "ar",
    vibrate: [120, 60, 120],
    data: { url: payload.url || "/" },
    tag: payload.tag || undefined,
    renotify: !!payload.tag,
  };

  event.waitUntil(self.registration.showNotification(payload.title || "🔔 مزارع أبوشريف", options));
});

// عند الضغط على الإشعار: يفتح البرنامج (أو يركز عليه لو مفتوح بالفعل)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
