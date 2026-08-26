// -------------------------------------------------------------------
// Service worker - push notifications only.
//
// This deliberately does NOT cache anything. A caching service worker on an
// app whose pages are all session-scoped and server-rendered is a way to
// serve one person's page to the next person who opens the browser, and to
// keep serving a stale build after a deploy. Push needs a service worker;
// it does not need a cache, so there is not one.
//
// It is served from /sw.js, at the root, because a service worker can only
// control pages at or below its own path.
// -------------------------------------------------------------------

// Take over as soon as it is installed rather than waiting for every tab
// using the old one to close. There is no cached state to migrate, so there
// is nothing an immediate handover can break.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// -------------------------------------------------------------------
// A push arrived.
//
// The payload is JSON the server encrypted for this device. It carries a
// title, a line of text and a path - never anything from the meeting
// itself, because this is displayed on a locked screen.
//
// The browser REQUIRES a visible notification for every push, because the
// subscription was made with userVisibleOnly. Swallowing one silently gets
// the subscription revoked, so the catch below still shows something.
// -------------------------------------------------------------------
self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload is still a push, and still has to be shown.
  }

  const title = payload.title || "Notification";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/logo.png",
      badge: "/logo.png",
      // Groups related notifications so a newer one about the same thing
      // replaces the older rather than stacking up on the lock screen.
      tag: payload.tag || undefined,
      // The path to open, carried through to the click handler below.
      data: { url: payload.url || "/" },
    }),
  );
});

// -------------------------------------------------------------------
// The notification was tapped.
//
// Focuses an existing window on this origin if there is one, rather than
// opening a second copy of the app - which on a phone is what makes the
// difference between "it opened my app" and "it opened another tab".
//
// The URL is only ever a path on this origin. The page it lands on does its
// own session check; arriving from a notification proves nothing.
// -------------------------------------------------------------------
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }

      return self.clients.openWindow(target);
    }),
  );
});
