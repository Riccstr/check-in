// Custom service worker code injected via injectManifest-style approach
// This file is imported by the generated SW via workbox config

// Log SW lifecycle
self.addEventListener('install', (event) => {
  console.log('[SW] Installing new service worker...');
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Service worker activated');
});
