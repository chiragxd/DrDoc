import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as mupdf from "mupdf";
import * as E from "../src/engine/pdf/core";
import { parseRanges } from "../src/lib/ranges";

const enc = new TextEncoder();
const html = (body: string) => enc.encode(`<!doctype html><meta charset="utf-8"><body>${body}</body>`);

/** A PDF with one "PAGE-n" heading per page. */
function numberedPdf(n: number) {
  const body = Array.from({ length: n }, (_, i) => `<h1 style="page-break-after:always">PAGE-${i + 1}</h1>`).join("");
  return E.reflowToPdf(html(body), "text/html");
}
const texts = (bytes: Uint8Array) => E.extractText(bytes).map((t) => t.trim());

/** A PDF containing a large photo-like image. */
function imagePdf() {
  const w = 2400, h = 1800;
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  const px = pix.getPixels();
  for (let i = 0; i < px.length; i += 3) {
    const p = i / 3, x = p % w, y = (p / w) | 0;
    px[i] = (x * 7) & 255; px[i + 1] = (y * 3) & 255; px[i + 2] = ((x ^ y) * 5) & 255;
  }
  return E.imagesToPdf([{ bytes: pix.asPNG(), w, h }], { pageSize: "a4", margin: 0 });
}

beforeAll(() => {
  E.setFontLoader(async (file) => new Uint8Array(readFileSync(resolve(__dirname, "../public/fonts", file))));
});

