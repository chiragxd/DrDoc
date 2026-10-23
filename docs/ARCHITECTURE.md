# Architecture

DrDoc is a client-only React app. Every conversion happens in the browser; nothing is sent to a server.

## Layers

```
src/pages ─────── screens (Home, ToolPage, Editor, Organizer, Scanner)
   │
src/tools/registry.ts ── one entry per tool: id, category, options, run(files, opts)
   │
src/engine/convert ───── format converters (main thread: need DOM/canvas)
   │
src/engine/pdf/client ── Promise API to the worker:  await pdf.compress(bytes, opts)
   │  postMessage
src/engine/pdf/worker ── queues messages until MuPDF is loaded
src/engine/pdf/host ──── dispatches to core, serialises calls, transfers buffers
src/engine/pdf/core ──── all PDF logic on top of MuPDF (also runs in Node tests)
```

### Why a worker

MuPDF is a 10 MB WebAssembly module and some jobs (compressing a 200-page scan) take seconds. Running it in a Web Worker keeps scrolling and typing smooth. `worker.ts` starts listening immediately and queues messages, because MuPDF loads with a top-level `await` and early messages would otherwise be lost. `host.ts` processes calls strictly in order, so an editor render can never overtake the edit before it.

### `core.ts` is environment-agnostic

`core.ts` takes and returns plain bytes and JSON, so the same code runs in the worker and in Vitest under Node (`tests/engine.test.ts`). The only environment-specific piece is font loading, injected with `setFontLoader()`.

## The PDF editor

Editing existing text is the hardest feature. How it works:

1. **Read lines with styles.** MuPDF's structured-text walker reports every character with its font object, size, colour and position. Characters are grouped into lines and into *runs* (same font, size and colour). Fragments MuPDF reports separately on the same baseline are merged, so a sentence with a bold word stays one editable line.
2. **Edit in place.** Clicking a line opens a `contenteditable` box exactly over it. Each run is a `<span>` styled to match, and new characters inherit the style of the run you type into.
3. **Remove the old glyphs.** A redaction annotation is placed over the line and applied in *text-only* mode: the glyphs are removed from the content stream, while images and vector drawings (table borders, underlines) are untouched.
4. **Re-insert with the right font.** For each run, DrDoc uses the document's own embedded font if it contains every character typed. Embedded fonts are usually subsets, so new characters may be missing; then `fonts.ts` picks a substitute with matching metrics (Carlito for Calibri, Caladea for Cambria, the built-in Helvetica/Times/Courier families otherwise), keeping bold and italic. Text is written in a new content stream in page space, so rotated pages work.
5. **Replay.** The editor keeps the original file plus a list of edit operations. Every change rebuilds the document from the original and replays the operations, which makes undo/redo trivial and keeps the output clean.

Added text, images, signatures, white-out and highlights are HTML overlays while you work, so they're easy to drag and resize. They're written into the PDF only when you download.

## Converting to PDF

Word, Markdown, Excel and text are converted to semantic HTML first, then laid out by **MuPDF's HTML engine** into real vector PDF pages: selectable text, embedded subset fonts and proper page breaks. This gives consistent, well-typeset output without a browser print dialog.

- Word: `mammoth` turns DOCX into clean HTML. Picture sizes, which mammoth drops, are restored from the DOCX drawing extents.
- Excel/CSV: SheetJS renders each sheet as a table; wide sheets switch to landscape automatically.
- PowerPoint: `convert/pptx.ts` is a compact renderer that reads the slide XML (themes, layouts and masters, placeholders, pictures, shapes, tables, text with autofit) and paints each slide on a canvas.

## Converting from PDF

`core.structure()` returns pages as blocks → lines → spans with font, size, weight and colour, plus images. `convert/from-pdf.ts` rebuilds paragraphs (joining wrapped lines, undoing hyphenation, attaching bullet glyphs to their text), detects headings from the size relative to body text, and writes DOCX (`docx` library) or Markdown.

## Gotchas found while building

- In MuPDF.js, calling `.resolve()` on an indirect reference and then saving can drop that object from the file. Compression therefore works on the indirect references directly.
- `PDFObject.isStream()` is only true on the indirect reference, not on the resolved object.
- MuPDF's option string splits on commas, so passwords are passed quoted.

## Offline

`scripts/sw-plugin.ts` writes `sw.js` at build time with a precache list of every built asset. Pages are network-first (so updates arrive), and hashed assets are cache-first.
