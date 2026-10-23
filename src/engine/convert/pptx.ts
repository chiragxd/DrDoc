/**
 * A compact PowerPoint (.pptx) renderer: draws each slide onto a canvas.
 *
 * Covers what most decks use: theme colours and fonts, slide/layout/master
 * inheritance, backgrounds, pictures (with cropping), basic shapes, groups,
 * rotation, tables, bullets, text wrapping, vertical anchoring and autofit.
 * Charts, SmartArt and EMF/WMF pictures are not drawn.
 */
import { unzipSync, strFromU8 } from "fflate";
import { pdf } from "../pdf/client";
import { out, stem, type OutFile } from "../../lib/files";
import { canvasBytes } from "./images";

type Xml = Element;
type Part = { path: string; xml: Document; rels: Map<string, string> };
type Theme = { colors: Record<string, string>; major: string; minor: string };

const EMU_PT = 12700;
const kids = (el: Xml | null | undefined, name: string): Xml[] => (el ? [...el.children].filter((c) => c.localName === name) : []);
const kid = (el: Xml | null | undefined, name: string): Xml | null => kids(el, name)[0] ?? null;
const path = (el: Xml | null | undefined, ...names: string[]) => names.reduce<Xml | null>((e, n) => kid(e, n), el ?? null);
const num = (el: Xml | null | undefined, attr: string, d = 0) => (el?.hasAttribute(attr) ? +el.getAttribute(attr)! : d);

class Pptx {
  files: Record<string, Uint8Array>;
  theme: Theme = { colors: {}, major: "Calibri Light", minor: "Calibri" };
  cx = 9144000;
  cy = 6858000;
  slides: string[] = [];
  private cache = new Map<string, Part>();
  private images = new Map<string, Promise<ImageBitmap | null>>();

  constructor(bytes: Uint8Array) {
    try {
      this.files = unzipSync(bytes);
    } catch {
      throw new Error("This isn't a valid .pptx file. Old .ppt files must be saved as .pptx first.");
    }
    const pres = this.part("ppt/presentation.xml");
    if (!pres) throw new Error("This isn't a valid .pptx file.");
    const sz = path(pres.xml.documentElement, "sldSz");
    this.cx = num(sz, "cx", this.cx);
    this.cy = num(sz, "cy", this.cy);
    for (const s of kids(path(pres.xml.documentElement, "sldIdLst"), "sldId")) {
      const target = pres.rels.get(s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "");
      if (target) this.slides.push(target);
    }
    const masterPath = this.slides.length ? this.related(this.related(this.slides[0], "slideLayout"), "slideMaster") : null;
    const themePath = masterPath ? this.related(masterPath, "theme") : null;
    if (themePath) this.readTheme(this.part(themePath)!.xml);
  }

  part(p: string | null): Part | null {
    if (!p) return null;
    if (this.cache.has(p)) return this.cache.get(p)!;
    const data = this.files[p];
    if (!data) return null;
    const xml = new DOMParser().parseFromString(strFromU8(data), "application/xml");
    const rels = new Map<string, string>();
    const dir = p.slice(0, p.lastIndexOf("/"));
    const relPath = `${dir}/_rels/${p.slice(p.lastIndexOf("/") + 1)}.rels`;
    if (this.files[relPath]) {
      const r = new DOMParser().parseFromString(strFromU8(this.files[relPath]), "application/xml");
      for (const rel of [...r.getElementsByTagName("Relationship")]) {
        if (rel.getAttribute("TargetMode") === "External") continue;
        rels.set(rel.getAttribute("Id")!, resolve(dir, rel.getAttribute("Target")!));
        rels.set("type:" + rel.getAttribute("Type")!.split("/").pop(), resolve(dir, rel.getAttribute("Target")!));
      }
    }
    const part = { path: p, xml, rels };
    this.cache.set(p, part);
    return part;
  }

  related(p: string | null, type: string) {
    return p ? this.part(p)?.rels.get("type:" + type) ?? null : null;
  }

  image(p: string): Promise<ImageBitmap | null> {
    if (!this.images.has(p)) {
      const data = this.files[p];
      this.images.set(p, data && !/\.(emf|wmf|tiff?)$/i.test(p) ? createImageBitmap(new Blob([data as BlobPart])).catch(() => null) : Promise.resolve(null));
    }
    return this.images.get(p)!;
  }