describe("page ranges", () => {
  it("parses ranges, keeps order and supports 'last'", () => {
    expect(parseRanges("1-3, 5", 9)).toEqual([0, 1, 2, 4]);
    expect(parseRanges("3,1,2", 9)).toEqual([2, 0, 1]);
    expect(parseRanges("8-last", 9)).toEqual([7, 8]);
    expect(parseRanges("5-3", 9)).toEqual([4, 3, 2]);
    expect(() => parseRanges("12", 9)).toThrow(/doesn't exist/);
    expect(() => parseRanges("abc", 9)).toThrow();
  });
});

describe("organize", () => {
  it("reorders, rotates, adds blanks and merges", () => {
    const a = numberedPdf(4);
    const b = numberedPdf(2);
    const out = E.compose([{ bytes: a }, { bytes: b }], [
      { src: 0, index: 2 },
      { src: 1, index: 0, rotate: 90 },
      { blank: true, w: 595, h: 842 },
      { src: 0, index: 0 },
    ]);
    const doc = E.openPdf(out);
    expect(doc.countPages()).toBe(4);
    expect(texts(out)).toEqual(["PAGE-3", "PAGE-1", "", "PAGE-1"]);
    expect(doc.findPage(1).getInheritable("Rotate").asNumber()).toBe(90);
  });

  it("splits into groups", () => {
    const parts = E.split(numberedPdf(5), [[0, 1], [4]]);
    expect(parts.map(texts)).toEqual([["PAGE-1", "PAGE-2"], ["PAGE-5"]]);
  });
});

describe("stamping", () => {
  it("adds page numbers from a start page", () => {
    const out = E.pageNumbers(numberedPdf(3), { position: "bottom-center", format: "Page {n} of {total}", start: 2, size: 10 });
    const t = texts(out);
    expect(t[0]).not.toContain("Page");
    expect(t[1]).toContain("Page 2 of 3");
    expect(t[2]).toContain("Page 3 of 3");
  });

  it("puts a watermark on every page", () => {
    const out = E.watermark(numberedPdf(2), { text: "DRAFT", size: 60, opacity: 0.2, color: [0.5, 0.5, 0.5], angle: 45 });
    expect(texts(out).every((t) => t.includes("DRAFT"))).toBe(true);
  });
});

describe("security", () => {
  it("protects and unlocks with a password", () => {
    const locked = E.protect(numberedPdf(1), "s3cret, ok");
    expect(E.pdfInfo(locked).locked).toBe(true);
    expect(() => E.unlock(locked, "wrong")).toThrow(/not correct/);
    const open = E.unlock(locked, "s3cret, ok");
    expect(E.pdfInfo(open).locked).toBe(false);
    expect(texts(open)[0]).toBe("PAGE-1");
  });
});

describe("compress", () => {
  it("shrinks image-heavy PDFs and keeps the image visible", () => {
    const src = imagePdf();
    const out = E.compress(src, { dpi: 110, quality: 60 });
    expect(out.length).toBeLessThan(src.length * 0.5);
    expect(E.openPdf(out).countPages()).toBe(1);
    // the image must survive, downsampled, and still have real content
    const img = E.structure(out, true)[0].blocks.find((b) => b.type === "image");
    expect(img).toBeTruthy();
    expect((img as { w: number }).w).toBeLessThan(2400);
    expect((img as { w: number }).w).toBeGreaterThan(400);
    const page = E.renderPage(out, 0, { scale: 0.25, format: "rgba" });
    const px = page.data;
    let distinct = 0;
    for (let i = 4; i < px.length; i += 4 * 37) if (Math.abs(px[i] - px[0]) > 30) distinct++;
    expect(distinct).toBeGreaterThan(50);
  });

  it("converts images to greyscale when asked", () => {
    const out = E.compress(imagePdf(), { dpi: 110, quality: 60, gray: true });
    const page = E.renderPage(out, 0, { scale: 0.2, format: "rgba" });
    const px = page.data;
    for (let i = 0; i < px.length; i += 4 * 53) expect(Math.abs(px[i] - px[i + 1]) + Math.abs(px[i + 1] - px[i + 2])).toBeLessThan(12);
  });
});

describe("conversions", () => {
  it("lays out HTML with tables into pages", () => {
    const out = E.reflowToPdf(html("<h1>Hello</h1><table><tr><td>A1</td><td>B1</td></tr></table><p>café 東京</p>"), "text/html");
    const t = texts(out)[0];
    expect(t).toContain("Hello");
    expect(t).toContain("A1");
    expect(t).toContain("café");
  });

  it("returns structured text with fonts", () => {
    const s = E.structure(E.reflowToPdf(html("<h1>Title</h1><p>Body <b>bold</b></p>"), "text/html"), false);
    const spans = s[0].blocks.flatMap((b) => (b.type === "text" ? b.lines.flatMap((l) => l.spans) : []));
    expect(spans.find((x) => x.text.includes("Title"))!.size).toBeGreaterThan(spans.find((x) => x.text.includes("Body"))!.size);
    expect(spans.some((x) => x.text.includes("bold") && x.bold)).toBe(true);
  });
});

describe("editor", () => {
  it("replaces a line in place, keeping run styles", async () => {
    const src = E.reflowToPdf(html("<p>Hello <b>world</b> again</p><p>Second line</p>"), "text/html");
    const ed = new E.PdfEditor(src);
    const line = ed.lines(0).find((l) => l.text.startsWith("Hello"))!;
    expect(line.runs.length).toBeGreaterThanOrEqual(2);
    const runs = line.runs.map((r, i) => ({ ...r, text: i === 0 ? "Goodbye " : r.text }));
    await ed.apply([{ type: "replace-line", page: 0, lineId: line.id, runs }]);
    const out = ed.save();
    const t = texts(out)[0];
    expect(t).toContain("Goodbye");
    expect(t).not.toContain("Hello");
    expect(t).toContain("Second line");
    const bold = E.structure(out, false)[0].blocks.flatMap((b) => (b.type === "text" ? b.lines.flatMap((l) => l.spans) : [])).find((s) => s.text.includes("world"));
    expect(bold?.bold).toBe(true);
  });

  it("adds text, images and shapes", async () => {
    const ed = new E.PdfEditor(numberedPdf(1));
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 10, 10], false);
    pix.clear(128);
    await ed.apply([
      { type: "text", page: 0, x: 72, y: 300, text: "Signed: Zoë\nLine two", size: 14, color: [0, 0, 0.6], fontKey: "sans" },
      { type: "image", page: 0, rect: [72, 400, 172, 450], bytes: pix.asPNG() },
      { type: "rect", page: 0, rect: [72, 500, 300, 520], color: [1, 1, 1], opacity: 1 },
    ]);
    const t = texts(ed.save())[0];
    expect(t).toContain("Signed: Zoë");
    expect(t).toContain("Line two");
  });
});
