// ═══════════════════════════════════════════════════════════
//  FitTracker Pro — Service Worker (sw.js)
//  Gestiona notificaciones push locales sin servidor externo.
//  El cliente envía mensajes via postMessage con los datos
//  de cada notificación; el SW se encarga de mostrarlas.
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = 'fittracker-v3';

// ── Install: activa el SW inmediatamente sin esperar ────────
self.addEventListener('install', () => {
  self.skipWaiting();
});

// ── Activate: toma el control de todas las pestañas ─────────
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// ── Message: recibe órdenes del cliente ─────────────────────
//
// Formatos aceptados:
//
//  { type: 'SCHEDULE_NOTIFICATION', delay: <ms>, title: '...', body: '...', tag: '...' }
//    → Programa una notificación con setTimeout dentro del SW.
//      El 'tag' permite reemplazar/cancelar duplicados.
//
//  { type: 'SHOW_NOTIFICATION', title: '...', body: '...', tag: '...' }
//    → Muestra la notificación de forma inmediata (delay 0).
//
//  { type: 'CANCEL_ALL_NOTIFICATIONS' }
//    → Cierra todas las notificaciones visibles y limpia los
//      timers pendientes del grupo 'fittracker-session-*'.
//
// ────────────────────────────────────────────────────────────

// Mapa de timers activos: tag → timeoutId
const pendingTimers = new Map();

self.addEventListener('message', event => {
  const data = event.data;
  if (!data || !data.type) return;

  switch (data.type) {

    // ── Programar notificación con retraso ──────────────────
    case 'SCHEDULE_NOTIFICATION': {
      const { delay = 0, title, body, tag } = data;

      // Si ya había un timer con ese tag, cancelarlo
      if (pendingTimers.has(tag)) {
        clearTimeout(pendingTimers.get(tag));
        pendingTimers.delete(tag);
      }

      const timerId = setTimeout(() => {
        pendingTimers.delete(tag);
        self.registration.showNotification(title, {
          body,
          tag,                        // evita duplicados si llega tarde
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

    // ── Notificación inmediata ──────────────────────────────
    case 'SHOW_NOTIFICATION': {
      const { title, body, tag } = data;
      self.registration.showNotification(title, {
        body,
        tag,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [300, 100, 300],
        requireInteraction: false,
        silent: false,
      });
      break;
    }

    // ── Cancelar todo ───────────────────────────────────────
    case 'CANCEL_ALL_NOTIFICATIONS': {
      // Limpiar timers pendientes
      for (const [tag, timerId] of pendingTimers) {
        clearTimeout(timerId);
        pendingTimers.delete(tag);
      }
      // Cerrar notificaciones ya visibles del grupo fittracker
      self.registration.getNotifications().then(notifications => {
        notifications.forEach(n => n.close());
      });
      break;
    }
  }
});

// ── Notificationclick: al pulsar una notificación ───────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Si la app ya está abierta, enfocarla
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      // Si no, abrirla
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
