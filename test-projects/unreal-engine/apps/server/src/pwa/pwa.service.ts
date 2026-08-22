import { Injectable } from '@nestjs/common';
import { generateManifest, WebAppManifest } from './manifest';

@Injectable()
export class PwaService {
  /**
   * Generate service worker JavaScript content.
   */
  generateServiceWorker(options: {
    cacheName?: string;
    staticAssets?: string[];
    offlineFallback?: string;
  } = {}): string {
    const cacheName = options.cacheName ?? 'web-engine-pwa-v1';
    const staticAssets = options.staticAssets ?? [
      '/', '/index.html', '/main.js', '/style.css', '/manifest.json',
    ];
    const offlineFallback = options.offlineFallback ?? '/index.html';

    return `const CACHE_NAME = '${cacheName}';
const DYNAMIC_CACHE = '${cacheName}-dynamic';

const STATIC_ASSETS = ${JSON.stringify(staticAssets)};

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME && k !== DYNAMIC_CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (req.headers.get('Accept')?.includes('text/html')) {
    e.respondWith(
      fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(DYNAMIC_CACHE).then((c) => c.put(req, clone));
        return res;
      }).catch(() => caches.match(req) || caches.match('${offlineFallback}'))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(DYNAMIC_CACHE).then((c) => c.put(req, clone));
        return res;
      }).catch(() => new Response('Offline', { status: 503 }))
    )
  );
});`;
  }

  /**
   * Generate a Web App Manifest object for a project.
   */
  generateManifest(options: {
    name: string;
    description?: string;
    themeColor?: string;
    backgroundColor?: string;
    display?: WebAppManifest['display'];
    orientation?: WebAppManifest['orientation'];
    icons?: WebAppManifest['icons'];
    scope?: string;
    startUrl?: string;
  }): WebAppManifest {
    return generateManifest(options);
  }

  /**
   * Generate the registration script for PWA.
   */
  generateRegistrationScript(swPath: string = 'sw.js'): string {
    return `if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('${swPath}')
      .then((reg) => {
        console.log('[PWA] Service Worker registered:', reg.scope);
        reg.onupdatefound = () => {
          const installing = reg.installing;
          if (installing) {
            installing.onstatechange = () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] New version available; refresh to update.');
              }
            };
          }
        };
      })
      .catch((err) => console.error('[PWA] Service Worker registration failed:', err));
  });
}`;
  }

  /**
   * Generate the full PWA HTML tags (manifest link + registration script).
   */
  generatePwaHtmlTags(manifestPath: string = 'manifest.json', swPath: string = 'sw.js'): string {
    return `<link rel="manifest" href="${manifestPath}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Web Engine">
<link rel="apple-touch-icon" href="/icon-192.png">
<script>${this.generateRegistrationScript(swPath)}</script>`;
  }
}
