/** Shared print stylesheet for documents we lay out into PDF pages. */
export const DOC_CSS = `
@page { margin: 20mm 18mm; }
body { font-family: sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1f2328; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 14pt 0 6pt; font-weight: bold; }
h1 { font-size: 20pt; } h2 { font-size: 15pt; } h3 { font-size: 12.5pt; } h4, h5, h6 { font-size: 11pt; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 7pt; padding-left: 18pt; }
li { margin: 0 0 2pt; }
a { color: #0b62c4; text-decoration: underline; }
code { font-family: monospace; font-size: 9pt; background-color: #f2f2f0; }
pre { font-family: monospace; font-size: 9pt; background-color: #f5f5f3; padding: 8pt 10pt; margin: 0 0 8pt; white-space: pre-wrap; }
pre code { background-color: transparent; }
blockquote { margin: 0 0 8pt; padding: 0 0 0 10pt; border-left: 3pt solid #d0d0cc; color: #555; }
table { border-collapse: collapse; margin: 4pt 0 10pt; }
th, td { border: 0.6pt solid #b9b9b4; padding: 3pt 6pt; vertical-align: top; text-align: left; }
th { background-color: #f2f2ef; font-weight: bold; }
img { max-width: 100%; }
hr { border: 0; border-top: 0.6pt solid #ccc; margin: 10pt 0; }
.title { font-size: 24pt; margin-top: 0; }
.subtitle { font-size: 13pt; color: #555; }
`;

export function htmlDocument(body: string, title = "Document", css = DOC_CSS) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

/** A styled standalone page for viewing in a browser (screen CSS). */
export function webPage(body: string, title: string) {
  const css = `body{font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2328;max-width:46rem;margin:3rem auto;padding:0 1.25rem}
h1,h2,h3{line-height:1.25;margin:2rem 0 .75rem}h1{font-size:2rem}h2{font-size:1.5rem;border-bottom:1px solid #e5e5e3;padding-bottom:.3rem}
code{font:.875em ui-monospace,Consolas,monospace;background:#f3f3f1;padding:.15em .35em;border-radius:4px}
pre{background:#f6f6f4;padding:1rem;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:0;padding:0 1rem;border-left:4px solid #ddd;color:#555}table{border-collapse:collapse}
th,td{border:1px solid #ddd;padding:.4rem .75rem}th{background:#f6f6f4}img{max-width:100%}a{color:#0b62c4}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