  private readTheme(xml: Document) {
    const scheme = xml.getElementsByTagNameNS("*", "clrScheme")[0];
    for (const c of scheme ? [...scheme.children] : []) {
      const v = c.firstElementChild;
      if (!v) continue;
      this.theme.colors[c.localName] = "#" + (v.getAttribute("lastClr") ?? v.getAttribute("val") ?? "000000");
    }
    const latin = (n: string) => xml.getElementsByTagNameNS("*", n)[0]?.getElementsByTagNameNS("*", "latin")[0]?.getAttribute("typeface");
    this.theme.major = latin("majorFont") || this.theme.major;
    this.theme.minor = latin("minorFont") || this.theme.minor;
  }
}

function resolve(dir: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = dir.split("/");
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

// ------------------------------------------------------------------ colours

const ALIAS: Record<string, string> = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };

function colorOf(el: Xml | null, theme: Theme, placeholderColor?: string): string | null {
  if (!el) return null;
  const c = el.firstElementChild;
  if (!c) return null;
  let hex: string | null = null;
  if (c.localName === "srgbClr") hex = "#" + c.getAttribute("val");
  else if (c.localName === "schemeClr") {
    const v = c.getAttribute("val")!;
    hex = v === "phClr" ? placeholderColor ?? "#000000" : theme.colors[ALIAS[v] ?? v] ?? "#000000";
  } else if (c.localName === "sysClr") hex = "#" + (c.getAttribute("lastClr") ?? "000000");
  else if (c.localName === "prstClr") hex = ({ black: "#000000", white: "#ffffff", red: "#ff0000", blue: "#0000ff", green: "#008000" } as Record<string, string>)[c.getAttribute("val")!] ?? "#000000";
  if (!hex) return null;
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex!.slice(i, i + 2), 16) / 255);
  let alpha = 1;
  for (const m of [...c.children]) {
    const v = num(m, "val") / 100000;
    if (m.localName === "lumMod" || m.localName === "lumOff") {
      let [h, s, l] = rgbToHsl(r, g, b);
      l = m.localName === "lumMod" ? l * v : l + v;
      [r, g, b] = hslToRgb(h, s, Math.min(1, Math.max(0, l)));
    } else if (m.localName === "tint") [r, g, b] = [r, g, b].map((x) => x + (1 - x) * (1 - v));
    else if (m.localName === "shade") [r, g, b] = [r, g, b].map((x) => x * v);
    else if (m.localName === "alpha") alpha = v;
  }
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

// ------------------------------------------------------------------ rendering

type Ph = { type: string; idx: string | null };
type Box = { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean };
type Chain = { slide: Part; layout: Part | null; master: Part | null };

const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function phOf(sp: Xml | null): Ph | null {
  const nv = kid(sp, "nvSpPr") ?? kid(sp, "nvPicPr") ?? kid(sp, "nvGraphicFramePr");
  const ph = path(nv, "nvPr", "ph");
  return ph ? { type: ph.getAttribute("type") ?? "body", idx: ph.getAttribute("idx") } : null;
}
const phFamily = (t: string) => (t === "ctrTitle" ? "title" : t === "subTitle" || t === "obj" ? "body" : t);

function findPh(part: Part | null, ph: Ph): Xml | null {
  if (!part) return null;
  const shapes = [...part.xml.getElementsByTagNameNS("*", "sp")];
  return (
    (ph.idx && shapes.find((s) => phOf(s)?.idx === ph.idx)) ||
    shapes.find((s) => phOf(s)?.type === ph.type) ||
    shapes.find((s) => phFamily(phOf(s)?.type ?? "-") === phFamily(ph.type)) ||
    null
  );
}

function boxOf(el: Xml | null): Box | null {
  const xfrm = el?.getElementsByTagNameNS("*", "xfrm")[0];
  const off = kid(xfrm, "off"), ext = kid(xfrm, "ext");
  if (!off || !ext) return null;
  return { x: num(off, "x"), y: num(off, "y"), w: num(ext, "cx"), h: num(ext, "cy"), rot: num(xfrm, "rot") / 60000, flipH: xfrm!.getAttribute("flipH") === "1", flipV: xfrm!.getAttribute("flipV") === "1" };
}

