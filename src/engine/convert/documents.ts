import { marked } from "marked";
import { strFromU8, unzipSync } from "fflate";
import { pdf } from "../pdf/client";
import { htmlDocument, webPage, escapeHtml, decodeText } from "./html";
import { htmlToDocx } from "./html-to-docx";
import { bytesOf, ext, out, stem, type OutFile } from "../../lib/files";

const enc = new TextEncoder();

// ------------------------------------------------------------------ Word (via mammoth)

const STYLE_MAP = [
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Subtitle'] => p.subtitle:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p[style-name='Code'] => pre:separator('\\n')",
  "r[style-name='Code'] => code",
  "u => u",
  "strike => s",
];

async function mammoth() {
  return (await import("mammoth")).default;
}

function needsDocx(file: File) {
  if (ext(file.name) !== "docx") {
    throw new Error(`${file.name}: only .docx files are supported. Open it in Word or Google Docs and save as .docx first.`);
  }
}

/** Word -> semantic HTML. Images are embedded as data URIs unless a collector is given. */
export async function docxToHtml(file: File, collectImages?: (bytes: Uint8Array, type: string) => string) {
  needsDocx(file);
  const m = await mammoth();
  const opts: Record<string, unknown> = { styleMap: STYLE_MAP };
  if (collectImages) {
    opts.convertImage = m.images.imgElement(async (image: any) => {
      const b64 = await image.read("base64");
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return { src: collectImages(bin, image.contentType) };
    });
  }
  let html: string;
  const buffer = await file.arrayBuffer();
  try {
    html = (await m.convertToHtml({ arrayBuffer: buffer }, opts)).value as string;
  } catch {
    throw new Error(`${file.name} couldn't be read. Is it a valid Word document?`);
  }
  return sizeImages(html, new Uint8Array(buffer));
}

