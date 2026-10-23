/** Promise-based access to the PDF worker: `await pdf.compress(bytes, opts)`. */
import type { Api } from "./host";

type Promisified<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const { id, ok, result, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(result);
    else p.reject(new Error(error));
  };
  worker.onerror = (e) => {
    const err = new Error("The PDF engine failed to start. Reload the page and try again.");
    console.error(e);
    pending.forEach((p) => p.reject(err));
    pending.clear();
    worker = null;
  };
  return worker;
}

function call(method: string, args: unknown[]) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, method, args });
  });
}

export const pdf = new Proxy({} as Promisified<Api>, {
  get: (_t, method: string) => (...args: unknown[]) => call(method, args),
});

/** Start loading the engine early (it's a few MB of WebAssembly). */
export function warmUp() {
  getWorker();
}