class SlideRenderer {
  ctx: CanvasRenderingContext2D;
  constructor(private p: Pptx, private canvas: HTMLCanvasElement, private k: number) {
    this.ctx = canvas.getContext("2d")!;
  }

  async render(slidePath: string) {
    const slide = this.p.part(slidePath)!;
    const layout = this.p.part(this.p.related(slidePath, "slideLayout"));
    const master = this.p.part(this.p.related(layout?.path ?? null, "slideMaster"));
    const chain: Chain = { slide, layout, master };
    const ctx = this.ctx;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (const part of [slide, layout, master]) {
      if (part && (await this.background(part))) break;
    }
    const showMaster = (p: Part | null) => p?.xml.documentElement.getAttribute("showMasterSp") !== "0";
    if (showMaster(slide) && showMaster(layout) && master) await this.tree(path(master.xml.documentElement, "cSld", "spTree"), master, chain, true);
    if (showMaster(slide) && layout) await this.tree(path(layout.xml.documentElement, "cSld", "spTree"), layout, chain, true);
    await this.tree(path(slide.xml.documentElement, "cSld", "spTree"), slide, chain, false);
  }

  private async background(part: Part) {
    const bg = path(part.xml.documentElement, "cSld", "bg");
    if (!bg) return false;
    const bgPr = kid(bg, "bgPr");
    const ctx = this.ctx;
    const fill = (c: string | null) => {
      if (!c) return false;
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return true;
    };
    if (bgPr) {
      const blip = path(bgPr, "blipFill", "blip");
      if (blip) {
        const target = part.rels.get(blip.getAttributeNS(R_NS, "embed") ?? "");
        const img = target ? await this.p.image(target) : null;
        if (img) {
          ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
          return true;
        }
      }
      const grad = kid(bgPr, "gradFill");
      if (grad) {
        const stops = grad.getElementsByTagNameNS("*", "gs");
        const g = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        [...stops].forEach((s) => g.addColorStop(num(s, "pos") / 100000, colorOf(s, this.p.theme) ?? "#fff"));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        return true;
      }
      return fill(colorOf(kid(bgPr, "solidFill"), this.p.theme));
    }
    const ref = kid(bg, "bgRef");
    return fill(colorOf(ref, this.p.theme));
  }

  private async tree(tree: Xml | null, part: Part, chain: Chain, inherited: boolean, group?: (b: Box) => Box) {
    if (!tree) return;
    for (const el of [...tree.children]) {
      const map = group ?? ((b: Box) => b);
      if (el.localName === "sp") {
        const ph = phOf(el);
        if (inherited && ph) continue; // placeholders on layouts/masters are only templates
        await this.shape(el, part, chain, map);
      } else if (el.localName === "pic") await this.picture(el, part, chain, map);
      else if (el.localName === "cxnSp") this.shapeGeometry(el, map, part);
      else if (el.localName === "grpSp") {
        const xfrm = path(el, "grpSpPr", "xfrm");
        const off = kid(xfrm, "off"), ext = kid(xfrm, "ext"), choff = kid(xfrm, "chOff"), chext = kid(xfrm, "chExt");
        const sx = num(ext, "cx", 1) / (num(chext, "cx", 1) || 1), sy = num(ext, "cy", 1) / (num(chext, "cy", 1) || 1);
        const inner = (b: Box): Box => map({ ...b, x: num(off, "x") + (b.x - num(choff, "x")) * sx, y: num(off, "y") + (b.y - num(choff, "y")) * sy, w: b.w * sx, h: b.h * sy });
        await this.tree(el, part, chain, inherited, inner);
      } else if (el.localName === "graphicFrame") await this.table(el, part, map);
    }
  }

  private withBox(box: Box, fn: (x: number, y: number, w: number, h: number) => void) {
    const ctx = this.ctx, k = this.k;
    const x = box.x * k, y = box.y * k, w = box.w * k, h = box.h * k;
    ctx.save();
    if (box.rot || box.flipH || box.flipV) {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate((box.rot * Math.PI) / 180);
      ctx.scale(box.flipH ? -1 : 1, box.flipV ? -1 : 1);
      ctx.translate(-(x + w / 2), -(y + h / 2));
    }
    fn(x, y, w, h);
    ctx.restore();
  }

