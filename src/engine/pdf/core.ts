/**
 * DrDoc PDF engine, built on MuPDF.
 *
 * Environment-agnostic: runs inside the browser worker and in Node tests.
 * Everything here takes and returns plain bytes / JSON so it can cross the
 * worker boundary.
 */
import * as mupdf from "mupdf";
import { fallbackFontFile, base14For, type FontTraits } from "./fonts";

export class EngineError extends Error {
  constructor(message: string, public code = "ERROR") {
    super(message);
  }
}

export type Bytes = Uint8Array;
export type Rect = [number, number, number, number];
export type FontLoader = (file: string) => Promise<Bytes>;

let loadFontFile: FontLoader = async () => {
  throw new EngineError("Font loading is not configured.");
};
export function setFontLoader(fn: FontLoader) {
  loadFontFile = fn;
}

export const PAGE_SIZES: Record<string, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
};

// ------------------------------------------------------------------ opening & saving

export function openPdf(bytes: Bytes, password = ""): mupdf.PDFDocument {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch {
    throw new EngineError("This file isn't a PDF we can read. It may be damaged.", "BAD_FILE");
  }
  if (doc.needsPassword()) {
    if (!password || !doc.authenticatePassword(password)) {
      throw new EngineError(
        password ? "That password is not correct." : "This PDF is password protected. Unlock it first.",
        "PASSWORD",
      );
    }
  }
  const pdf = doc.asPDF();
  if (!pdf) throw new EngineError("This file isn't a PDF.", "BAD_FILE");
  return pdf;
}

export function save(doc: mupdf.PDFDocument, options = "garbage=compact,compress"): Bytes {
  return doc.saveToBuffer(options).asUint8Array().slice();
}

export function pdfInfo(bytes: Bytes, password = "") {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch {
    throw new EngineError("This file isn't a PDF we can read. It may be damaged.", "BAD_FILE");
  }
  const locked = doc.needsPassword();
  if (locked && !(password && doc.authenticatePassword(password))) {
    return { locked: true, pageCount: 0, pages: [] as { w: number; h: number }[] };
  }
  const pages: { w: number; h: number }[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const b = doc.loadPage(i).getBounds();
    pages.push({ w: b[2] - b[0], h: b[3] - b[1] });
  }
  return { locked: false, pageCount: pages.length, pages };
}

// ------------------------------------------------------------------ page content helpers

/** Wrap a page's existing content in q/Q and append a new content stream. */
function appendContent(doc: mupdf.PDFDocument, page: mupdf.PDFPage, ops: string) {
  const pageObj = page.getObject();
  const contents = pageObj.get("Contents");
  const arr = doc.newArray();
  arr.push(doc.addStream("q\n", {}));
  if (contents.isArray()) contents.forEach((c) => arr.push(c));
  else if (!contents.isNull()) arr.push(contents);
  arr.push(doc.addStream("\nQ\n", {}));
  arr.push(doc.addStream(ops, {}));
  pageObj.put("Contents", arr);
}

function pageResources(doc: mupdf.PDFDocument, page: mupdf.PDFPage, kind: string): mupdf.PDFObject {
  const pageObj = page.getObject();
  let res = pageObj.get("Resources");
  if (res.isNull()) {
    // inherited resources: copy them onto the page so we can extend them
    const inherited = pageObj.getInheritable ? pageObj.getInheritable("Resources") : null;
    res = doc.newDictionary();
    if (inherited && !inherited.isNull()) inherited.forEach((v, k) => res.put(k, v));
    pageObj.put("Resources", res);
  }
  let sub = res.get(kind);
  if (sub.isNull()) {
    sub = doc.newDictionary();
    res.put(kind, sub);
  }
  return sub;
}

