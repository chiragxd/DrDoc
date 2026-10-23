import type { Plugin } from "vite";

/**
 * Emits /sw.js at build time with a precache list of every built asset,
 * so DrDoc keeps working offline after the first visit.
 * The large editor fonts are cached on first use instead of up front.
 */
export function serviceWorker(): Plugin {
  return {
    name: "drdoc-service-worker",
    apply: "build",
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map") && f !== "sw.js");
      const version = Date.now().toString(36);
      const precache = ["/", ...files.map((f) => "/" + f), "/favicon.svg", "/manifest.webmanifest", "/icon-192.png"];
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: SW.replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(precache)),
      });
    },
  };
}

const SW = `// DrDoc service worker (generated at build time)
const CACHE = "drdoc-__VERSION__";
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("drdoc-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // pages: network first so updates arrive, cache when offline
    if (req.mode === "navigate") {
      try {
        const res = await fetch(req);
        cache.put("/", res.clone());
        return res;
      } catch {
        return (await cache.match("/")) || Response.error();
      }
    }
    // hashed assets and fonts: cache first
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/"))) cache.put(req, res.clone());
    return res;
  })());
});
`;
