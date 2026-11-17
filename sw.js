/* SIREXE · service worker.
   Rôle : garder l'application dans le téléphone pour qu'elle s'ouvre SANS internet.
   Il ne touche jamais aux contacts (stockés dans IndexedDB) et n'intercepte jamais api.github.com.
   Mise à jour : changer VERSION ; la nouvelle version s'installe seule (skipWaiting) et l'application se recharge, sauf pendant une saisie. */
var VERSION = "sirexe-v1-5";
var FICHIERS = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest",
  "data/exposants.json", "data/selection.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
  "plans/hall1.png", "plans/hall2.png", "plans/esplanade.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    // allSettled : un fichier optionnel manquant (ex. selection.json) ne bloque pas l'installation
    return Promise.all(FICHIERS.map(function (u) {
      return c.add(new Request(u, { cache: "reload" })).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));   // installation immédiate : Daouda voit chaque publication sans rien faire
});

self.addEventListener("message", function (e) { if (e.data === "activer") self.skipWaiting(); });

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (noms) {
    return Promise.all(noms.filter(function (n) { return n !== VERSION; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== self.location.origin) return;   // GitHub et tout autre site : jamais interceptés
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    return fetch(r).catch(function () {
      if (r.mode === "navigate") return caches.match("index.html");
      return new Response("", { status: 504 });
    });
  }));
});
