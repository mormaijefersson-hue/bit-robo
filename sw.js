// Cache: abre mesmo com Wi-Fi instável. Arquivos do app: tenta a versão nova primeiro.
// Ouvido offline (biblioteca + modelo, ~36 MB): baixa uma vez só e fica guardado.
const CACHE = 'bit-v12';
const FILES = ['./', 'index.html', 'bit.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const BIG = /\/(vosk\.js|vosk-pt\.tar\.gz)$/;
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // API do Claude passa direto
  if (BIG.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    })));
    return;
  }
  // cache: 'no-cache' = sempre confere com o servidor se tem versão nova (o GitHub guarda 10 min senão)
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
