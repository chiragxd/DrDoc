/**
 * Turn semantic HTML (from Markdown, a web page or a PDF) into a real .docx with
 * Word headings, lists, tables, images, links and code blocks.
 */
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun, LevelFormat,
  Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
  type ParagraphChild,
} from "docx";

type Fmt = { bold?: boolean; italics?: boolean; underline?: boolean; strike?: boolean; code?: boolean; sup?: boolean; sub?: boolean; color?: string };
type Img = { data: Uint8Array; type: "png" | "jpg" | "gif" | "bmp"; w: number; h: number };
type Ctx = { images: Map<string, Img>; olCount: number };

const HEADINGS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1, H2: HeadingLevel.HEADING_2, H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4, H5: HeadingLevel.HEADING_5, H6: HeadingLevel.HEADING_6,
};
const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE", "NAV", "H1", "H2", "H3", "H4", "H5", "H6",
  "UL", "OL", "LI", "TABLE", "PRE", "BLOCKQUOTE", "HR", "FIGURE", "FIGCAPTION", "DL", "DT", "DD", "BODY"]);
const MAX_IMG_W = 600; // px, roughly the text width of an A4 page

async function loadImage(src: string): Promise<Img | null> {
  try {
    const blob = await (await fetch(src)).blob();
    const bmp = await createImageBitmap(blob);
    let type: Img["type"] = blob.type.includes("png") ? "png" : blob.type.includes("gif") ? "gif" : blob.type.includes("bmp") ? "bmp" : "jpg";
    let data = new Uint8Array(await blob.arrayBuffer());
    if (!/png|jpe?g|gif|bmp/.test(blob.type)) {
      // webp/svg etc.: re-encode as PNG so Word can show it
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      data = new Uint8Array(await (await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"))).arrayBuffer());
      type = "png";
    }
    const img = { data, type, w: bmp.width, h: bmp.height };
    bmp.close();
    return img;
  } catch {
    return null;
  }
}

function runs(node: Node, fmt: Fmt, ctx: Ctx): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  node.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = (n.textContent ?? "").replace(/\s+/g, " ");
      if (text) out.push(textRun(text, fmt));
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    const tag = n.tagName;
    const f: Fmt = { ...fmt };
    if (tag === "B" || tag === "STRONG") f.bold = true;
    if (tag === "I" || tag === "EM") f.italics = true;
    if (tag === "U" || tag === "INS") f.underline = true;
    if (tag === "S" || tag === "DEL" || tag === "STRIKE") f.strike = true;
    if (tag === "CODE" || tag === "KBD" || tag === "SAMP") f.code = true;
    if (tag === "SUP") f.sup = true;
    if (tag === "SUB") f.sub = true;
    const style = n.getAttribute("style") ?? "";
    if (/font-weight:\s*(bold|[6-9]00)/.test(style)) f.bold = true;
    if (/font-style:\s*italic/.test(style)) f.italics = true;
    const color = /(?:^|;)\s*color:\s*#([0-9a-f]{6})/i.exec(style);
    if (color) f.color = color[1];

    if (tag === "BR") out.push(new TextRun({ text: "", break: 1 }));
    else if (tag === "IMG") {
      const img = ctx.images.get((n as HTMLImageElement).getAttribute("src") ?? "");
      if (img) {
        const s = Math.min(1, MAX_IMG_W / img.w);
        out.push(new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.w * s), height: Math.round(img.h * s) } } as never));
      }
    } else if (tag === "A" && (n as HTMLAnchorElement).getAttribute("href")?.match(/^(https?:|mailto:)/)) {
      out.push(new ExternalHyperlink({ link: (n as HTMLAnchorElement).href, children: runs(n, { ...f, underline: true, color: "0B62C4" }, ctx) as TextRun[] }));
    } else if (tag === "INPUT" && (n as HTMLInputElement).type === "checkbox") {
      out.push(textRun((n as HTMLInputElement).checked ? "☑ " : "☐ ", f));
    } else if (!BLOCK.has(tag)) out.push(...runs(n, f, ctx));
  });
  return out;
}

