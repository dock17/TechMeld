importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDGgQBiHQVa8z8khvrIKp392mc_d8dDEJU",
  authDomain: "techmeld.firebaseapp.com",
  projectId: "techmeld",
  storageBucket: "techmeld.firebasestorage.app",
  messagingSenderId: "460267327070",
  appId: "1:460267327070:web:8772a5e513bf912bb22ecf"
});

var messaging = firebase.messaging();

// Handle background FCM messages
messaging.onBackgroundMessage(function(payload) {
  var d = payload.data || {};
  var title = d.title || 'TechMeld';
  var body = d.body || 'Nieuwe melding';
  var tag = d.tag || 'techmeld-' + Date.now();
  return self.registration.showNotification(title, {
    body: body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: tag,
    vibrate: [200, 100, 200],
    data: { url: d.link || '/' }
  });
});

// Cache management
var CACHE_NAME = 'techmeld-v5';
var ASSETS = ['/manifest.json'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function(c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  // Network-first for HTML
  if (e.request.mode === 'navigate' || e.request.url.endsWith('.html')) {
    e.respondWith(fetch(e.request).catch(function() { return caches.match(e.request); }));
    return;
  }
  // Cache-first for other assets
  e.respondWith(caches.match(e.request).then(function(r) { return r || fetch(e.request); }));
});

// Handle notification click — open/focus app
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(function(cls) {
      for (var i = 0; i < cls.length; i++) {
        if (cls[i].url.includes('techmeld') && 'focus' in cls[i]) return cls[i].focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
