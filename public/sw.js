/*
 * Service worker do Momentoos.
 *
 * Objetivo: o app abre e funciona sem internet depois da primeira visita
 * completa, sem servir uma versão antiga quando há rede.
 *
 * - Navegação: rede primeiro; se falhar, usa o index.html guardado.
 * - Arquivos do app (JS, CSS, fontes internas): cache primeiro, porque o Vite
 *   gera nomes com hash e uma versão nova usa nomes novos.
 * - Requisições de outros domínios (ex.: YouTube) não passam por aqui.
 */
const CACHE = 'momentoos-v1';
const INDEX = new URL('./index.html', self.registration.scope).href;
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(CORE.map((url) => cache.add(url).catch(() => {})));
      // O primeiro carregamento acontece antes de o service worker controlar a
      // página, então os arquivos com hash do build ainda não passaram por ele.
      // Lê o index.html e guarda os arquivos que ele cita.
      try {
        const index = await fetch(new URL('./index.html', self.registration.scope), { cache: 'no-store' });
        if (index.ok) {
          const html = await index.clone().text();
          await cache.put(INDEX, index.clone());
          const urls = new Set();
          for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
            const value = match[1];
            if (!value) continue;
            const url = new URL(value, self.registration.scope);
            if (url.origin === self.location.origin && url.href.startsWith(self.registration.scope)) urls.add(url.href);
          }
          await Promise.all([...urls].map((url) => cache.add(url).catch(() => {})));
        }
      } catch {
        // Sem rede durante a instalação: o que já foi guardado continua valendo.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            cache.put(request, fresh.clone());
            cache.put(INDEX, fresh.clone());
          }
          return fresh;
        } catch {
          return (
            (await cache.match(request, { ignoreVary: true })) ||
            (await cache.match(INDEX, { ignoreVary: true })) ||
            new Response(
              '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Momentoos</title><body style="font-family:system-ui;background:#08090b;color:#eef1f4;padding:32px;line-height:1.5"><h1>Sem conexão</h1><p>Abra o Momentoos uma vez com internet para guardar o app neste aparelho. Depois disso ele abre offline.</p></body>',
              { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            )
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreVary: true });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return new Response('', { status: 504, statusText: 'Sem conexão' });
      }
    })(),
  );
});
