// Cache: abre mesmo com Wi-Fi instável. Arquivos do app: tenta a versão nova primeiro.
// Ouvido offline (biblioteca + modelo, ~36 MB): cache separado, não some quando o app atualiza.
const CACHE = 'bit-v16', BIGCACHE = 'bit-big';
const FILES = ['./', 'index.html', 'bit.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'mic-worklet.js'];
const BIG = /\/(vosk\.js|vosk-pt\.tar\.gz)$/;
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== BIGCACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // API do Claude e da Groq passam direto
  if (url.pathname.endsWith('version.txt')) return; // verificação de versão: sempre da rede
  if (BIG.test(url.pathname)) {
    e.respondWith(caches.open(BIGCACHE).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }))));
    return;
  }
  // cache: 'no-cache' = sempre confere com o servidor se tem versão nova (o GitHub guarda 10 min senão)
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
