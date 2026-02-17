// ---------------------------------------------------------------------------
// PulsePoint Service Worker — Offline Caching + Push Notifications
// ---------------------------------------------------------------------------
const CACHE_NAME = 'pulsepoint-v1';
const SHELL_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icons/icon-192.svg',
    '/icons/icon-512.svg',
    'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,500;1,700&display=swap',
];

// ---------------------------------------------------------------------------
// Install — cache the app shell
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching app shell');
            return cache.addAll(SHELL_ASSETS);
        })
    );
    // Activate immediately (don't wait for old tabs to close)
    self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate — clean up old caches
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            )
        )
    );
    // Take control of all pages immediately
    self.clients.claim();
});

// ---------------------------------------------------------------------------
// Fetch — Cache-first for shell, Network-first for API
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API requests: Network-first, fallback to cache
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Clone and cache the fresh API response
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => {
                    // Offline: serve from cache
                    return caches.match(event.request);
                })
        );
        return;
    }

    // Everything else: Cache-first, fallback to network
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                // Only cache same-origin and successful responses
                if (response.ok && url.origin === self.location.origin) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});

// ---------------------------------------------------------------------------
// Push — Display notification when server sends a push message
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
    let data = { title: 'PulsePoint', body: 'New breaking news available!' };
    try {
        data = event.data.json();
    } catch (e) {
        // Use defaults if payload isn't valid JSON
    }

    const options = {
        body: data.body || '',
        icon: '/icons/icon-192.svg',
        badge: '/icons/icon-192.svg',
        tag: 'pulsepoint-breaking',
        renotify: true,
        data: {
            url: data.url || '/',
        },
        actions: [
            { action: 'open', title: 'Read Now' },
            { action: 'dismiss', title: 'Dismiss' },
        ],
    };

    event.waitUntil(self.registration.showNotification(data.title || 'PulsePoint', options));
});

// ---------------------------------------------------------------------------
// Notification Click — Open the app or focus existing tab
// ---------------------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'dismiss') return;

    const targetUrl = event.notification.data?.url || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            // Focus an existing PulsePoint tab if open
            for (const client of clients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise open a new tab
            return self.clients.openWindow(targetUrl);
        })
    );
});