function textRun(text: string, f: Fmt) {
  return new TextRun({
    text, bold: f.bold, italics: f.italics, strike: f.strike, color: f.color,
    underline: f.underline ? {} : undefined, superScript: f.sup, subScript: f.sub,
    font: f.code ? "Consolas" : undefined, size: f.code ? 19 : undefined,
    shading: f.code ? { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F0" } : undefined,
  });
}

function trimRuns(children: ParagraphChild[]) {
  return children;
}

function blocks(el: Element, ctx: Ctx, opts: { list?: { ordered: boolean; level: number; instance: number }; quote?: boolean } = {}): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  let inline: Node[] = [];

  const flush = () => {
    if (!inline.length) return;
    const holder = document.createElement("span");
    inline.forEach((n) => holder.appendChild(n.cloneNode(true)));
    inline = [];
    if (!holder.textContent?.trim() && !holder.querySelector("img")) return;
    out.push(para(runs(holder, {}, ctx), opts));
  };

  el.childNodes.forEach((n) => {
    if (!(n instanceof HTMLElement) || !BLOCK.has(n.tagName)) {
      inline.push(n);
      return;
    }
    flush();
    const tag = n.tagName;
    if (HEADINGS[tag]) {
      out.push(new Paragraph({ heading: n.classList.contains("title") ? HeadingLevel.TITLE : HEADINGS[tag], children: trimRuns(runs(n, {}, ctx)) }));
    } else if (tag === "UL" || tag === "OL") {
      const ordered = tag === "OL";
      const level = opts.list ? Math.min(opts.list.level + 1, 8) : 0;
      const instance = ordered ? ++ctx.olCount : 0;
      n.childNodes.forEach((li) => {
        if (li instanceof HTMLElement && li.tagName === "LI") out.push(...blocks(li, ctx, { list: { ordered, level, instance } }));
      });
    } else if (tag === "LI") {
      out.push(...blocks(n, ctx, opts));
    } else if (tag === "TABLE") {
      out.push(table(n as HTMLTableElement, ctx));
    } else if (tag === "PRE") {
      const lines = (n.textContent ?? "").replace(/\n$/, "").split("\n");
      lines.forEach((line, i) =>
        out.push(new Paragraph({
          children: [new TextRun({ text: line || " ", font: "Consolas", size: 18 })],
          shading: { type: ShadingType.CLEAR, color: "auto", fill: "F5F5F3" },
          spacing: { before: i === 0 ? 120 : 0, after: i === lines.length - 1 ? 160 : 0, line: 260 },
        })),
      );
    } else if (tag === "BLOCKQUOTE") {
      out.push(...blocks(n, ctx, { ...opts, quote: true }));
    } else if (tag === "HR") {
      out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } }, children: [] }));
    } else {
      out.push(...blocks(n, ctx, opts));
    }
  });
  flush();
  return out;
}

function para(children: ParagraphChild[], opts: { list?: { ordered: boolean; level: number; instance: number }; quote?: boolean }) {
  const { list, quote } = opts;
  return new Paragraph({
    children,
    ...(list
      ? list.ordered
        ? { numbering: { reference: "ordered", level: list.level, instance: list.instance } }
        : { bullet: { level: list.level } }
      : {}),
    ...(quote
      ? { indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: "D0D0CC", space: 8 } } }
      : {}),
  });
}

function table(t: HTMLTableElement, ctx: Ctx) {
  const rows = [...t.rows].map((tr) =>
    new TableRow({
      tableHeader: tr.parentElement?.tagName === "THEAD",
      children: [...tr.cells].map((cell) => {
        const header = cell.tagName === "TH";
        let content = blocks(cell, ctx).filter((b): b is Paragraph => b instanceof Paragraph);
        if (!content.length) content = [new Paragraph({ children: [] })];
        if (header) content = [new Paragraph({ children: runs(cell, { bold: true }, ctx) })];
        const align = (cell.getAttribute("align") || cell.style.textAlign || "").toLowerCase();
        if (align === "right" || align === "center") {
          content = [new Paragraph({ alignment: align === "right" ? AlignmentType.RIGHT : AlignmentType.CENTER, children: runs(cell, { bold: header }, ctx) })];
        }
        return new TableCell({
          children: content,
          columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
          shading: header ? { type: ShadingType.CLEAR, color: "auto", fill: "F2F2EF" } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
        });
      }),
    }),
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

export async function htmlToDocx(html: string, o: { title?: string; font?: string } = {}): Promise<Blob> {
  const dom = new DOMParser().parseFromString(html, "text/html");
  dom.querySelectorAll("script, style, noscript, template").forEach((n) => n.remove());
  const ctx: Ctx = { images: new Map(), olCount: 0 };
  await Promise.all(
    [...dom.querySelectorAll("img")].map(async (img) => {
      const src = img.getAttribute("src");
      if (src && !ctx.images.has(src)) {
        const loaded = await loadImage(src);
        if (loaded) ctx.images.set(src, loaded);
      }
    }),
  );
  const children = blocks(dom.body, ctx);
  const doc = new Document({
    title: o.title,
    creator: "DrDoc",
    styles: { default: { document: { run: { font: o.font ?? "Calibri", size: 22 } } } },
    numbering: {
      config: [{
        reference: "ordered",
        levels: Array.from({ length: 9 }, (_, level) => ({
          level,
          format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{ children: children.length ? children : [new Paragraph({ children: [] })] }],
  });
  return Packer.toBlob(doc);
}
