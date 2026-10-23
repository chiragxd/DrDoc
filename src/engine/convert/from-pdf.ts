import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun, type ParagraphChild } from "docx";
import { pdf } from "../pdf/client";
import type { Block, Line, Span, StructuredPage } from "../pdf/core";
import { bytesOf, out, stem, type OutFile } from "../../lib/files";

// ------------------------------------------------------------------ layout analysis shared by Word & Markdown

type Para = { kind: "text"; lines: Line[]; spans: Span[]; size: number; bullet: string | null; align: "left" | "center" | "right"; indent: number; gapBefore: number }
  | { kind: "image"; block: Extract<Block, { type: "image" }> };

const BULLET = /^\s*([•▪◦●○■□➢►‣⁃∙·\-–*]|\d{1,3}[.)]|[a-z][.)])\s+/;

function bodySize(pages: StructuredPage[]) {
  const counts = new Map<number, number>();
  for (const p of pages) for (const b of p.blocks) if (b.type === "text")
    for (const l of b.lines) for (const s of l.spans) {
      const k = Math.round(s.size * 2) / 2;
      counts.set(k, (counts.get(k) ?? 0) + s.text.length);
    }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
}

const lineText = (l: Line) => l.spans.map((s) => s.text).join("");
const lineSize = (l: Line) => Math.max(...l.spans.filter((s) => s.text.trim()).map((s) => s.size), 0) || l.spans[0]?.size || 11;

const LONE_BULLET = /^([•▪◦●○■□➢►‣⁃∙·\-–*]|\d{1,3}[.)])$/;

/** Word and others draw a list bullet as its own line; glue it to the text beside it. */
function attachBullets(page: StructuredPage) {
  const text = page.blocks.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text");
  const mid = (l: Line) => (l.bbox[1] + l.bbox[3]) / 2;
  for (const b of text) {
    for (const l of [...b.lines]) {
      const t = lineText(l).trim();
      if (!LONE_BULLET.test(t)) continue;
      const h = l.bbox[3] - l.bbox[1];
      let best: Line | null = null;
      for (const b2 of text)
        for (const l2 of b2.lines) {
          if (l2 === l || l2.bbox[0] <= l.bbox[0] || l2.bbox[0] - l.bbox[2] > 72 || Math.abs(mid(l2) - mid(l)) > h * 0.5) continue;
          if (!best || l2.bbox[0] < best.bbox[0]) best = l2;
        }
      if (!best) continue;
      best.spans.unshift({ ...best.spans[0], text: `${t} ` });
      best.bbox = [l.bbox[0], best.bbox[1], best.bbox[2], best.bbox[3]];
      b.lines.splice(b.lines.indexOf(l), 1);
    }
  }
  page.blocks = page.blocks.filter((b) => b.type !== "text" || b.lines.length);
}

function paragraphs(page: StructuredPage): Para[] {
  attachBullets(page);
  const blocks = [...page.blocks].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  const textLeft = Math.min(...blocks.map((b) => b.bbox[0]), page.w);
  const out: Para[] = [];
  let lastBottom = 0;
  for (const b of blocks) {
    if (b.type === "image") {
      out.push({ kind: "image", block: b });
      lastBottom = b.bbox[3];
      continue;
    }
    const lines = b.lines.filter((l) => lineText(l).trim());
    let cur: Extract<Para, { kind: "text" }> | null = null;
    lines.forEach((l, i) => {
      const prev = lines[i - 1];
      const size = lineSize(l);
      const text = lineText(l);
      const gap = prev ? l.bbox[1] - prev.bbox[3] : l.bbox[1] - lastBottom;
      const prevShort = prev && prev.bbox[2] < b.bbox[2] - size * 4;
      const jumped = prev && Math.abs(l.bbox[0] - prev.bbox[0]) > size * 4; // e.g. next table cell
      const newPara = !cur || BULLET.test(text) || gap > size * 0.7 || Math.abs(size - cur.size) > 0.6 || prevShort || jumped;
      if (newPara) {
        const bullet = BULLET.exec(text)?.[1] ?? null;
        const center = (l.bbox[0] + l.bbox[2]) / 2;
        const align: "left" | "center" | "right" =
          Math.abs(center - page.w / 2) < page.w * 0.04 && l.bbox[0] > textLeft + size * 2 ? "center"
            : l.bbox[0] > page.w * 0.55 ? "right" : "left";
        cur = { kind: "text", lines: [], spans: [], size, bullet, align, indent: Math.max(0, l.bbox[0] - textLeft), gapBefore: Math.max(0, gap) };
        out.push(cur);
      } else if (cur) {
        // joining a wrapped line: undo hyphenation, otherwise add a space
        const last = cur.spans.at(-1);
        if (last) {
          if (/[a-z]-$/.test(last.text)) last.text = last.text.slice(0, -1);
          else if (!/\s$/.test(last.text)) last.text += " ";
        }
      }
      cur!.lines.push(l);
      for (const s of l.spans) {
        const last = cur!.spans.at(-1);
        if (last && last.font === s.font && last.size === s.size && last.color.join() === s.color.join()) last.text += s.text;
        else cur!.spans.push({ ...s });
      }
    });
    if (cur) (cur as Extract<Para, { kind: "text" }>).spans.forEach((s, i, a) => { if (i === a.length - 1) s.text = s.text.replace(/\s+$/, ""); });
    lastBottom = b.bbox[3];
  }
  // strip bullet glyphs from list paragraphs
  for (const p of out) if (p.kind === "text" && p.bullet && p.spans[0]) p.spans[0].text = p.spans[0].text.replace(BULLET, "");
  return out;
}

