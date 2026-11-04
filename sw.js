/* SafetyAlert - Service Worker: recibe las notificaciones aunque la app esté cerrada */
importScripts('config.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

const CACHE = 'safetyalert-v1';
const ARCHIVOS = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

try {
  firebase.initializeApp(SA_CONFIG.firebase);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => mostrar(payload.data || {}));
} catch (e) { /* config aún sin completar */ }

function mostrar(d) {
  const esAlerta = d.tipoMsg === 'alerta';
  const sim = d.tipo === 'Simulacro';
  return self.registration.showNotification(d.titulo || 'SafetyAlert', {
    body: d.cuerpo || '',
    icon: 'icons/icon-192.png',
    tag: 'sa-' + (d.alertaId || d.reporteId || 'msg'),
    renotify: true,
    requireInteraction: esAlerta,
    silent: false,
    vibrate: esAlerta ? [600, 200, 600, 200, 600, 200, 600, 200, 600] : [200, 100, 200],
    data: d,
    actions: esAlerta ? [
      { action: 'Asiste', title: sim ? '✅ Participo' : '✅ Asisto' },
      { action: 'FueraDePlanta', title: '🚫 Fuera de planta' }
    ] : []
  });
}

function leerCred() {
  return new Promise((resolve) => {
    const r = indexedDB.open('sa-db', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => resolve(null);
    r.onsuccess = () => {
      try {
        const g = r.result.transaction('kv').objectStore('kv').get('cred');
        g.onsuccess = () => resolve(g.result || null);
        g.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    };
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  event.waitUntil((async () => {
    // Botones de la notificación: responder sin abrir la app (Android/escritorio)
    if ((event.action === 'Asiste' || event.action === 'FueraDePlanta') && d.alertaId) {
      const c = await leerCred();
      if (c) {
        try {
          const r = await fetch(c.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ accion: 'alertaResponder', token: c.token, datos: { alertaId: d.alertaId, respuesta: event.action } }) });
          const j = await r.json();
          if (j.ok) {
            await self.registration.showNotification('Respuesta registrada', {
              body: event.action === 'Asiste' ? 'Quedó registrado que ASISTES.' : 'Quedó registrado que estás FUERA DE PLANTA.',
              icon: 'icons/icon-192.png', tag: 'sa-ok'
            });
            return;
          }
        } catch (e) { /* si falla, abrimos la app */ }
      }
    }
    const lista = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of lista) {
      if ('focus' in c) { await c.focus(); c.postMessage({ tipo: 'abrirAlerta', alertaId: d.alertaId }); return; }
    }
    await clients.openWindow(d.alertaId ? './?alerta=' + encodeURIComponent(d.alertaId) : './');
  })());
});

// ---------- caché sencilla para abrir sin conexión (red primero) ----------
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      const copia = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
