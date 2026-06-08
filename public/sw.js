self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// Scheduled background notifications keyed by tag
const pending = new Map();

self.addEventListener('message', e => {
  const d = e.data;
  if (!d) return;

  if (d.type === 'NOTIFY') {
    self.registration.showNotification(d.title, {
      body: d.body,
      tag: d.tag || 'roman',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      vibrate: [200, 100, 200],
      requireInteraction: !!d.requireInteraction,
    });
  }

  if (d.type === 'SCHEDULE') {
    if (pending.has(d.tag)) clearTimeout(pending.get(d.tag));
    const id = setTimeout(() => {
      pending.delete(d.tag);
      self.registration.showNotification(d.title, {
        body: d.body,
        tag: d.tag,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        vibrate: [300, 100, 300, 100, 300],
        requireInteraction: true,
      });
    }, d.delay);
    pending.set(d.tag, id);
  }

  if (d.type === 'CANCEL') {
    if (pending.has(d.tag)) {
      clearTimeout(pending.get(d.tag));
      pending.delete(d.tag);
    }
  }
});

// Tap notification → focus or open the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      return clients.openWindow('/');
    })
  );
});