const hex = (c: number[]) => c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
const family = (f: string) => f.replace(/[-,](Bold|Italic|Oblique|Regular|Roman|Semibold|Light|Medium|Black|BoldItalic|BoldOblique)+.*$/i, "").replace(/(PSMT|MT|PS)$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");

// ------------------------------------------------------------------ PDF -> Word

export async function pdfToWord(file: File): Promise<OutFile> {
  const pages = (await pdf.structure(await bytesOf(file), true)) as StructuredPage[];
  if (!pages.some((p) => p.blocks.some((b) => b.type === "text" && b.lines.length))) {
    throw new Error("This PDF has no selectable text (it's probably a scan), so there's nothing to convert to editable text.");
  }
  const body = bodySize(pages);
  const children: Paragraph[] = [];
  const first = pages[0];
  const margin = Math.min(90, Math.max(36, Math.min(...first.blocks.map((b) => b.bbox[0]))));
  const usableW = first.w - margin * 2;

  pages.forEach((page, pi) => {
    const paras = paragraphs(page);
    paras.forEach((p, i) => {
      const pageBreakBefore = pi > 0 && i === 0;
      if (p.kind === "image") {
        const [x0, y0, x1, y1] = p.block.bbox;
        let w = (x1 - x0) * (96 / 72);
        let h = (y1 - y0) * (96 / 72);
        const maxW = usableW * (96 / 72);
        if (w > maxW) { h *= maxW / w; w = maxW; }
        children.push(new Paragraph({ pageBreakBefore, children: [new ImageRun({ type: "png", data: p.block.png, transformation: { width: Math.round(w), height: Math.round(h) } } as never)] }));
        return;
      }
      const ratio = p.size / body;
      const bold = p.spans.every((s) => s.bold || !s.text.trim());
      const heading = ratio >= 1.6 ? HeadingLevel.HEADING_1 : ratio >= 1.3 ? HeadingLevel.HEADING_2 : ratio >= 1.1 && bold ? HeadingLevel.HEADING_3 : undefined;
      const runs: ParagraphChild[] = p.spans.filter((s) => s.text).map((s) => new TextRun({
        text: s.text, bold: s.bold, italics: s.italic, size: Math.round(s.size * 2),
        font: family(s.font), color: hex(s.color),
      }));
      children.push(new Paragraph({
        children: runs,
        heading,
        pageBreakBefore,
        bullet: p.bullet && /[•▪◦●○■□➢►‣⁃∙·\-–*]/.test(p.bullet) ? { level: 0 } : undefined,
        alignment: p.align === "center" ? AlignmentType.CENTER : p.align === "right" ? AlignmentType.RIGHT : undefined,
        indent: !p.bullet && p.indent > 8 && p.align === "left" ? { left: Math.round(p.indent * 20) } : undefined,
        spacing: { before: i === 0 ? 0 : Math.round(Math.min(p.gapBefore, 24) * 20), after: 0 },
      }));
    });
  });

  const doc = new Document({
    creator: "DrDoc",
    styles: { default: { document: { run: { size: Math.round(body * 2) } } } },
    sections: [{
      properties: { page: { size: { width: Math.round(first.w * 20), height: Math.round(first.h * 20) }, margin: { top: 1000, bottom: 1000, left: Math.round(margin * 20), right: Math.round(margin * 20) } } },
      children,
    }],
  });
  return out(`${stem(file.name)}.docx`, await Packer.toBlob(doc));
}

// ------------------------------------------------------------------ PDF -> Markdown

export async function pdfToMarkdown(file: File): Promise<OutFile[]> {
  const pages = (await pdf.structure(await bytesOf(file), true)) as StructuredPage[];
  const body = bodySize(pages);
  const base = stem(file.name);
  const images: OutFile[] = [];
  const md: string[] = [];
  pages.forEach((page, pi) => {
    for (const p of paragraphs(page)) {
      if (p.kind === "image") {
        const name = `${base}_images/page${pi + 1}-${images.length + 1}.png`;
        images.push(out(name, p.block.png));
        md.push(`![](${encodeURI(name)})`);
        continue;
      }
      const ratio = p.size / body;
      const allBold = p.spans.every((s) => s.bold || !s.text.trim());
      const level = ratio >= 1.6 ? 1 : ratio >= 1.3 ? 2 : ratio >= 1.1 && allBold ? 3 : 0;
      const text = level
        ? p.spans.map((s) => s.text).join("").trim()
        : p.spans.map((s) => {
            const t = s.text.replace(/([*_`\\])/g, "\\$1");
            if (!t.trim()) return t;
            const [, lead, core, trail] = /^(\s*)(.*?)(\s*)$/.exec(t)!;
            // only treat real code fonts as code (CJK fallback fonts also report fixed pitch)
            const code = /courier|consol|mono|menlo|code/i.test(s.font);
            const wrap = s.bold && s.italic ? "***" : s.bold ? "**" : s.italic ? "*" : code ? "`" : "";
            return lead + wrap + core + wrap + trail;
          }).join("").trim();
      if (!text) continue;
      if (level) md.push(`${"#".repeat(level)} ${text}`);
      else if (p.bullet) md.push(/\d/.test(p.bullet) ? `1. ${text}` : `- ${text}`);
      else md.push(text);
    }
  });
  // keep list items together
  const joined = md.join("\n\n").replace(/^(- |1\. )(.*)\n\n(?=(- |1\. ))/gm, "$1$2\n");
  return [out(`${base}.md`, joined + "\n"), ...images];
}

// ------------------------------------------------------------------ simple ones

export async function pdfToImages(file: File, o: { format: "png" | "jpeg"; dpi: number }, progress?: (n: number) => void): Promise<OutFile[]> {
  const bytes = await bytesOf(file);
  const { id, info } = await pdf.open(bytes);
  const files: OutFile[] = [];
  const e = o.format === "png" ? "png" : "jpg";
  try {
    for (let i = 0; i < info.pageCount; i++) {
      const r = await pdf.renderOpen(id, i, { dpi: o.dpi, format: o.format, quality: 88 });
      files.push(out(`${stem(file.name)}${info.pageCount > 1 ? `-page${String(i + 1).padStart(3, "0")}` : ""}.${e}`, r.data));
      progress?.((i + 1) / info.pageCount);
    }
  } finally {
    pdf.close(id);
  }
  return files;
}

export async function pdfToText(file: File) {
  const pages = await pdf.extractText(await bytesOf(file));
  const text = pages.map((t, i) => (pages.length > 1 ? `--- Page ${i + 1} ---\n` : "") + t.trim()).join("\n\n");
  if (!text.replace(/--- Page \d+ ---/g, "").trim()) throw new Error("This PDF has no selectable text (it's probably a scan).");
  return out(`${stem(file.name)}.txt`, text + "\n");
}

export async function pdfToHtml(file: File) {
  const html = await pdf.toHtml(await bytesOf(file));
  return out(`${stem(file.name)}.html`, html);
}

export async function pdfToPptx(file: File, progress?: (n: number) => void) {
  const bytes = await bytesOf(file);
  const PptxGenJS = (await import("pptxgenjs")).default;
  const { id, info } = await pdf.open(bytes);
  const texts = await pdf.extractText(bytes);
  const deck = new PptxGenJS();
  const { w, h } = info.pages[0];
  deck.defineLayout({ name: "PDF", width: w / 72, height: h / 72 });
  deck.layout = "PDF";
  try {
    for (let i = 0; i < info.pageCount; i++) {
      const scale = Math.min(2.5, 2400 / Math.max(info.pages[i].w, info.pages[i].h));
      const r = await pdf.renderOpen(id, i, { scale, format: "jpeg", quality: 90 });
      let bin = "";
      for (let j = 0; j < r.data.length; j += 0x8000) bin += String.fromCharCode(...r.data.subarray(j, j + 0x8000));
      const slide = deck.addSlide();
      slide.addImage({ data: `image/jpeg;base64,${btoa(bin)}`, x: 0, y: 0, w: w / 72, h: h / 72 });
      if (texts[i]?.trim()) slide.addNotes(texts[i].trim());
      progress?.((i + 1) / info.pageCount);
    }
  } finally {
    pdf.close(id);
  }
  const blob = (await deck.write({ outputType: "blob" })) as Blob;
  return out(`${stem(file.name)}.pptx`, blob);
}
