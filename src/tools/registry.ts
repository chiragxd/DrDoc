import {
  BookOpen, Braces, Camera, Combine, Contrast, FileCode, FileDown, FileMinus, FileOutput, FilePen, FileSpreadsheet, FileText,
  FileType, Globe, Hash, Images, ImageDown, LayoutGrid, Lock, LockOpen, Presentation, RotateCw, Scissors, Sheet, Signature,
  Stamp, Type, Wrench, Code, Image as ImageIcon, FileImage, type LucideIcon,
} from "lucide-react";
import { pdf } from "../engine/pdf/client";
import * as D from "../engine/convert/documents";
import * as P from "../engine/convert/from-pdf";
import { pptxToImages, pptxToPdf } from "../engine/convert/pptx";
import { convertImage, imageForPdf, IMAGE_EXT, type Look } from "../engine/convert/images";
import { bytesOf, out, stem, type OutFile } from "../lib/files";
import { parseGroups, parseRanges } from "../lib/ranges";

export type Option =
  | { name: string; label: string; type: "select"; choices: [string, string][]; default: string; help?: string; showIf?: [string, string] }
  | { name: string; label: string; type: "text" | "password" | "number"; default?: string; placeholder?: string; help?: string; showIf?: [string, string] }
  | { name: string; label: string; type: "checkbox"; default?: boolean; help?: string; showIf?: [string, string] };

export type RunContext = { progress: (fraction: number) => void };
export type Opts = Record<string, string>;

export type Tool = {
  id: string;
  name: string;
  desc: string;
  cat: Category;
  icon: LucideIcon;
  accept: string[];
  multiple?: boolean;
  /** Order of input files matters (shows drag handles). */
  ordered?: boolean;
  options?: Option[];
  keywords?: string;
  action?: string;
  /** Tools with their own full-screen workspace. */
  page?: "editor" | "organizer" | "scanner";
  run?: (files: File[], opts: Opts, ctx: RunContext) => Promise<OutFile | OutFile[]>;
};

export const CATEGORIES = ["Edit", "Organize", "Optimize & secure", "Convert to PDF", "Convert from PDF", "Documents & images"] as const;
export type Category = (typeof CATEGORIES)[number];

const WORD = ["docx"];
const PPT = ["pptx"];
const XLS = ["xlsx", "xlsm", "xls", "ods", "csv"];
const MD = ["md", "markdown", "txt"];
const HTML = ["html", "htm"];

const PAGE_SIZE: Option = { name: "pageSize", label: "Page size", type: "select", default: "a4", choices: [["a4", "A4"], ["letter", "US Letter"], ["legal", "US Legal"], ["a5", "A5"], ["a3", "A3"]] };
const RANGE_HELP = "Like 1-3, 5, 8-last. Order is kept, so 3, 1, 2 reorders pages.";

/** Run a per-file conversion over every input, with progress. */
const each = (fn: (f: File, o: Opts, ctx: RunContext) => Promise<OutFile | OutFile[]>) =>
  async (files: File[], o: Opts, ctx: RunContext) => {
    const res: OutFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const sub: RunContext = { progress: (n) => ctx.progress((i + n) / files.length) };
      const r = await fn(files[i], o, sub);
      res.push(...(Array.isArray(r) ? r : [r]));
      ctx.progress((i + 1) / files.length);
    }
    return res;
  };

/** Apply a bytes -> bytes PDF operation to each file. */
const pdfOp = (suffix: string, fn: (b: Uint8Array, o: Opts) => Promise<Uint8Array>) =>
  each(async (f, o) => out(`${stem(f.name)}${suffix}.pdf`, await fn(await bytesOf(f), o)));

async function pageCount(bytes: Uint8Array) {
  const info = await pdf.info(bytes);
  if (info.locked) throw new Error("This PDF is password protected. Use Unlock PDF first.");
  return info.pageCount;
}

const COMPRESS = {
  light: { dpi: 200, quality: 85 },
  recommended: { dpi: 150, quality: 72 },
  strong: { dpi: 110, quality: 60 },
  extreme: { dpi: 72, quality: 45 },
} as const;

