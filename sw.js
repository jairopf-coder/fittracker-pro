// ═══════════════════════════════════════════════════════════
//  FitTracker Pro — Service Worker (sw.js)
//  v2: Añade caché del shell de la app para uso offline.
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = 'fittracker-v4';

// Archivos del shell que se cachean al instalar
const SHELL_FILES = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/firebase-config.js',
  '/manifest.json',
];

// ── Install: cachea el shell ─────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(SHELL_FILES).catch(err => {
        console.warn('[SW] No se pudo cachear algún archivo del shell:', err);
      });
    })
  );
});

// ── Activate: limpia cachés antiguas ────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Network first, fallback a caché ───────────────
//  Para las peticiones a Firebase/CDN externas nunca se cachean.
//  Para los archivos propios de la app: red primero, caché si falla.
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // No interceptar peticiones a Firebase, CDN o APIs externas
  if (
    url.includes('firebaseio.com') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    url.includes('api.anthropic') ||
    !url.startsWith(self.location.origin)
  ) {
    return; // dejar pasar sin intervenir
  }

  // Solo GET
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Guardamos una copia fresca en caché
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Sin red → sirve desde caché
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Si es navegación y no hay caché, devuelve index.html
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

// ── Message: recibe órdenes del cliente ─────────────────
const pendingTimers = new Map();

self.addEventListener('message', event => {
  const data = event.data;
  if (!data || !data.type) return;

  switch (data.type) {

    case 'SCHEDULE_NOTIFICATION': {
      const { delay = 0, title, body, tag } = data;
      if (pendingTimers.has(tag)) {
        clearTimeout(pendingTimers.get(tag));
        pendingTimers.delete(tag);
      }
      const timerId = setTimeout(() => {
        pendingTimers.delete(tag);
        self.registration.showNotification(title, {
          body, tag,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          vibrate: [200, 100, 200],
          requireInteraction: false,
          silent: false,
        });
      }, delay);
      pendingTimers.set(tag, timerId);
      break;
    }

    case 'SHOW_NOTIFICATION': {
      const { title, body, tag } = data;
      self.registration.showNotification(title, {
        body, tag,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [300, 100, 300],
        requireInteraction: false,
        silent: false,
      });
      break;
    }

    case 'CANCEL_ALL_NOTIFICATIONS': {
      for (const [tag, timerId] of pendingTimers) {
        clearTimeout(timerId);
        pendingTimers.delete(tag);
      }
      self.registration.getNotifications().then(notifications => {
        notifications.forEach(n => n.close());
      });
      break;
    }
  }
});

// ── Notificationclick ────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