  private resolveBox(el: Xml, chain: Chain, map: (b: Box) => Box): Box | null {
    let box = boxOf(kid(el, "spPr") ?? kid(el, "grpSpPr") ?? el);
    const ph = phOf(el);
    if (!box && ph) box = boxOf(findPh(chain.layout, ph)) ?? boxOf(findPh(chain.master, ph));
    return box ? map(box) : null;
  }

  private shapeGeometry(el: Xml, map: (b: Box) => Box, part: Part, chain?: Chain) {
    const box = chain ? this.resolveBox(el, chain, map) : (() => { const b = boxOf(kid(el, "spPr")); return b ? map(b) : null; })();
    if (!box) return null;
    const spPr = kid(el, "spPr");
    const style = kid(el, "style");
    const theme = this.p.theme;
    let fill: string | null = null;
    if (spPr && kid(spPr, "noFill")) fill = null;
    else if (kid(spPr, "solidFill")) fill = colorOf(kid(spPr, "solidFill"), theme);
    else if (kid(spPr, "gradFill")) fill = colorOf(spPr!.getElementsByTagNameNS("*", "gs")[0], theme);
    else if (style && num(kid(style, "fillRef"), "idx") > 0 && !phOf(el)) fill = colorOf(kid(style, "fillRef"), theme);
    const ln = kid(spPr, "ln");
    let stroke: string | null = null;
    if (ln && !kid(ln, "noFill")) stroke = colorOf(kid(ln, "solidFill"), theme);
    else if (!ln && style && num(kid(style, "lnRef"), "idx") > 0 && !phOf(el)) stroke = colorOf(kid(style, "lnRef"), theme);
    const lw = Math.max(1, (num(ln, "w", 12700) * this.k));
    const geom = path(spPr, "prstGeom")?.getAttribute("prst") ?? "rect";
    this.withBox(box, (x, y, w, h) => {
      const ctx = this.ctx;
      ctx.beginPath();
      if (geom === "ellipse") ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else if (geom === "line" || el.localName === "cxnSp") {
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + h);
        fill = null;
        stroke = stroke ?? "#000";
      } else if (geom === "roundRect") ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.1667);
      else ctx.rect(x, y, w, h);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    });
    void part;
    return box;
  }

  private async shape(el: Xml, part: Part, chain: Chain, map: (b: Box) => Box) {
    const box = this.shapeGeometry(el, map, part, chain);
    if (!box) return;
    const body = kid(el, "txBody");
    if (body) await this.text(body, el, box, chain);
  }

  private async picture(el: Xml, part: Part, chain: Chain, map: (b: Box) => Box) {
    const box = this.resolveBox(el, chain, map);
    const blip = path(el, "blipFill", "blip");
    if (!box || !blip) return;
    const id = blip.getAttributeNS(R_NS, "embed") ?? "";
    const target = part.rels.get(id);
    const img = target ? await this.p.image(target) : null;
    if (!img) return;
    const src = path(el, "blipFill", "srcRect");
    const l = num(src, "l") / 100000, t = num(src, "t") / 100000, r = num(src, "r") / 100000, b = num(src, "b") / 100000;
    this.withBox(box, (x, y, w, h) => {
      this.ctx.drawImage(img, img.width * l, img.height * t, img.width * (1 - l - r), img.height * (1 - t - b), x, y, w, h);
    });
  }

  private async table(el: Xml, part: Part, map: (b: Box) => Box) {
    const tbl = el.getElementsByTagNameNS("*", "tbl")[0];
    const b = boxOf(el);
    if (!tbl || !b) return;
    const box = map(b);
    const cols = [...tbl.getElementsByTagNameNS("*", "gridCol")].map((c) => num(c, "w"));
    let y = box.y;
    for (const tr of kids(tbl, "tr")) {
      const h = num(tr, "h");
      let x = box.x;
      kids(tr, "tc").forEach((tc, i) => {
        const span = num(tc, "gridSpan", 1);
        const w = cols.slice(i, i + span).reduce((a, v) => a + v, 0) || cols[i] || 0;
        const cell: Box = { x, y, w, h, rot: 0, flipH: false, flipV: false };
        const fill = colorOf(path(tc, "tcPr", "solidFill"), this.p.theme);
        this.withBox(cell, (cx, cy, cw, ch) => {
          if (fill) {
            this.ctx.fillStyle = fill;
            this.ctx.fillRect(cx, cy, cw, ch);
          }
          this.ctx.strokeStyle = "rgba(0,0,0,0.25)";
          this.ctx.lineWidth = 1;
          this.ctx.strokeRect(cx, cy, cw, ch);
        });
        const body = kid(tc, "txBody");
        if (body) void this.text(body, tc, cell, null, 1400);
        x += w;
      });
      y += h;
    }
    void part;
  }

  /** Paragraph/run property lookup through the inheritance chain. */
  private levelProps(el: Xml, chain: Chain | null, level: number): Xml[] {
    const name = `lvl${level + 1}pPr`;
    const out: Xml[] = [];
    const own = path(kid(el, "txBody") ?? el, "lstStyle", name);
    if (own) out.push(own);
    const ph = phOf(el);
    if (chain && ph) {
      for (const part of [chain.layout, chain.master]) {
        const s = findPh(part, ph);
        const p = path(kid(s, "txBody"), "lstStyle", name);
        if (p) out.push(p);
      }
      const tx = path(chain.master?.xml.documentElement, "txStyles");
      const fam = phFamily(ph.type);
      const style = fam === "title" ? kid(tx, "titleStyle") : fam === "body" ? kid(tx, "bodyStyle") : kid(tx, "otherStyle");
      const p = kid(style, name);
      if (p) out.push(p);
    } else if (chain) {
      const p = path(chain.master?.xml.documentElement, "txStyles", "otherStyle", name);
      if (p) out.push(p);
    }
    return out;
  }

  private bodyPr(el: Xml, chain: Chain | null): Xml[] {
    const own = path(kid(el, "txBody") ?? el, "bodyPr");
    const out = own ? [own] : [];
    const ph = phOf(el);
    if (chain && ph) for (const part of [chain.layout, chain.master]) {
      const p = path(kid(findPh(part, ph), "txBody"), "bodyPr");
      if (p) out.push(p);
    }
    return out;
  }

  private async text(body: Xml, el: Xml, box: Box, chain: Chain | null, defaultSize = 1800) {
    const theme = this.p.theme;
    const bps = this.bodyPr(el, chain);
    const bp = (attr: string, d: number) => {
      for (const b of bps) if (b.hasAttribute(attr)) return num(b, attr);
      return d;
    };
    const anchor = bps.find((b) => b.hasAttribute("anchor"))?.getAttribute("anchor") ?? "t";
    const fontScale = num(bps[0]?.getElementsByTagNameNS("*", "normAutofit")[0], "fontScale", 100000) / 100000;
    const insL = bp("lIns", 91440), insR = bp("rIns", 91440), insT = bp("tIns", 45720), insB = bp("bIns", 45720);
    const isTitle = phFamily(phOf(el)?.type ?? "") === "title";
    const k = this.k;
    const ctx = this.ctx;

    type Tok = { text: string; font: string; size: number; color: string; bold: boolean; italic: boolean; underline: boolean };
    type PLine = { toks: Tok[]; width: number; height: number; indent: number };
    const paras: { lines: PLine[]; align: string; bullet: string | null; marL: number; indent: number; spaceBefore: number; lineMul: number; size: number; bulletColor: string }[] = [];

    for (const p of kids(body, "p")) {
      const pPr = kid(p, "pPr");
      const level = num(pPr, "lvl");
      const chainProps = [pPr, ...this.levelProps(el, chain, level)].filter(Boolean) as Xml[];
      const pick = (attr: string) => chainProps.find((x) => x.hasAttribute(attr))?.getAttribute(attr) ?? null;
      const defR = chainProps.map((x) => kid(x, "defRPr")).filter(Boolean) as Xml[];
      const runProp = (r: Xml | null, attr: string) => (r?.hasAttribute(attr) ? r.getAttribute(attr) : defR.find((d) => d.hasAttribute(attr))?.getAttribute(attr) ?? null);
      const runColor = (r: Xml | null) => colorOf(kid(r, "solidFill"), theme) ?? defR.map((d) => colorOf(kid(d, "solidFill"), theme)).find(Boolean) ?? (theme.colors.dk1 ?? "#000");
      const runFont = (r: Xml | null) => {
        const face = kid(r, "latin")?.getAttribute("typeface") ?? defR.map((d) => kid(d, "latin")?.getAttribute("typeface")).find(Boolean) ?? (isTitle ? "+mj-lt" : "+mn-lt");
        return face === "+mj-lt" ? theme.major : face === "+mn-lt" ? theme.minor : face;
      };
      const noBullet = chainProps.find((x) => kid(x, "buNone") || kid(x, "buChar") || kid(x, "buAutoNum"));
      const bullet = noBullet && !kid(noBullet, "buNone") ? kid(noBullet, "buChar")?.getAttribute("char") ?? (kid(noBullet, "buAutoNum") ? "•" : null) : null;
      const lnPct = chainProps.map((x) => path(x, "lnSpc", "spcPct")).find(Boolean);
      const spcBef = chainProps.map((x) => path(x, "spcBef", "spcPts")).find(Boolean);

      const toks: Tok[] = [];
      for (const r of [...p.children]) {
        if (r.localName !== "r" && r.localName !== "fld" && r.localName !== "br") continue;
        const rPr = kid(r, "rPr");
        const size = (+(runProp(rPr, "sz") ?? defaultSize) / 100) * fontScale;
        const base: Omit<Tok, "text"> = {
          font: runFont(rPr), size, color: runColor(rPr),
          bold: runProp(rPr, "b") === "1", italic: runProp(rPr, "i") === "1", underline: (runProp(rPr, "u") ?? "none") !== "none",
        };
        if (r.localName === "br") toks.push({ ...base, text: "\n" });
        else for (const piece of (kid(r, "t")?.textContent ?? "").split(/(\s+)/)) if (piece) toks.push({ ...base, text: piece });
      }
      const endSize = (+(runProp(kid(p, "endParaRPr"), "sz") ?? defaultSize) / 100) * fontScale;
      const size = toks.length ? Math.max(...toks.map((t) => t.size)) : endSize;
      paras.push({
        lines: [{ toks, width: 0, height: size, indent: 0 }],
        align: pick("algn") ?? "l",
        bullet: toks.length ? bullet : null,
        marL: +(pick("marL") ?? 0),
        indent: +(pick("indent") ?? 0),
        spaceBefore: spcBef ? num(spcBef, "val") / 100 : 0,
        lineMul: lnPct ? num(lnPct, "val") / 100000 : 1,
        size,
        bulletColor: toks[0]?.color ?? "#000",
      });
    }

    const fontCss = (t: Tok, scale: number) => `${t.italic ? "italic " : ""}${t.bold ? "bold " : ""}${t.size * scale * k * EMU_PT}px "${t.font}", Carlito, Arial, sans-serif`;
    const boxW = box.w - insL - insR;
    const boxH = box.h - insT - insB;

    // lay out at decreasing scale until it fits (autofit)
    let scale = 1;
    let laid: { para: (typeof paras)[number]; lines: PLine[] }[] = [];
    let total = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      laid = [];
      total = 0;
      for (const para of paras) {
        const avail = (boxW - para.marL) * k;
        const lines: PLine[] = [];
        let cur: PLine = { toks: [], width: 0, height: para.size * scale, indent: 0 };
        for (const t of para.lines[0].toks) {
          if (t.text === "\n") {
            lines.push(cur);
            cur = { toks: [], width: 0, height: para.size * scale, indent: 0 };
            continue;
          }
          ctx.font = fontCss(t, scale);
          const w = ctx.measureText(t.text).width;
          if (cur.width + w > avail && cur.toks.length && t.text.trim()) {
            lines.push(cur);
            cur = { toks: [], width: 0, height: t.size * scale, indent: 0 };
          }
          if (!cur.toks.length && !t.text.trim()) continue;
          cur.toks.push({ ...t });
          cur.width += w;
          cur.height = Math.max(cur.height, t.size * scale);
        }
        lines.push(cur);
        laid.push({ para, lines });
        total += para.spaceBefore * scale + lines.reduce((a, l) => a + l.height * 1.2 * para.lineMul, 0);
      }
      if (total * EMU_PT <= boxH * 1.02 || box.h === 0) break;
      scale *= 0.9;
    }

    const x0 = (box.x + insL) * k;
    const totalPx = total * EMU_PT * k;
    let y = (box.y + insT) * k + (anchor === "ctr" ? (boxH * k - totalPx) / 2 : anchor === "b" ? boxH * k - totalPx : 0);
    this.withBox({ ...box }, () => {
      for (const { para, lines } of laid) {
        y += para.spaceBefore * scale * EMU_PT * k;
        lines.forEach((line, li) => {
          const lh = line.height * 1.2 * para.lineMul * EMU_PT * k;
          const baseline = y + line.height * EMU_PT * k * 1.0;
          const left = x0 + para.marL * k;
          const avail = (boxW - para.marL) * k;
          let x = para.align === "ctr" ? left + (avail - line.width) / 2 : para.align === "r" ? left + avail - line.width : left;
          if (para.bullet && li === 0) {
            ctx.font = `${line.height * EMU_PT * k}px Arial, sans-serif`;
            ctx.fillStyle = para.bulletColor;
            ctx.fillText(para.bullet === "" ? "•" : para.bullet, left + para.indent * k, baseline);
          }
          for (const t of line.toks) {
            ctx.font = fontCss(t, scale);
            ctx.fillStyle = t.color;
            ctx.fillText(t.text, x, baseline);
            const w = ctx.measureText(t.text).width;
            if (t.underline) ctx.fillRect(x, baseline + 2, w, Math.max(1, t.size * scale * k * EMU_PT * 0.06));
            x += w;
          }
          y += lh;
        });
      }
    });
  }
}