export const TOOLS: Tool[] = [
  // ----------------------------------------------------------------- Edit
  { id: "edit-pdf", name: "Edit PDF", desc: "Change existing text in place, add text, images and shapes.", cat: "Edit", icon: FilePen, accept: ["pdf"], page: "editor", keywords: "modify change text typo fix" },
  { id: "sign-pdf", name: "Sign PDF", desc: "Draw or upload your signature and place it on the page.", cat: "Edit", icon: Signature, accept: ["pdf"], page: "editor", keywords: "signature initials esign" },
  {
    id: "page-numbers", name: "Add page numbers", desc: "Number pages in the corner or centre, top or bottom.", cat: "Edit", icon: Hash, accept: ["pdf"], multiple: true, action: "Add numbers",
    options: [
      { name: "position", label: "Position", type: "select", default: "bottom-center", choices: [["bottom-center", "Bottom centre"], ["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"], ["top-center", "Top centre"], ["top-right", "Top right"], ["top-left", "Top left"]] },
      { name: "format", label: "Style", type: "select", default: "{n}", choices: [["{n}", "1"], ["Page {n}", "Page 1"], ["Page {n} of {total}", "Page 1 of 10"], ["{n} / {total}", "1 / 10"]] },
      { name: "start", label: "Start on page", type: "number", default: "1", help: "Skip a cover page by starting on page 2." },
      { name: "size", label: "Size", type: "select", default: "10", choices: [["9", "Small"], ["10", "Normal"], ["12", "Large"]] },
    ],
    run: pdfOp("-numbered", (b, o) => pdf.pageNumbers(b, { position: o.position as never, format: o.format, start: Math.max(1, +o.start || 1), size: +o.size })),
  },
  {
    id: "watermark", name: "Add watermark", desc: "Stamp text like DRAFT or CONFIDENTIAL across every page.", cat: "Edit", icon: Stamp, accept: ["pdf"], multiple: true, action: "Add watermark",
    options: [
      { name: "text", label: "Text", type: "text", default: "CONFIDENTIAL" },
      { name: "angle", label: "Direction", type: "select", default: "45", choices: [["45", "Diagonal"], ["0", "Horizontal"]] },
      { name: "color", label: "Colour", type: "select", default: "gray", choices: [["gray", "Grey"], ["red", "Red"], ["blue", "Blue"]] },
      { name: "opacity", label: "Strength", type: "select", default: "0.15", choices: [["0.1", "Faint"], ["0.15", "Light"], ["0.3", "Medium"], ["0.5", "Strong"]] },
    ],
    run: pdfOp("-watermarked", (b, o) => {
      if (!o.text.trim()) throw new Error("Enter the watermark text.");
      const color = { gray: [0.45, 0.45, 0.45], red: [0.8, 0.1, 0.1], blue: [0.1, 0.3, 0.8] }[o.color] ?? [0.5, 0.5, 0.5];
      return pdf.watermark(b, { text: o.text.trim(), size: 72, opacity: +o.opacity, color, angle: +o.angle });
    }),
  },

  // ----------------------------------------------------------------- Organize
  { id: "organize", name: "Organize pages", desc: "Drag pages into order, rotate, delete, duplicate or insert blanks.", cat: "Organize", icon: LayoutGrid, accept: ["pdf", ...IMAGE_EXT], multiple: true, page: "organizer", keywords: "reorder move sort arrange pages" },
  { id: "merge", name: "Merge PDFs", desc: "Combine PDFs and images into one file, in any order.", cat: "Organize", icon: Combine, accept: ["pdf", ...IMAGE_EXT], multiple: true, page: "organizer", keywords: "combine join append" },
  {
    id: "split", name: "Split PDF", desc: "Break a PDF into single pages, chunks or custom groups.", cat: "Organize", icon: Scissors, accept: ["pdf"], action: "Split PDF",
    options: [
      { name: "mode", label: "Split into", type: "select", default: "each", choices: [["each", "One file per page"], ["every", "Chunks of N pages"], ["groups", "Custom groups"]] },
      { name: "every", label: "Pages per file", type: "number", default: "2", showIf: ["mode", "every"] },
      { name: "groups", label: "Groups", type: "text", placeholder: "1-3; 4-6; 7-last", help: "Separate files with a semicolon.", showIf: ["mode", "groups"] },
    ],
    run: async ([f], o) => {
      const bytes = await bytesOf(f);
      const n = await pageCount(bytes);
      let groups: number[][];
      if (o.mode === "every") {
        const k = Math.max(1, +o.every || 1);
        groups = Array.from({ length: Math.ceil(n / k) }, (_, i) => Array.from({ length: Math.min(k, n - i * k) }, (_, j) => i * k + j));
      } else if (o.mode === "groups") groups = parseGroups(o.groups, n);
      else groups = Array.from({ length: n }, (_, i) => [i]);
      const parts = await pdf.split(bytes, groups);
      return parts.map((p, i) => {
        const g = groups[i];
        const label = g.length === 1 ? `p${g[0] + 1}` : `p${g[0] + 1}-${g.at(-1)! + 1}`;
        return out(`${stem(f.name)}-${label}.pdf`, p);
      });
    },
  },
  {
    id: "extract-pages", name: "Extract pages", desc: "Pull out the pages you need into a new PDF.", cat: "Organize", icon: FileOutput, accept: ["pdf"], action: "Extract pages",
    options: [{ name: "pages", label: "Pages to keep", type: "text", placeholder: "1-3, 5", help: RANGE_HELP }],
    run: async ([f], o) => {
      const bytes = await bytesOf(f);
      const pages = parseRanges(o.pages, await pageCount(bytes));
      return out(`${stem(f.name)}-extract.pdf`, await pdf.compose([{ bytes }], pages.map((index) => ({ src: 0, index }))));
    },
  },
  {
    id: "remove-pages", name: "Remove pages", desc: "Delete pages you don't want.", cat: "Organize", icon: FileMinus, accept: ["pdf"], action: "Remove pages",
    options: [{ name: "pages", label: "Pages to remove", type: "text", placeholder: "2, 4-5", help: "Like 2, 4-5, last." }],
    run: async ([f], o) => {
      const bytes = await bytesOf(f);
      const n = await pageCount(bytes);
      const drop = new Set(parseRanges(o.pages, n));
      const keep = Array.from({ length: n }, (_, i) => i).filter((i) => !drop.has(i));
      if (!keep.length) throw new Error("That would remove every page.");
      return out(`${stem(f.name)}-edited.pdf`, await pdf.compose([{ bytes }], keep.map((index) => ({ src: 0, index }))));
    },
  },
  {
    id: "rotate", name: "Rotate PDF", desc: "Turn every page, or just the ones you pick.", cat: "Organize", icon: RotateCw, accept: ["pdf"], multiple: true, action: "Rotate",
    options: [
      { name: "angle", label: "Rotate", type: "select", default: "90", choices: [["90", "90° clockwise"], ["180", "180°"], ["270", "90° anticlockwise"]] },
      { name: "pages", label: "Only these pages", type: "text", placeholder: "All pages", help: "Leave empty to rotate every page." },
    ],
    run: each(async (f, o) => {
      const bytes = await bytesOf(f);
      const n = await pageCount(bytes);
      const only = o.pages?.trim() ? new Set(parseRanges(o.pages, n)) : null;
      const pages = Array.from({ length: n }, (_, index) => ({ src: 0, index, rotate: !only || only.has(index) ? +o.angle : 0 }));
      return out(`${stem(f.name)}-rotated.pdf`, await pdf.compose([{ bytes }], pages));
    }),
  },

  // ----------------------------------------------------------------- Optimize & secure
  {
    id: "compress", name: "Compress PDF", desc: "Make PDFs smaller by optimising images. Text stays sharp.", cat: "Optimize & secure", icon: FileDown, accept: ["pdf"], multiple: true, action: "Compress", keywords: "reduce size shrink smaller",
    options: [
      { name: "level", label: "Compression", type: "select", default: "recommended", choices: [["recommended", "Recommended"], ["light", "Light: best quality"], ["strong", "Strong: smaller file"], ["extreme", "Extreme: smallest file"]] },
      { name: "gray", label: "Convert images to greyscale", type: "checkbox" },
    ],
    run: pdfOp("-compressed", (b, o) => pdf.compress(b, { ...COMPRESS[o.level as keyof typeof COMPRESS], gray: o.gray === "on" })),
  },
  {
    id: "protect", name: "Protect PDF", desc: "Lock a PDF with a password (AES-256).", cat: "Optimize & secure", icon: Lock, accept: ["pdf"], multiple: true, action: "Protect PDF", keywords: "encrypt password secure",
    options: [
      { name: "password", label: "Password", type: "password" },
      { name: "confirm", label: "Repeat password", type: "password" },
    ],
    run: pdfOp("-protected", (b, o) => {
      if (!o.password) throw new Error("Enter a password.");
      if (o.password !== o.confirm) throw new Error("The passwords don't match.");
      return pdf.protect(b, o.password, true, true);
    }),
  },
  {
    id: "unlock", name: "Unlock PDF", desc: "Remove the password from a PDF you're allowed to open.", cat: "Optimize & secure", icon: LockOpen, accept: ["pdf"], multiple: true, action: "Unlock PDF", keywords: "decrypt remove password",
    options: [{ name: "password", label: "Current password", type: "password", help: "Leave empty if it opens without one but blocks printing or copying." }],
    run: pdfOp("-unlocked", (b, o) => pdf.unlock(b, o.password ?? "")),
  },
  { id: "repair", name: "Repair PDF", desc: "Rebuild damaged PDFs that won't open properly.", cat: "Optimize & secure", icon: Wrench, accept: ["pdf"], multiple: true, action: "Repair", keywords: "fix broken corrupt", run: pdfOp("-repaired", (b) => pdf.repair(b)) },
  {
    id: "grayscale", name: "Greyscale PDF", desc: "A black-and-white copy, ready for printing.", cat: "Optimize & secure", icon: Contrast, accept: ["pdf"], multiple: true, action: "Convert", keywords: "black white gray print",
    options: [{ name: "dpi", label: "Quality", type: "select", default: "150", choices: [["150", "Standard"], ["200", "High"], ["110", "Smaller file"]], help: "Pages are converted to images." }],
    run: pdfOp("-greyscale", (b, o) => pdf.grayscale(b, +o.dpi)),
  },

  // ----------------------------------------------------------------- Convert to PDF
  { id: "scan", name: "Scan to PDF", desc: "Use your phone camera to scan paper into a clean PDF.", cat: "Convert to PDF", icon: Camera, accept: ["jpg", "jpeg", "png", "heic", "heif", "webp"], page: "scanner", keywords: "camera photo document scanner" },
  {
    id: "images-to-pdf", name: "Images to PDF", desc: "JPG, PNG, HEIC and WebP photos into one PDF.", cat: "Convert to PDF", icon: Images, accept: IMAGE_EXT, multiple: true, ordered: true, keywords: "jpg png heic photo picture",
    options: [
      { ...PAGE_SIZE, choices: [...(PAGE_SIZE as { choices: [string, string][] }).choices, ["fit", "Same as image"]] } as Option,
      { name: "margin", label: "Margin", type: "select", default: "24", choices: [["0", "None"], ["24", "Small"], ["48", "Large"]], showIf: ["pageSize", "!fit"] },
      { name: "look", label: "Look", type: "select", default: "original", choices: [["original", "Original"], ["auto", "Document: whiter paper"], ["gray", "Greyscale"], ["bw", "Black and white"]] },
      { name: "quality", label: "Image quality", type: "select", default: "0.85", choices: [["0.85", "High"], ["0.7", "Medium: smaller"], ["0.95", "Maximum"]] },
    ],
    run: async (files, o, ctx) => {
      const imgs: { bytes: Uint8Array; w: number; h: number }[] = [];
      for (let i = 0; i < files.length; i++) {
        imgs.push(await imageForPdf(files[i], { quality: +o.quality, look: o.look as Look }));
        ctx.progress((i + 1) / (files.length + 1));
      }
      const name = files.length === 1 ? stem(files[0].name) : "images";
      return out(`${name}.pdf`, await pdf.imagesToPdf(imgs, { pageSize: o.pageSize, margin: +o.margin || 0 }));
    },
  },
  { id: "word-to-pdf", name: "Word to PDF", desc: "DOCX documents to PDF, with tables and images.", cat: "Convert to PDF", icon: FileText, accept: WORD, multiple: true, options: [PAGE_SIZE], run: each((f, o) => D.wordToPdf(f, { pageSize: o.pageSize })) },
  { id: "ppt-to-pdf", name: "PowerPoint to PDF", desc: "PPTX slides to PDF, one slide per page.", cat: "Convert to PDF", icon: Presentation, accept: PPT, multiple: true, keywords: "slides presentation deck", run: each((f, _o, ctx) => pptxToPdf(f, ctx.progress)) },
  {
    id: "excel-to-pdf", name: "Excel to PDF", desc: "Spreadsheets and CSV to PDF, each sheet on its own pages.", cat: "Convert to PDF", icon: FileSpreadsheet, accept: XLS, multiple: true,
    options: [PAGE_SIZE, { name: "orientation", label: "Orientation", type: "select", default: "auto", choices: [["auto", "Automatic"], ["portrait", "Portrait"], ["landscape", "Landscape"]] }],
    run: each((f, o) => D.excelToPdf(f, { orientation: o.orientation, pageSize: o.pageSize })),
  },
  { id: "markdown-to-pdf", name: "Markdown to PDF", desc: "Styled PDF from .md, with tables and code.", cat: "Convert to PDF", icon: FileCode, accept: MD, multiple: true, options: [PAGE_SIZE], run: each((f, o) => D.markdownToPdf(f, { pageSize: o.pageSize })) },
  { id: "html-to-pdf", name: "HTML to PDF", desc: "Saved web pages and .html files to PDF.", cat: "Convert to PDF", icon: Globe, accept: HTML, multiple: true, options: [PAGE_SIZE], run: each((f, o) => D.htmlToPdf(f, { pageSize: o.pageSize })) },
  {
    id: "text-to-pdf", name: "Text to PDF", desc: "Plain text, notes, logs or code to PDF.", cat: "Convert to PDF", icon: Type, accept: ["txt", "log", "json", "xml", "csv", "js", "ts", "py", "java", "c", "cpp", "css", "ini", "yaml", "yml"], multiple: true,
    options: [PAGE_SIZE, { name: "font", label: "Font", type: "select", default: "sans", choices: [["sans", "Normal"], ["mono", "Monospace (code)"]] }],
    run: each((f, o) => D.textToPdf(f, { pageSize: o.pageSize, font: o.font })),
  },
  { id: "epub-to-pdf", name: "EPUB to PDF", desc: "E-books to printable PDF pages.", cat: "Convert to PDF", icon: BookOpen, accept: ["epub"], multiple: true, options: [PAGE_SIZE], run: each((f, o) => D.epubToPdf(f, { pageSize: o.pageSize })) },

  // ----------------------------------------------------------------- Convert from PDF
  { id: "pdf-to-word", name: "PDF to Word", desc: "Editable DOCX with fonts, headings, lists and images.", cat: "Convert from PDF", icon: FileText, accept: ["pdf"], multiple: true, run: each((f) => P.pdfToWord(f)) },
  {
    id: "pdf-to-images", name: "PDF to images", desc: "Every page as a PNG or JPG.", cat: "Convert from PDF", icon: FileImage, accept: ["pdf"], multiple: true, keywords: "jpg png picture",
    options: [
      { name: "format", label: "Format", type: "select", default: "png", choices: [["png", "PNG"], ["jpeg", "JPG"]] },
      { name: "dpi", label: "Resolution", type: "select", default: "150", choices: [["96", "Screen (96 dpi)"], ["150", "Standard (150 dpi)"], ["300", "Print (300 dpi)"]] },
    ],
    run: each((f, o, ctx) => P.pdfToImages(f, { format: o.format as "png" | "jpeg", dpi: +o.dpi }, ctx.progress)),
  },
  { id: "pdf-to-ppt", name: "PDF to PowerPoint", desc: "One slide per page; page text goes in the notes.", cat: "Convert from PDF", icon: Presentation, accept: ["pdf"], multiple: true, keywords: "pptx slides", run: each((f, _o, ctx) => P.pdfToPptx(f, ctx.progress)) },
  { id: "pdf-to-text", name: "PDF to text", desc: "All the selectable text as a .txt file.", cat: "Convert from PDF", icon: Type, accept: ["pdf"], multiple: true, run: each((f) => P.pdfToText(f)) },
  { id: "pdf-to-markdown", name: "PDF to Markdown", desc: "Headings, emphasis, lists and images as Markdown.", cat: "Convert from PDF", icon: FileCode, accept: ["pdf"], multiple: true, run: each((f) => P.pdfToMarkdown(f)) },
  { id: "pdf-to-html", name: "PDF to HTML", desc: "A web page that keeps the page layout.", cat: "Convert from PDF", icon: Code, accept: ["pdf"], multiple: true, run: each((f) => P.pdfToHtml(f)) },

  // ----------------------------------------------------------------- Documents & images
  { id: "word-to-markdown", name: "Word to Markdown", desc: "DOCX to clean Markdown. Images are kept.", cat: "Documents & images", icon: FileCode, accept: WORD, multiple: true, run: each((f) => D.wordToMarkdown(f)) },
  { id: "markdown-to-word", name: "Markdown to Word", desc: "Headings, lists, tables and code into DOCX.", cat: "Documents & images", icon: FileText, accept: MD, multiple: true, run: each((f) => D.markdownToWord(f)) },
  { id: "word-to-html", name: "Word to HTML", desc: "A tidy single-file web page from DOCX.", cat: "Documents & images", icon: Globe, accept: WORD, multiple: true, run: each((f) => D.wordToHtml(f)) },
  { id: "html-to-word", name: "HTML to Word", desc: "Web pages to an editable DOCX.", cat: "Documents & images", icon: FileText, accept: HTML, multiple: true, run: each((f) => D.htmlToWord(f)) },
  { id: "markdown-to-html", name: "Markdown to HTML", desc: "A styled, self-contained web page.", cat: "Documents & images", icon: Globe, accept: MD, multiple: true, run: each((f) => D.markdownToHtml(f)) },
  { id: "html-to-markdown", name: "HTML to Markdown", desc: "Turn web pages into clean Markdown.", cat: "Documents & images", icon: FileCode, accept: HTML, multiple: true, run: each((f) => D.htmlToMarkdownFile(f)) },
  { id: "word-to-text", name: "Word to text", desc: "Just the words from a DOCX.", cat: "Documents & images", icon: FileType, accept: WORD, multiple: true, run: each((f) => D.wordToText(f)) },
  {
    id: "ppt-to-images", name: "PowerPoint to images", desc: "Every slide as a PNG or JPG.", cat: "Documents & images", icon: ImageIcon, accept: PPT, multiple: true,
    options: [{ name: "format", label: "Format", type: "select", default: "png", choices: [["png", "PNG"], ["jpeg", "JPG"]] }],
    run: each((f, o, ctx) => pptxToImages(f, { format: o.format as "png" | "jpeg" }, ctx.progress)),
  },
  { id: "excel-to-csv", name: "Excel to CSV", desc: "Each sheet becomes a CSV file.", cat: "Documents & images", icon: Sheet, accept: ["xlsx", "xlsm", "xls", "ods"], multiple: true, run: each((f) => D.excelToCsv(f)) },
  { id: "csv-to-excel", name: "CSV to Excel", desc: "One or more CSVs into a workbook, one sheet each.", cat: "Documents & images", icon: FileSpreadsheet, accept: ["csv", "tsv", "txt"], multiple: true, ordered: true, run: (files) => D.csvToExcel(files) },
  { id: "excel-to-json", name: "Excel to JSON", desc: "Rows as JSON objects, keyed by the header row.", cat: "Documents & images", icon: Braces, accept: ["xlsx", "xlsm", "xls", "ods", "csv"], multiple: true, run: each((f) => D.excelToJson(f)) },
  {
    id: "convert-images", name: "Convert images", desc: "HEIC, PNG, WebP, JPG: convert any to any.", cat: "Documents & images", icon: ImageIcon, accept: IMAGE_EXT, multiple: true, keywords: "heic jpg png webp format",
    options: [
      { name: "format", label: "Convert to", type: "select", default: "jpg", choices: [["jpg", "JPG"], ["png", "PNG"], ["webp", "WebP"]] },
      { name: "quality", label: "Quality", type: "select", default: "0.88", choices: [["0.88", "High"], ["0.75", "Medium: smaller"], ["0.95", "Maximum"]], showIf: ["format", "!png"] },
    ],
    run: each((f, o) => convertImage(f, { format: o.format as "jpg", quality: +o.quality })),
  },
  {
    id: "resize-images", name: "Resize images", desc: "Shrink photos for email, web or upload.", cat: "Documents & images", icon: ImageDown, accept: IMAGE_EXT, multiple: true, action: "Resize", keywords: "compress smaller photo",
    options: [
      { name: "maxSide", label: "Longest side", type: "select", default: "1920", choices: [["3840", "3840 px (4K)"], ["2560", "2560 px"], ["1920", "1920 px (Full HD)"], ["1280", "1280 px"], ["1024", "1024 px"], ["800", "800 px"]] },
      { name: "format", label: "Save as", type: "select", default: "jpg", choices: [["jpg", "JPG"], ["webp", "WebP"], ["png", "PNG"]] },
      { name: "quality", label: "Quality", type: "select", default: "0.8", choices: [["0.8", "Balanced"], ["0.65", "Smaller"], ["0.92", "High"]], showIf: ["format", "!png"] },
    ],
    run: each((f, o) => convertImage(f, { format: o.format as "jpg", quality: +o.quality, maxSide: +o.maxSide })),
  },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

export const POPULAR = ["edit-pdf", "organize", "merge", "compress", "pdf-to-word", "scan"];

export function toolsForFile(name: string) {
  const e = (name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
  return TOOLS.filter((t) => t.accept.includes(e));
}

export function acceptAttr(t: Tool) {
  const exts = t.accept.map((e) => "." + e);
  if (t.accept.includes("jpg")) exts.push("image/*");
  return exts.join(",");
}
