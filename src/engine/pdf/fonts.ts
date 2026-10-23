/**
 * Font substitution for the PDF editor.
 *
 * When the document's own (usually subsetted) font can't draw the new text,
 * we pick a metric-compatible open font so line lengths stay the same:
 *   Calibri -> Carlito, Cambria -> Caladea (bundled in /public/fonts),
 *   Arial/Helvetica -> Helvetica, Times -> Times, Courier -> Courier (built in).
 */
export type FontTraits = { name: string; bold: boolean; italic: boolean; serif: boolean; mono: boolean };

const style = (t: FontTraits) => (t.bold && t.italic ? "BoldItalic" : t.bold ? "Bold" : t.italic ? "Italic" : "Regular");

export function fallbackFontFile(t: FontTraits): string | null {
  const n = t.name.toLowerCase().replace(/[\s_-]/g, "");
  if (n.includes("calibri") || n.includes("carlito")) return `Carlito-${style(t)}.ttf`;
  if (n.includes("cambria") || n.includes("caladea")) return `Caladea-${style(t)}.ttf`;
  return null;
}

export function base14For(t: FontTraits): string {
  const s = style(t);
  if (t.mono) return { Regular: "Courier", Bold: "Courier-Bold", Italic: "Courier-Oblique", BoldItalic: "Courier-BoldOblique" }[s];
  if (t.serif) return { Regular: "Times-Roman", Bold: "Times-Bold", Italic: "Times-Italic", BoldItalic: "Times-BoldItalic" }[s];
  return { Regular: "Helvetica", Bold: "Helvetica-Bold", Italic: "Helvetica-Oblique", BoldItalic: "Helvetica-BoldOblique" }[s];
}

/** A CSS font stack that looks close to a PDF font, for on-screen editing. */
export function cssFontFor(t: FontTraits & { family?: string }): string {
  const fam = (t.family || t.name).replace(/["']/g, "");
  const generic = t.mono ? "ui-monospace, Consolas, monospace" : t.serif ? "Cambria, 'Times New Roman', serif" : "Calibri, Arial, sans-serif";
  return `"${fam}", ${generic}`;
}