async function ensureFonts() {
  if (!("fonts" in document)) return;
  const faces: [string, string, string, string][] = [
    ["Carlito", "Carlito-Regular.ttf", "normal", "normal"],
    ["Carlito", "Carlito-Bold.ttf", "bold", "normal"],
    ["Carlito", "Carlito-Italic.ttf", "normal", "italic"],
  ];
  await Promise.all(faces.map(async ([fam, file, weight, style]) => {
    if ([...document.fonts].some((f) => f.family === fam && f.weight === weight && f.style === style)) return;
    const face = new FontFace(fam, `url(/fonts/${file})`, { weight, style });
    document.fonts.add(await face.load().catch(() => face));
  }));
}

async function renderSlides(file: File, onSlide: (c: HTMLCanvasElement, ptW: number, ptH: number, i: number, n: number) => Promise<void>) {
  const p = new Pptx(new Uint8Array(await file.arrayBuffer()));
  if (!p.slides.length) throw new Error("This presentation has no slides.");
  await ensureFonts();
  const ptW = p.cx / EMU_PT, ptH = p.cy / EMU_PT;
  const k = 2; // 144 dpi
  for (let i = 0; i < p.slides.length; i++) {
    const c = document.createElement("canvas");
    c.width = Math.round(ptW * k);
    c.height = Math.round(ptH * k);
    await new SlideRenderer(p, c, k / EMU_PT).render(p.slides[i]);
    await onSlide(c, ptW, ptH, i, p.slides.length);
  }
}

export async function pptxToPdf(file: File, progress?: (n: number) => void): Promise<OutFile> {
  const pages: { bytes: Uint8Array; w: number; h: number; pageW: number; pageH: number }[] = [];
  await renderSlides(file, async (c, pw, ph, i, n) => {
    pages.push({ bytes: await canvasBytes(c, "image/jpeg", 0.92), w: c.width, h: c.height, pageW: pw, pageH: ph });
    progress?.((i + 1) / n);
  });
  return out(`${stem(file.name)}.pdf`, await pdf.imagesToPdf(pages, { pageSize: "fit", margin: 0 }));
}

export async function pptxToImages(file: File, o: { format: "png" | "jpeg" }, progress?: (n: number) => void): Promise<OutFile[]> {
  const files: OutFile[] = [];
  await renderSlides(file, async (c, _w, _h, i, n) => {
    const type = o.format === "png" ? "image/png" : "image/jpeg";
    files.push(out(`${stem(file.name)}-slide${String(i + 1).padStart(3, "0")}.${o.format === "png" ? "png" : "jpg"}`, await canvasBytes(c, type, 0.92)));
    progress?.((i + 1) / n);
  });
  return files;
}