let nameCounter = 0;
function uniqueName(prefix: string) {
  nameCounter = (nameCounter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${nameCounter}`;
}

/** Matrix that lets us write content in MuPDF's page space (top-left origin, y down, rotation applied). */
function pageSpaceCm(page: mupdf.PDFPage) {
  const inv = mupdf.Matrix.invert(page.getTransform());
  return inv.map((v) => +v.toFixed(6)).join(" ") + " cm";
}

const num = (v: number) => +v.toFixed(3);

function rgb(color: number[] | undefined): [number, number, number] {
  if (!color || color.length === 0) return [0, 0, 0];
  if (color.length === 1) return [color[0], color[0], color[0]];
  if (color.length === 4) {
    const [c, m, y, k] = color;
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  return [color[0], color[1], color[2]];
}

function opacityState(doc: mupdf.PDFDocument, page: mupdf.PDFPage, alpha: number, blend?: string) {
  const gs = doc.newDictionary();
  gs.put("Type", doc.newName("ExtGState"));
  gs.put("ca", alpha);
  gs.put("CA", alpha);
  if (blend) gs.put("BM", doc.newName(blend));
  const name = uniqueName("GS");
  pageResources(doc, page, "ExtGState").put(name, doc.addObject(gs));
  return name;
}

type PlacedFont = { name: string; font: mupdf.Font; cid: boolean };

function placeFont(doc: mupdf.PDFDocument, page: mupdf.PDFPage, font: mupdf.Font, cid = true): PlacedFont {
  const ref = cid ? doc.addFont(font) : doc.addSimpleFont(font, "Latin");
  const name = uniqueName("F");
  pageResources(doc, page, "Font").put(name, ref);
  return { name, font, cid };
}

/** Encode a string for a placed font and measure its width at `size`. */
function encodeText(pf: PlacedFont, text: string, size: number) {
  let hex = "";
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const gid = pf.font.encodeCharacter(cp);
    width += pf.font.advanceGlyph(gid, 0) * size;
    if (pf.cid) hex += gid.toString(16).padStart(4, "0");
    else hex += (cp < 256 ? cp : 63).toString(16).padStart(2, "0"); // WinAnsi-ish
  }
  return { hex, width };
}

function textWidth(font: mupdf.Font, text: string, size: number) {
  let w = 0;
  for (const ch of text) w += font.advanceGlyph(font.encodeCharacter(ch.codePointAt(0)!), 0) * size;
  return w;
}

const coversText = (font: mupdf.Font, text: string) =>
  [...text].every((ch) => /\s/.test(ch) || font.encodeCharacter(ch.codePointAt(0)!) > 0);

// ------------------------------------------------------------------ font matching

const fontCache = new Map<string, mupdf.Font>();

export function traitsOf(font: mupdf.Font): FontTraits {
  const raw = font.getName().replace(/^[A-Z]{6}\+/, "");
  const n = raw.toLowerCase().replace(/[\s_-]/g, "");
  return {
    name: raw,
    bold: font.isBold() || /bold|black|heavy|semibold|demi/.test(n),
    italic: font.isItalic() || /italic|oblique/.test(n),
    serif: font.isSerif() || /times|serif|georgia|garamond|roman|cambria|minion|caslon|book/.test(n),
    mono: font.isMono() || /courier|consolas|mono|menlo|code/.test(n),
  };
}

async function substituteFont(traits: FontTraits): Promise<mupdf.Font> {
  const file = fallbackFontFile(traits);
  const key = file ?? base14For(traits);
  if (!fontCache.has(key)) {
    fontCache.set(key, file ? new mupdf.Font(file.replace(/\.ttf$/, ""), await loadFontFile(file)) : new mupdf.Font(key));
  }
  return fontCache.get(key)!;
}

/** The document's own font if it can draw `text`, otherwise the closest match we have. */
async function matchFont(original: mupdf.Font | null, traits: FontTraits, text: string) {
  if (original && coversText(original, text)) return { font: original, matched: "original" as const };
  const sub = await substituteFont(traits);
  if (coversText(sub, text)) return { font: sub, matched: "similar" as const };
  // last resort: a broad built-in font for unusual characters
  for (const name of ["Helvetica", "Times-Roman"]) {
    const f = new mupdf.Font(name);
    if (coversText(f, text)) return { font: f, matched: "similar" as const };
  }
  return { font: sub, matched: "similar" as const };
}

// ------------------------------------------------------------------ compose / organize / merge

export type PageRef =
  | { src: number; index: number; rotate?: number }
  | { blank: true; w: number; h: number };

export function compose(sources: { bytes: Bytes; password?: string }[], pages: PageRef[]): Bytes {
  if (!pages.length) throw new EngineError("There are no pages to save.");
  const docs = sources.map((s) => openPdf(s.bytes, s.password));
  const out = new mupdf.PDFDocument();
  const maps = docs.map(() => out.newGraftMap());
  for (const p of pages) {
    if ("blank" in p) {
      const obj = out.addPage([0, 0, p.w, p.h], 0, out.newDictionary(), "");
      out.insertPage(-1, obj);
      continue;
    }
    maps[p.src].graftPage(-1, docs[p.src], p.index);
    if (p.rotate) {
      const obj = out.findPage(out.countPages() - 1);
      const cur = obj.getInheritable("Rotate");
      const base = cur && !cur.isNull() ? cur.asNumber() : 0;
      obj.put("Rotate", (((base + p.rotate) % 360) + 360) % 360);
    }
  }
  return save(out);
}

export function split(bytes: Bytes, groups: number[][], password = ""): Bytes[] {
  const src = openPdf(bytes, password);
  return groups.map((g) => {
    const out = new mupdf.PDFDocument();
    const map = out.newGraftMap();
    for (const i of g) map.graftPage(-1, src, i);
    return save(out);
  });
}

// ------------------------------------------------------------------ compress

export type CompressOptions = { dpi: number; quality: number; gray?: boolean };

export function compress(bytes: Bytes, opt: CompressOptions): Bytes {
  const doc = openPdf(bytes);

  // How big is each image drawn? Collect the largest on-page size per pixel size.
  const drawn = new Map<string, number>(); // "WxH" -> largest drawn width in inches
  for (let i = 0; i < doc.countPages(); i++) {
    const dev = new mupdf.Device({
      fillImage(image: mupdf.Image, ctm: mupdf.Matrix) {
        const wIn = Math.hypot(ctm[0], ctm[1]) / 72;
        const hIn = Math.hypot(ctm[2], ctm[3]) / 72;
        const key = `${image.getWidth()}x${image.getHeight()}`;
        const pxPerIn = Math.max(image.getWidth() / Math.max(wIn, 0.01), image.getHeight() / Math.max(hIn, 0.01));
        drawn.set(key, Math.min(drawn.get(key) ?? Infinity, pxPerIn)); // keep the least-dense (largest) placement
      },
    } as any);
    doc.loadPage(i).run(dev, mupdf.Matrix.identity);
    dev.close();
  }

  const n = doc.countObjects();
  for (let i = 1; i < n; i++) {
    // Work on the indirect reference itself: in MuPDF.js, calling .resolve()
    // and then saving can drop the object from the file.
    const res = doc.newIndirect(i);
    const obj = res;
    try {
      if (!res.isStream() || res.get("Subtype").asName() !== "Image") continue;
    } catch {
      continue;
    }
    if (res.get("ImageMask").asBoolean?.()) continue;
    const bpc = res.get("BitsPerComponent");
    if (!bpc.isNull() && bpc.asNumber() < 8) continue;

    let img: mupdf.Image;
    try {
      img = doc.loadImage(obj);
    } catch {
      continue;
    }
    const w = img.getWidth();
    const h = img.getHeight();
    if (w * h < 120_000) continue; // small images: not worth it

    const density = drawn.get(`${w}x${h}`);
    const scale = density && density > opt.dpi ? opt.dpi / density : 1;
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));
    const oldLen = res.readRawStream().getLength();

    let pix: mupdf.Pixmap;
    try {
      pix = img.toPixmap();
      // resample by warping the full image onto a smaller rectangle
      if (nw !== w || nh !== h) {
        const W = pix.getWidth(), H = pix.getHeight();
        pix = pix.warp([[0, 0], [W, 0], [W, H], [0, H]], nw, nh);
      }
      const cs = opt.gray ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;
      const isGray = pix.getNumberOfComponents() - (pix.getAlpha?.() ? 1 : 0) === 1;
      if (opt.gray ? !isGray : isGray || pix.getNumberOfComponents() !== 3) pix = pix.convertToColorSpace(cs, false);
    } catch {
      continue;
    }
    const jpeg = pix.asJPEG(opt.quality, false);
    // safety net: never swap in an image that came out blank
    if (looksBlank(pix) && !looksBlank(img.toPixmap())) continue;
    if (jpeg.length >= oldLen * 0.9 && scale === 1) continue; // no real gain

    obj.writeRawStream(jpeg); // must go through the indirect reference
    res.put("Filter", doc.newName("DCTDecode"));
    res.delete("DecodeParms");
    res.delete("Decode");
    res.delete("Mask"); // colour-key masks don't survive lossy recompression
    res.put("Width", nw);
    res.put("Height", nh);
    res.put("BitsPerComponent", 8);
    res.put("ColorSpace", doc.newName(opt.gray ? "DeviceGray" : "DeviceRGB"));
  }
  const out = save(doc, "garbage=deduplicate,compress,compress-fonts");
  return out.length < bytes.length ? out : bytes;
}

/** True when a pixmap is (almost) a single flat colour. Samples a grid of pixels. */
function looksBlank(pix: mupdf.Pixmap) {
  const p = pix.getPixels();
  const n = pix.getNumberOfComponents();
  const w = pix.getWidth(), h = pix.getHeight();
  const first = Array.from(p.subarray(0, n));
  for (let y = 0; y < h; y += Math.max(1, (h / 24) | 0))
    for (let x = 0; x < w; x += Math.max(1, (w / 24) | 0)) {
      const i = (y * w + x) * n;
      for (let c = 0; c < n; c++) if (Math.abs(p[i + c] - first[c]) > 8) return false;
    }
  return true;
}

// ------------------------------------------------------------------ stamping (page numbers, watermark)

type Corner = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

export function pageNumbers(
  bytes: Bytes,
  o: { position: Corner; format: string; start: number; size: number; firstNumber?: number },
): Bytes {
  const doc = openPdf(bytes);
  const total = doc.countPages();
  const font = new mupdf.Font("Helvetica");
  for (let i = 0; i < total; i++) {
    if (i + 1 < o.start) continue;
    const page = doc.loadPage(i);
    const n = (o.firstNumber ?? o.start) + (i + 1 - o.start);
    const text = o.format.replace("{n}", String(n)).replace("{total}", String(total - o.start + (o.firstNumber ?? o.start)));
    const [x0, y0, x1, y1] = page.getBounds();
    const pf = placeFont(doc, page, font, false);
    const { hex, width } = encodeText(pf, text, o.size);
    const [v, hpos] = o.position.split("-");
    const margin = 28;
    const x = hpos === "left" ? x0 + margin : hpos === "right" ? x1 - margin - width : (x0 + x1 - width) / 2;
    const y = v === "top" ? y0 + margin + o.size * 0.75 : y1 - margin;
    appendContent(
      doc,
      page,
      `q ${pageSpaceCm(page)} BT /${pf.name} ${o.size} Tf 0.25 0.25 0.25 rg 1 0 0 -1 ${num(x)} ${num(y)} Tm <${hex}> Tj ET Q\n`,
    );
  }
  return save(doc);
}

export function watermark(
  bytes: Bytes,
  o: { text: string; size: number; opacity: number; color: number[]; angle: number },
): Bytes {
  const doc = openPdf(bytes);
  const font = new mupdf.Font("Helvetica-Bold");
  const rad = (o.angle * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const pf = placeFont(doc, page, font, false);
    const gs = opacityState(doc, page, o.opacity);
    // fit long text inside the page diagonal
    let size = o.size;
    const span = Math.abs(o.angle) > 10 ? Math.hypot(x1 - x0, y1 - y0) * 0.75 : (x1 - x0) * 0.85;
    const w0 = textWidth(font, o.text, size);
    if (w0 > span) size *= span / w0;
    const { hex, width } = encodeText(pf, o.text, size);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const cap = size * 0.7;
    // text runs along (c, -s) and glyph "up" is (-s, -c) in page space (y down)
    const sx = cx - (width / 2) * c - (cap / 2) * s;
    const sy = cy + (width / 2) * s - (cap / 2) * c;
    const [r, g, b] = rgb(o.color);
    appendContent(
      doc,
      page,
      `q ${pageSpaceCm(page)} /${gs} gs BT /${pf.name} ${num(size)} Tf ${r} ${g} ${b} rg ` +
        `${num(c)} ${num(-s)} ${num(-s)} ${num(-c)} ${num(sx)} ${num(sy)} Tm <${hex}> Tj ET Q\n`,
    );
  }
  return save(doc);
}

// ------------------------------------------------------------------ security & repair

export function protect(bytes: Bytes, password: string, allowPrint = true, allowCopy = true): Bytes {
  if (!password) throw new EngineError("Enter a password.");
  const doc = openPdf(bytes);
  // print = 4, copy = 16, accessibility = 512
  const perms = (allowPrint ? 4 | 2048 : 0) | (allowCopy ? 16 | 512 : 512);
  if (password.includes('"')) throw new EngineError('Passwords can\'t contain the " character.');
  const pw = `"${password}"`; // quoted so commas and = signs are allowed
  return save(doc, `garbage=compact,compress,encrypt=aes-256,user-password=${pw},owner-password=${pw},permissions=${perms}`);
}

export function unlock(bytes: Bytes, password: string): Bytes {
  const doc = openPdf(bytes, password);
  return save(doc, "garbage=compact,compress,decrypt");
}

export function repair(bytes: Bytes): Bytes {
  // MuPDF rebuilds broken cross-reference tables while opening.
  const doc = openPdf(bytes);
  return save(doc, "garbage=deduplicate,compress,clean,sanitize");
}

// ------------------------------------------------------------------ rendering

export type RenderOut = { w: number; h: number; data: Bytes };

export function renderPage(
  bytes: Bytes | mupdf.PDFDocument,
  index: number,
  o: { scale?: number; dpi?: number; format: "png" | "jpeg" | "rgba"; gray?: boolean; quality?: number },
): RenderOut {
  const doc = bytes instanceof Uint8Array ? openPdf(bytes) : bytes;
  const page = doc.loadPage(index);
  const scale = o.scale ?? (o.dpi ?? 96) / 72;
  const cs = o.gray ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), cs, false, true);
  const w = pix.getWidth();
  const h = pix.getHeight();
  if (o.format === "png") return { w, h, data: pix.asPNG().slice() };
  if (o.format === "jpeg") return { w, h, data: pix.asJPEG(o.quality ?? 85, false).slice() };
  const src = pix.getPixels();
  const n = pix.getNumberOfComponents();
  const out = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; j < out.length; i += n, j += 4) {
    out[j] = src[i];
    out[j + 1] = n >= 3 ? src[i + 1] : src[i];
    out[j + 2] = n >= 3 ? src[i + 2] : src[i];
    out[j + 3] = 255;
  }
  return { w, h, data: out };
}

export function grayscale(bytes: Bytes, dpi: number): Bytes {
  const src = openPdf(bytes);
  const out = new mupdf.PDFDocument();
  for (let i = 0; i < src.countPages(); i++) {
    const page = src.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const pix = page.toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceGray, false, true);
    addImagePage(out, new mupdf.Image(pix.asJPEG(82, false)), x1 - x0, y1 - y0, [0, 0, x1 - x0, y1 - y0]);
  }
  return save(out);
}

// ------------------------------------------------------------------ images -> PDF

function addImagePage(doc: mupdf.PDFDocument, img: mupdf.Image, pw: number, ph: number, rect: Rect) {
  const res = doc.newDictionary();
  const xo = doc.newDictionary();
  xo.put("Im0", doc.addImage(img));
  res.put("XObject", xo);
  const [x0, y0, x1, y1] = rect;
  // PDF space is y-up
  const content = `q ${num(x1 - x0)} 0 0 ${num(y1 - y0)} ${num(x0)} ${num(ph - y1)} cm /Im0 Do Q`;
  doc.insertPage(-1, doc.addPage([0, 0, pw, ph], 0, res, content));
}

export type ImageInput = { bytes: Bytes; w: number; h: number; pageW?: number; pageH?: number };

export function imagesToPdf(images: ImageInput[], o: { pageSize: string; margin: number }): Bytes {
  if (!images.length) throw new EngineError("Add at least one image.");
  const doc = new mupdf.PDFDocument();
  for (const im of images) {
    const img = new mupdf.Image(im.bytes);
    let pw: number, ph: number, rect: Rect;
    if (im.pageW && im.pageH) {
      // exact page size given (e.g. a slide)
      pw = im.pageW;
      ph = im.pageH;
      rect = [0, 0, pw, ph];
    } else if (o.pageSize === "fit") {
      pw = 595.28;
      ph = (pw * im.h) / im.w;
      rect = [0, 0, pw, ph];
    } else {
      [pw, ph] = PAGE_SIZES[o.pageSize] ?? PAGE_SIZES.a4;
      if (im.w > im.h) [pw, ph] = [ph, pw];
      const m = o.margin;
      const s = Math.min((pw - 2 * m) / im.w, (ph - 2 * m) / im.h);
      const dw = im.w * s;
      const dh = im.h * s;
      rect = [(pw - dw) / 2, (ph - dh) / 2, (pw + dw) / 2, (ph + dh) / 2];
    }
    addImagePage(doc, img, pw, ph, rect);
  }
  return save(doc);
}

// ------------------------------------------------------------------ reflowable documents (HTML, text, EPUB) -> PDF

export function reflowToPdf(bytes: Bytes, mime: string, o: { pageSize?: string; landscape?: boolean; em?: number } = {}): Bytes {
  let src: mupdf.Document;
  try {
    src = mupdf.Document.openDocument(bytes, mime);
  } catch {
    throw new EngineError("Couldn't read this file.");
  }
  let [w, h] = PAGE_SIZES[o.pageSize ?? "a4"] ?? PAGE_SIZES.a4;
  if (o.landscape) [w, h] = [h, w];
  src.layout(w, h, o.em ?? 11);
  const buf = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buf, "pdf", "compress");
  const n = src.countPages();
  for (let i = 0; i < n; i++) {
    const page = src.loadPage(i);
    const dev = writer.beginPage(page.getBounds());
    page.run(dev, mupdf.Matrix.identity);
    writer.endPage();
  }
  writer.close();
  // keep only the glyphs used (fallback fonts can be megabytes), then deduplicate
  const doc = openPdf(buf.asUint8Array().slice());
  try {
    doc.subsetFonts();
  } catch {
    /* subsetting is an optimisation only */
  }
  return save(doc);
}

// ------------------------------------------------------------------ text & structure extraction

export function extractText(bytes: Bytes): string[] {
  const doc = openPdf(bytes);
  const out: string[] = [];
  for (let i = 0; i < doc.countPages(); i++) out.push(doc.loadPage(i).toStructuredText("preserve-whitespace").asText());
  return out;
}

export function toHtml(bytes: Bytes): string {
  const doc = openPdf(bytes);
  const buf = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buf, "html", "");
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const dev = writer.beginPage(page.getBounds());
    page.run(dev, mupdf.Matrix.identity);
    writer.endPage();
  }
  writer.close();
  return buf.asString();
}

export type Span = { text: string; font: string; size: number; bold: boolean; italic: boolean; mono: boolean; serif: boolean; color: [number, number, number] };
export type Line = { bbox: Rect; spans: Span[] };
export type Block =
  | { type: "text"; bbox: Rect; lines: Line[] }
  | { type: "image"; bbox: Rect; png: Bytes; w: number; h: number };
export type StructuredPage = { w: number; h: number; blocks: Block[] };

export function structure(bytes: Bytes, withImages = true): StructuredPage[] {
  const doc = openPdf(bytes);
  const pages: StructuredPage[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const blocks: Block[] = [];
    let block: Extract<Block, { type: "text" }> | null = null;
    let line: Line | null = null;
    page.toStructuredText(withImages ? "preserve-images,preserve-whitespace" : "preserve-whitespace").walk({
      beginTextBlock(bbox) {
        block = { type: "text", bbox: bbox as Rect, lines: [] };
        blocks.push(block);
      },
      beginLine(bbox) {
        line = { bbox: bbox as Rect, spans: [] };
        block?.lines.push(line);
      },
      onChar(c, _origin, font, size, _quad, color) {
        if (!line) return;
        const t = traitsOf(font);
        const col = rgb(color);
        const last = line.spans.at(-1);
        if (last && last.font === t.name && Math.abs(last.size - size) < 0.1 && last.color.join() === col.join()) last.text += c;
        else line.spans.push({ text: c, font: t.name, size, bold: t.bold, italic: t.italic, mono: t.mono, serif: t.serif, color: col });
      },
      onImageBlock(bbox, _transform, image) {
        if (!withImages) return;
        try {
          const pix = image.toPixmap();
          const rgbPix = pix.getColorSpace()?.isRGB?.() || pix.getNumberOfComponents() <= 2 ? pix : pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB);
          blocks.push({ type: "image", bbox: bbox as Rect, png: rgbPix.asPNG().slice(), w: rgbPix.getWidth(), h: rgbPix.getHeight() });
        } catch {
          /* unsupported image type: skip */
        }
      },
    });
    pages.push({ w: x1 - x0, h: y1 - y0, blocks });
  }
  return pages;
}

// ------------------------------------------------------------------ PDF editor

export type EditorRun = { text: string; fontKey: number; size: number; color: [number, number, number]; x: number };
export type EditorLine = {
  id: string;
  bbox: Rect;
  baseline: number;
  text: string;
  runs: EditorRun[];
};
export type EditorFont = FontTraits & { key: number; family: string };

export type EditOp =
  | { type: "replace-line"; page: number; lineId: string; runs: { text: string; fontKey: number; size: number; color: [number, number, number] }[] }
  | { type: "text"; page: number; x: number; y: number; text: string; size: number; color: [number, number, number]; fontKey: number | "sans" | "serif" | "mono"; bold?: boolean; italic?: boolean }
  | { type: "image"; page: number; rect: Rect; bytes: Bytes }
  | { type: "rect"; page: number; rect: Rect; color: [number, number, number]; opacity: number; blend?: string };

export class PdfEditor {
  private original: Bytes;
  private docFonts: mupdf.Font[] = [];
  private fontKeys = new Map<string, number>();
  private lineCache = new Map<number, { lines: EditorLine[]; fonts: mupdf.Font[][] }>();
  doc: mupdf.PDFDocument;

  constructor(bytes: Bytes, password = "") {
    const doc = openPdf(bytes, password);
    // keep an unlocked copy as the editing baseline
    this.original = password ? save(doc, "decrypt") : bytes;
    this.doc = openPdf(this.original);
  }

  pageCount() {
    return this.doc.countPages();
  }

  pageSizes() {
    const out: { w: number; h: number }[] = [];
    for (let i = 0; i < this.doc.countPages(); i++) {
      const b = this.doc.loadPage(i).getBounds();
      out.push({ w: b[2] - b[0], h: b[3] - b[1] });
    }
    return out;
  }

  fonts(): EditorFont[] {
    return this.docFonts.map((f, key) => ({ key, ...traitsOf(f), family: familyOf(f) }));
  }

  private fontKey(font: mupdf.Font) {
    const name = font.getName();
    let k = this.fontKeys.get(name);
    if (k === undefined) {
      k = this.docFonts.length;
      this.docFonts.push(font);
      this.fontKeys.set(name, k);
    }
    return k;
  }

  /** Text lines of a page in the ORIGINAL document (stable ids for edit ops). */
  lines(pageIndex: number): EditorLine[] {
    const cached = this.lineCache.get(pageIndex);
    if (cached) return cached.lines;
    const doc = openPdf(this.original);
    const page = doc.loadPage(pageIndex);
    const lines: EditorLine[] = [];
    let cur: (EditorLine & { dir: number[] }) | null = null;
    page.toStructuredText("preserve-whitespace").walk({
      beginLine(bbox, _wmode, dir) {
        cur = { id: "", bbox: bbox as Rect, baseline: 0, text: "", runs: [], dir: dir as unknown as number[] };
        lines.push(cur);
      },
      onChar: (c, origin, font, size, _quad, color) => {
        if (!cur) return;
        const key = this.fontKey(font);
        const col = rgb(color);
        const last = cur.runs.at(-1);
        if (!cur.text) cur.baseline = origin[1];
        cur.text += c;
        if (last && last.fontKey === key && Math.abs(last.size - size) < 0.05 && last.color.join() === col.join()) last.text += c;
        else cur.runs.push({ text: c, fontKey: key, size, color: col, x: origin[0] });
      },
    });
    // horizontal text only
    const horizontal = lines.filter((l: any) => l.text && Math.abs(l.dir[1] ?? 0) < 0.01 && (l.dir[0] ?? 1) > 0);
    // join pieces of one visual line (same baseline, touching) that MuPDF reported separately
    horizontal.sort((a, b) => a.baseline - b.baseline || a.bbox[0] - b.bbox[0]);
    const merged: typeof horizontal = [];
    for (const l of horizontal) {
      const prev = merged.at(-1);
      const size = l.runs[0]?.size ?? 10;
      if (prev && Math.abs(prev.baseline - l.baseline) < size * 0.15 && l.bbox[0] - prev.bbox[2] < size * 0.8 && l.bbox[0] >= prev.bbox[0]) {
        prev.text += l.text;
        for (const r of l.runs) {
          const last = prev.runs.at(-1)!;
          if (last.fontKey === r.fontKey && last.size === r.size && last.color.join() === r.color.join()) last.text += r.text;
          else prev.runs.push(r);
        }
        prev.bbox = [prev.bbox[0], Math.min(prev.bbox[1], l.bbox[1]), Math.max(prev.bbox[2], l.bbox[2]), Math.max(prev.bbox[3], l.bbox[3])];
      } else merged.push({ ...l, runs: [...l.runs] });
    }
    const clean = merged
      .filter((l: any) => l.text.trim())
      .map((l: any, i) => {
        // trim trailing whitespace runs
        const runs = l.runs.map((r: EditorRun) => ({ ...r }));
        while (runs.length && !runs.at(-1).text.trim()) runs.pop();
        if (runs.length) runs[runs.length - 1].text = runs.at(-1).text.replace(/\s+$/, "");
        return { id: `${pageIndex}:${i}`, bbox: l.bbox, baseline: l.baseline, text: runs.map((r) => r.text).join(""), runs };
      });
    this.lineCache.set(pageIndex, { lines: clean, fonts: [] });
    return clean;
  }

  /** Rebuild the working document from the original plus all edit ops. */
  async apply(ops: EditOp[]) {
    const doc = openPdf(this.original);
    const byPage = new Map<number, EditOp[]>();
    for (const op of ops) byPage.set(op.page, [...(byPage.get(op.page) ?? []), op]);

    for (const [pi, pageOps] of byPage) {
      const page = doc.loadPage(pi);
      const lines = this.lines(pi);
      const replaced = pageOps.filter((o): o is Extract<EditOp, { type: "replace-line" }> => o.type === "replace-line");

      // 1) remove the glyphs of every edited line (text only; images and drawings stay)
      if (replaced.length) {
        for (const op of replaced) {
          const line = lines.find((l) => l.id === op.lineId);
          if (!line) continue;
          const [x0, y0, x1, y1] = line.bbox;
          const inset = (y1 - y0) * 0.22;
          const a = page.createAnnotation("Redact");
          a.setRect([x0 + 0.2, y0 + inset, x1 - 0.2, y1 - inset]);
        }
        page.applyRedactions(false, 0, 0, 0);
      }

      // 2) draw new content
      let ops = "";
      const cm = pageSpaceCm(page);
      for (const op of pageOps) {
        if (op.type === "replace-line") {
          const line = lines.find((l) => l.id === op.lineId);
          if (!line) continue;
          let x = line.runs[0]?.x ?? line.bbox[0];
          let text = "";
          for (const r of op.runs) {
            if (!r.text) continue;
            const orig = this.docFonts[r.fontKey] ?? null;
            const { font } = await matchFont(orig, orig ? traitsOf(orig) : SANS, r.text);
            const pf = placeFont(doc, page, font);
            const enc = encodeText(pf, r.text, r.size);
            const [cr, cg, cb] = r.color;
            text += `/${pf.name} ${num(r.size)} Tf ${num(cr)} ${num(cg)} ${num(cb)} rg 1 0 0 -1 ${num(x)} ${num(line.baseline)} Tm <${enc.hex}> Tj\n`;
            x += enc.width;
          }
          if (text) ops += `q ${cm} BT\n${text}ET Q\n`;
        } else if (op.type === "text") {
          const orig = typeof op.fontKey === "number" ? this.docFonts[op.fontKey] : null;
          const traits: FontTraits = orig
            ? { ...traitsOf(orig), bold: op.bold ?? traitsOf(orig).bold, italic: op.italic ?? traitsOf(orig).italic }
            : { name: String(op.fontKey), bold: !!op.bold, italic: !!op.italic, serif: op.fontKey === "serif", mono: op.fontKey === "mono" };
          const useOrig = orig && traitsOf(orig).bold === traits.bold && traitsOf(orig).italic === traits.italic ? orig : null;
          let y = op.y;
          let body = "";
          for (const lineText of op.text.split("\n")) {
            if (lineText) {
              const { font } = await matchFont(useOrig, traits, lineText);
              const pf = placeFont(doc, page, font);
              const enc = encodeText(pf, lineText, op.size);
              const [cr, cg, cb] = op.color;
              body += `/${pf.name} ${num(op.size)} Tf ${num(cr)} ${num(cg)} ${num(cb)} rg 1 0 0 -1 ${num(op.x)} ${num(y)} Tm <${enc.hex}> Tj\n`;
            }
            y += op.size * 1.25;
          }
          if (body) ops += `q ${cm} BT\n${body}ET Q\n`;
        } else if (op.type === "image") {
          const xo = pageResources(doc, page, "XObject");
          const name = uniqueName("Im");
          xo.put(name, doc.addImage(new mupdf.Image(op.bytes)));
          const [x0, y0, x1, y1] = op.rect;
          // in page space y is down: flip the unit square
          ops += `q ${cm} ${num(x1 - x0)} 0 0 ${num(-(y1 - y0))} ${num(x0)} ${num(y1)} cm /${name} Do Q\n`;
        } else if (op.type === "rect") {
          const gs = op.opacity < 1 || op.blend ? opacityState(doc, page, op.opacity, op.blend) : null;
          const [x0, y0, x1, y1] = op.rect;
          const [r, g, b] = op.color;
          ops += `q ${cm} ${gs ? `/${gs} gs ` : ""}${num(r)} ${num(g)} ${num(b)} rg ${num(x0)} ${num(y0)} ${num(x1 - x0)} ${num(y1 - y0)} re f Q\n`;
        }
      }
      if (ops) appendContent(doc, page, ops);
    }
    this.doc = doc;
  }

  render(index: number, scale: number): RenderOut {
    return renderPage(this.doc, index, { scale, format: "rgba" });
  }

  save(): Bytes {
    // re-open a copy so subsetting never disturbs the live editing document
    const copy = openPdf(save(this.doc, "garbage=compact,compress"));
    try {
      copy.subsetFonts();
    } catch {
      /* optimisation only */
    }
    return save(copy, "garbage=compact,compress");
  }
}

const SANS: FontTraits = { name: "Helvetica", bold: false, italic: false, serif: false, mono: false };

function familyOf(font: mupdf.Font) {
  return font
    .getName()
    .replace(/^[A-Z]{6}\+/, "")
    .replace(/[-,](Bold|Italic|Oblique|Regular|Roman|Semibold|SemiBold|Light|Medium|Black|BoldItalic|BoldOblique|MT|PS)+.*$/i, "")
    .replace(/(PSMT|MT|PS)$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
}
