/// <reference lib="webworker" />
/**
 * PDF worker entry. MuPDF instantiates its WebAssembly with a top-level await,
 * and messages that arrive before a module worker installs its handler are
 * dropped. So we start listening right away, queue early messages, and hand
 * them to the engine once it has loaded.
 */
const backlog: MessageEvent[] = [];
let handle: ((e: MessageEvent) => void) | null = null;

self.onmessage = (e: MessageEvent) => (handle ? handle(e) : backlog.push(e));

import("./host")
  .then((host) => {
    handle = host.enqueue;
    backlog.splice(0).forEach(handle);
  })
  .catch((err) => {
    console.error(err);
    const error = "The PDF engine couldn't load. Check your connection and reload the page.";
    handle = (e) => (self as unknown as Worker).postMessage({ id: e.data.id, ok: false, error });
    backlog.splice(0).forEach(handle);
  });
