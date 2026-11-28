self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Pass-through network fetch only: never cache live snapshots or API responses
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
});
