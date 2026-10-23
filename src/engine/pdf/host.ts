/// <reference lib="webworker" />
/**
 * The engine side of the PDF worker (loaded by worker.ts once MuPDF is ready).
 * Messages: { id, method, args } -> { id, ok, result } | { id, ok: false, error }
 */
import * as E from "./core";

E.setFontLoader(async (file) => {
  const res = await fetch(`/fonts/${file}`);
  if (!res.ok) throw new E.EngineError(`Missing font ${file}`);
  return new Uint8Array(await res.arrayBuffer());
});

// documents kept open between calls (thumbnails, editor)
const docs = new Map<number, ReturnType<typeof E.openPdf>>();
const editors = new Map<number, E.PdfEditor>();
let nextId = 1;

export const api = {
  info: E.pdfInfo,
  compose: E.compose,
  split: E.split,
  compress: E.compress,
  pageNumbers: E.pageNumbers,
  watermark: E.watermark,
  protect: E.protect,
  unlock: E.unlock,
  repair: E.repair,
  grayscale: E.grayscale,
  imagesToPdf: E.imagesToPdf,
  reflowToPdf: E.reflowToPdf,
  extractText: E.extractText,
  toHtml: E.toHtml,
  structure: E.structure,
  render: (bytes: Uint8Array, index: number, o: Parameters<typeof E.renderPage>[2]) => E.renderPage(bytes, index, o),

  open(bytes: Uint8Array, password = "") {
    const id = nextId++;
    docs.set(id, E.openPdf(bytes, password));
    return { id, info: E.pdfInfo(bytes, password) };
  },
  renderOpen(id: number, index: number, o: Parameters<typeof E.renderPage>[2]) {
    const doc = docs.get(id);
    if (!doc) throw new E.EngineError("Document was closed.");
    return E.renderPage(doc, index, o);
  },
  close(id: number) {
    docs.delete(id);
    editors.delete(id);
  },

  editorOpen(bytes: Uint8Array, password = "") {
    const id = nextId++;
    const ed = new E.PdfEditor(bytes, password);
    editors.set(id, ed);
    return { id, pages: ed.pageSizes() };
  },
  editorLines: (id: number, page: number) => editor(id).lines(page),
  editorFonts: (id: number) => editor(id).fonts(),
  editorApply: async (id: number, ops: E.EditOp[]) => {
    await editor(id).apply(ops);
    return true;
  },
  editorRender: (id: number, page: number, scale: number) => editor(id).render(page, scale),
  editorSave: (id: number) => editor(id).save(),
};

function editor(id: number) {
  const ed = editors.get(id);
  if (!ed) throw new E.EngineError("The editor session has ended. Open the file again.");
  return ed;
}

export type Api = typeof api;

function transferables(value: unknown, out: Transferable[] = [], depth = 0): Transferable[] {
  if (depth > 5 || !value || typeof value !== "object") return out;
  if (value instanceof Uint8Array) {
    if (!out.includes(value.buffer)) out.push(value.buffer as ArrayBuffer);
  } else if (Array.isArray(value)) value.forEach((v) => transferables(v, out, depth + 1));
  else Object.values(value).forEach((v) => transferables(v, out, depth + 1));
  return out;
}

// Handle messages strictly in order: an edit that awaits a font must finish
// before the next render of that page starts.
let queue: Promise<void> = Promise.resolve();
export function enqueue(e: MessageEvent) {
  queue = queue.then(() => handle(e));
}

async function handle(e: MessageEvent) {
  const { id, method, args } = e.data;
  try {
    const fn = (api as Record<string, (...a: unknown[]) => unknown>)[method];
    if (!fn) throw new Error(`Unknown method ${method}`);
    const result = await fn(...args);
    (self as unknown as Worker).postMessage({ id, ok: true, result }, transferables(result));
  } catch (err) {
    const message = err instanceof E.EngineError ? err.message : friendly(err);
    (self as unknown as Worker).postMessage({ id, ok: false, error: message, code: (err as E.EngineError)?.code });
  }
}

function friendly(err: unknown) {
  const msg = String((err as Error)?.message ?? err);
  if (/password/i.test(msg)) return "This PDF is password protected.";
  if (/cannot (open|find|recognize)|no objects found|not a pdf|syntax/i.test(msg)) return "This file looks damaged or isn't the type expected.";
  console.error(err);
  return "Something went wrong while processing the file.";
}
