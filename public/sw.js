// Minimal service worker: it controls the page (a Lighthouse PWA audit) and does nothing else.
// No precache, no offline copy: a journal of record must never serve a stale article from a
// browser cache. The empty fetch listener leaves every request to the network as normal.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
