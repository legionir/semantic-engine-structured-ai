/// <reference lib="webworker" />

const CACHE_NAME = 'web-engine-pwa-v1';
const DYNAMIC_CACHE_NAME = 'web-engine-dynamic-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/main.js',
  '/style.css',
  '/manifest.json',
  '/scene.json',
  '/icon-192.png',
  '/icon-512.png',
];

// Install: cache static assets
self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      return (self as any).skipWaiting();
    })
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== DYNAMIC_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return (self as any).clients.claim();
    })
  );
});

// Fetch: network-first with cache fallback, cache dynamic resources
self.addEventListener('fetch', (event: FetchEvent) => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // HTML: network-first (always get latest)
  if (request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request) || caches.match('/index.html'))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request).then((response) => {
        const clone = response.clone();
        caches.open(DYNAMIC_CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      }).catch(() => {
        // Return a fallback for images
        if (request.destination === 'image') {
          return new Response('', { status: 200, headers: { 'Content-Type': 'image/png' } });
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Background sync for offline builds
self.addEventListener('sync', (event: SyncEvent) => {
  if (event.tag === 'sync-builds') {
    event.waitUntil(syncBuilds());
  }
});

async function syncBuilds(): Promise<void> {
  const db = await openIndexedDB();
  const pendingBuilds = await db.getAll('pendingBuilds');
  for (const build of pendingBuilds) {
    try {
      await fetch('/api/builds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(build),
      });
      await db.delete('pendingBuilds', build.id);
    } catch (err) {
      console.error('Failed to sync build:', err);
    }
  }
}

function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('WebEngineSync', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('pendingBuilds')) {
        db.createObjectStore('pendingBuilds', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