/** mammoth drops picture sizes; restore them from the document's drawing extents (in order). */
function sizeImages(html: string, docx: Uint8Array) {
  let xml = "";
  try {
    xml = strFromU8(unzipSync(docx, { filter: (f) => f.name === "word/document.xml" })["word/document.xml"]);
  } catch {
    return html;
  }
  const sizes = [...xml.matchAll(/<w:drawing>[\s\S]*?<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((m) => [+m[1] / 12700, +m[2] / 12700]);
  let i = 0;
  const MAX_W = 450; // pt: roughly the text width of A4 / Letter with normal margins
  return html.replace(/<img\b/g, (tag) => {
    const s = sizes[i++];
    if (!s || !s[0]) return tag;
    const k = Math.min(1, MAX_W / s[0]);
    return `${tag} style="width:${(s[0] * k).toFixed(1)}pt;height:${(s[1] * k).toFixed(1)}pt"`;
  });
}

export async function wordToPdf(file: File, o: { pageSize: string }) {
  const html = htmlDocument(await docxToHtml(file), stem(file.name));
  return out(`${stem(file.name)}.pdf`, await pdf.reflowToPdf(enc.encode(html), "text/html", { pageSize: o.pageSize }));
}

export async function wordToHtml(file: File) {
  return out(`${stem(file.name)}.html`, webPage(await docxToHtml(file), stem(file.name)));
}

export async function wordToText(file: File) {
  needsDocx(file);
  const m = await mammoth();
  const res = await m.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return out(`${stem(file.name)}.txt`, res.value.replace(/\n{3,}/g, "\n\n"));
}

export async function wordToMarkdown(file: File): Promise<OutFile[]> {
  const images: OutFile[] = [];
  const base = stem(file.name);
  const html = await docxToHtml(file, (bytes, type) => {
    const e = type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const name = `${base}_images/image${images.length + 1}.${e}`;
    images.push(out(name, bytes));
    return encodeURI(name); // Markdown links can't contain spaces
  });
  const md = await htmlToMarkdown(html);
  return [out(`${base}.md`, md), ...images];
}

async function htmlToMarkdown(html: string) {
  const TurndownService = (await import("turndown")).default;
  const { gfm } = await import("turndown-plugin-gfm");
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
  td.use(gfm);
  // "- item" rather than turndown's default "-   item"
  td.addRule("listItem", {
    filter: "li",
    replacement: (content, node) => {
      const parent = node.parentNode as HTMLElement;
      const ordered = parent.nodeName === "OL";
      const start = ordered ? Number(parent.getAttribute("start") || 1) : 0;
      const prefix = ordered ? `${start + [...parent.children].indexOf(node as HTMLElement)}. ` : "- ";
      const body = content.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/\n/gm, `\n${" ".repeat(prefix.length)}`);
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? "\n" : "");
    },
  });
  const dom = new DOMParser().parseFromString(html, "text/html");
  // Markdown table cells are one line: flatten paragraphs inside cells
  dom.querySelectorAll("td, th").forEach((cell) => {
    const paras = [...cell.children].filter((c) => c.tagName === "P");
    if (paras.length && paras.length === cell.children.length) cell.innerHTML = paras.map((p) => p.innerHTML).join(" ");
  });
  // tables without a header row: promote the first row so GFM can render it
  dom.querySelectorAll("table").forEach((t) => {
    if (!t.querySelector("th") && t.rows.length) {
      const first = t.rows[0];
      [...first.cells].forEach((td) => {
        const th = dom.createElement("th");
        th.innerHTML = td.innerHTML;
        td.replaceWith(th);
      });
    }
  });
  dom.querySelectorAll("a[id]:empty").forEach((a) => a.remove()); // Word bookmarks
  return td.turndown(dom.body.innerHTML).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ------------------------------------------------------------------ Markdown

export async function markdownToHtmlBody(file: File) {
  const text = decodeText(await bytesOf(file));
  return marked.parse(text, { gfm: true, async: false }) as string;
}

export async function markdownToPdf(file: File, o: { pageSize: string }) {
  // the PDF layout engine has no form controls: show task-list boxes as text
  const body = (await markdownToHtmlBody(file)).replace(/<input\b[^>]*type="checkbox"[^>]*>/g, (t) => (/\bchecked\b/.test(t) ? "<code>[x]</code> " : "<code>[ ]</code> "));
  const html = htmlDocument(body, stem(file.name));
  return out(`${stem(file.name)}.pdf`, await pdf.reflowToPdf(enc.encode(html), "text/html", { pageSize: o.pageSize }));
}

export async function markdownToHtml(file: File) {
  return out(`${stem(file.name)}.html`, webPage(await markdownToHtmlBody(file), stem(file.name)));
}

export async function markdownToWord(file: File) {
  return out(`${stem(file.name)}.docx`, await htmlToDocx(await markdownToHtmlBody(file), { title: stem(file.name) }));
}

// ------------------------------------------------------------------ HTML & text

export async function htmlToPdf(file: File, o: { pageSize: string }) {
  return out(`${stem(file.name)}.pdf`, await pdf.reflowToPdf(await bytesOf(file), "text/html", { pageSize: o.pageSize }));
}

export async function htmlToWord(file: File) {
  return out(`${stem(file.name)}.docx`, await htmlToDocx(decodeText(await bytesOf(file)), { title: stem(file.name) }));
}

export async function htmlToMarkdownFile(file: File) {
  return out(`${stem(file.name)}.md`, await htmlToMarkdown(decodeText(await bytesOf(file))));
}

export async function textToPdf(file: File, o: { pageSize: string; font: string }) {
  const text = decodeText(await bytesOf(file));
  const family = o.font === "mono" ? "monospace" : "sans-serif";
  const html = htmlDocument(`<pre style="font-family:${family};font-size:${o.font === "mono" ? 9 : 10.5}pt;white-space:pre-wrap;background:none;padding:0;margin:0">${escapeHtml(text)}</pre>`, stem(file.name));
  return out(`${stem(file.name)}.pdf`, await pdf.reflowToPdf(enc.encode(html), "text/html", { pageSize: o.pageSize }));
}

export async function epubToPdf(file: File, o: { pageSize: string }) {
  return out(`${stem(file.name)}.pdf`, await pdf.reflowToPdf(await bytesOf(file), "application/epub+zip", { pageSize: o.pageSize, em: 11 }));
}

// ------------------------------------------------------------------ Spreadsheets (SheetJS)

async function xlsx() {
  return await import("xlsx");
}

function sniffDelimiter(text: string) {
  const sample = text.split(/\r?\n/).slice(0, 10).join("\n");
  const counts = [",", ";", "\t", "|"].map((d) => [d, sample.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

async function readBook(file: File) {
  const X = await xlsx();
  const bytes = await bytesOf(file);
  if (["csv", "tsv", "txt"].includes(ext(file.name))) {
    const text = decodeText(bytes);
    return X.read(text, { type: "string", FS: sniffDelimiter(text), cellDates: true, raw: false });
  }
  try {
    return X.read(bytes, { type: "array", cellDates: true });
  } catch {
    throw new Error(`${file.name} couldn't be read as a spreadsheet.`);
  }
}

export async function excelToPdf(file: File, o: { orientation: string; pageSize: string }) {
  const X = await xlsx();
  const wb = await readBook(file);
  let maxCols = 0;
  const parts = wb.SheetNames.map((name, i) => {
    const ws = wb.Sheets[name];
    if (!ws["!ref"]) return "";
    const range = X.utils.decode_range(ws["!ref"]);
    maxCols = Math.max(maxCols, range.e.c - range.s.c + 1);
    const table = X.utils.sheet_to_html(ws, { header: "", footer: "" }).replace(/<table/, '<table class="sheet"');
    return `${i ? '<div style="page-break-before:always"></div>' : ""}${wb.SheetNames.length > 1 ? `<h2>${escapeHtml(name)}</h2>` : ""}${table}`;
  });
  const landscape = o.orientation === "landscape" || (o.orientation === "auto" && maxCols > 7);
  const size = Math.max(6, Math.min(10, 10 - (maxCols - (landscape ? 10 : 7)) * 0.35));
  const css = `@page{margin:12mm} body{font-family:sans-serif;font-size:${size}pt;color:#1f2328}
    h2{font-size:12pt;margin:0 0 6pt} table.sheet{border-collapse:collapse${maxCols > 4 ? ";width:100%" : ""}}
    td{border:0.5pt solid #c8c8c4;padding:1.5pt 4pt;vertical-align:top}
    tr:first-child td{background-color:#f1f1ee;font-weight:bold}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${parts.join("")}</body></html>`;
  return out(`${stem(file.name)}.pdf`, await pdf.reflowToPdf(enc.encode(html), "text/html", { pageSize: o.pageSize, landscape }));
}

export async function excelToCsv(file: File): Promise<OutFile[]> {
  const X = await xlsx();
  const wb = await readBook(file);
  const many = wb.SheetNames.length > 1;
  return wb.SheetNames.map((name) =>
    out(`${stem(file.name)}${many ? `-${name.replace(/[\\/:*?"<>|]/g, "_")}` : ""}.csv`, "﻿" + X.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false })),
  );
}

export async function excelToJson(file: File) {
  const X = await xlsx();
  const wb = await readBook(file);
  const data = Object.fromEntries(wb.SheetNames.map((n) => [n, X.utils.sheet_to_json(wb.Sheets[n], { defval: null })]));
  return out(`${stem(file.name)}.json`, JSON.stringify(wb.SheetNames.length === 1 ? data[wb.SheetNames[0]] : data, null, 2));
}

export async function csvToExcel(files: File[]) {
  const X = await xlsx();
  const book = X.utils.book_new();
  const used = new Set<string>();
  for (const f of files) {
    const wb = await readBook(f);
    for (const n of wb.SheetNames) {
      let name = (files.length > 1 ? stem(f.name) : n).replace(/[\\/:*?[\]]/g, "_").slice(0, 31) || "Sheet";
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${name.slice(0, 27)} (${i})`;
      used.add(name.toLowerCase());
      X.utils.book_append_sheet(book, wb.Sheets[n], name);
    }
  }
  const bytes = X.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return out(`${files.length === 1 ? stem(files[0].name) : "combined"}.xlsx`, new Uint8Array(bytes));
}
