# Tools reference

Every tool runs locally in the browser. "Many files" means you can add several files at once; outputs with more than one file can be downloaded individually or as a ZIP.

## Edit

| Tool | Input | What it does | Options |
|---|---|---|---|
| Edit PDF | PDF | Click a line to retype it in the original font, size and colour. Add text boxes, images, signatures, white-out and highlights. Undo/redo, zoom, page thumbnails. | In the toolbar |
| Sign PDF | PDF | Opens the editor with the signature pad: draw (finger, pen or mouse), type, or upload an image. Drag and resize to place it. | Ink colour |
| Add page numbers | PDF (many) | Stamps page numbers. | Position (6 places), style (`1`, `Page 1`, `Page 1 of 10`, `1 / 10`), first numbered page, size |
| Add watermark | PDF (many) | Semi-transparent text across each page, auto-fitted to the page. | Text, diagonal/horizontal, colour, strength |

## Organize

| Tool | Input | What it does |
|---|---|---|
| Organize pages | PDF, images (many) | Thumbnails of every page. Drag to reorder (works on touch screens), rotate left/right, duplicate, delete, insert blank pages, select several pages for bulk actions. |
| Merge PDFs | PDF, images (many) | Same workspace, tuned for combining: drag file chips to reorder whole files, or drag single pages anywhere. Password-protected PDFs prompt for their password. |
| Split PDF | PDF | One file per page, chunks of N pages, or custom groups like `1-3; 4-6; 7-last`. |
| Extract pages | PDF | Keep a page selection in the order given: `3, 1, 2` reorders. |
| Remove pages | PDF | Delete pages like `2, 4-5, last`. |
| Rotate PDF | PDF (many) | 90°, 180° or 270°, all pages or a selection. |

Page ranges everywhere accept `1-3`, `5`, `8-last`, `last`, and descending ranges such as `5-3`.

## Optimize & secure

| Tool | What it does | Options |
|---|---|---|
| Compress PDF | Downsamples images to a target resolution based on how large they're drawn, and re-encodes them as JPEG. Text and vector graphics are untouched. Never returns a bigger file. | Light (200 dpi), Recommended (150), Strong (110), Extreme (72); optional greyscale |
| Protect PDF | AES-256 encryption with a password; printing and copying stay allowed for whoever has the password. | Password and confirmation |
| Unlock PDF | Removes the password (you need to know it), or removes restrictions from PDFs that open without one. | Password |
| Repair PDF | Rebuilds broken cross-reference tables and re-saves cleanly. | |
| Greyscale PDF | Renders every page in greyscale for printing. Pages become images. | Quality |

## Convert to PDF

| Tool | Input | Notes |
|---|---|---|
| Scan to PDF | Camera or photos | Take photos page by page; reorder, rotate, delete. Looks: Original, Clean (whiter paper), Grey, B&W (adaptive threshold that handles shadows). Shots are kept on the device until cleared, so a phone reloading the tab while the camera is open loses nothing. |
| Images to PDF | JPG, PNG, WebP, GIF, BMP, HEIC/HEIF, AVIF | Respects phone rotation, flattens transparency onto white, landscape photos get landscape pages. Page size or "same as image", margins, look, quality. |
| Word to PDF | DOCX | Headings, paragraphs, bold/italic/underline, lists, tables, images (at their Word size), quotes, code. Old `.doc` files must be re-saved as `.docx`. |
| PowerPoint to PDF | PPTX | One page per slide, exact slide size. Slides are rendered as images (see limits). |
| Excel to PDF | XLSX, XLS, ODS, CSV | Each sheet on its own pages with a header row; wide sheets automatically go landscape and scale to fit the width. |
| Markdown to PDF | MD | GitHub-flavoured Markdown: tables, code blocks, task lists, quotes, links. |
| HTML to PDF | HTML | Self-contained HTML files. Remote images and scripts aren't loaded. |
| Text to PDF | TXT, LOG, JSON, code… | Normal or monospace font. |
| EPUB to PDF | EPUB | Reflows the e-book onto printable pages. |

## Convert from PDF

| Tool | Output | Notes |
|---|---|---|
| PDF to Word | DOCX | Paragraphs rebuilt from the layout, with original font names, sizes, colours, bold/italic, detected headings, bullet lists, images and page breaks. |
| PDF to images | PNG or JPG per page | 96, 150 or 300 dpi. |
| PDF to PowerPoint | PPTX | One slide per page at the PDF's aspect ratio; the page text goes in the speaker notes. |
| PDF to text | TXT | Marked with page separators. |
| PDF to Markdown | MD (+ images) | Headings, bold/italic, lists; images saved beside the file. |
| PDF to HTML | HTML | Keeps the visual page layout with positioned text. |

## Documents & images

| Tool | From → To | Notes |
|---|---|---|
| Word to Markdown | DOCX → MD | GitHub-style tables, lists, emphasis; images extracted to a folder. |
| Markdown to Word | MD → DOCX | Real Word headings (navigable), numbered and bulleted lists, tables, code in Consolas, links. |
| Word to HTML | DOCX → HTML | Single file with images embedded. |
| HTML to Word | HTML → DOCX | As Markdown to Word. |
| Markdown to HTML | MD → HTML | Styled, self-contained page. |
| HTML to Markdown | HTML → MD | |
| Word to text | DOCX → TXT | |
| PowerPoint to images | PPTX → PNG/JPG | One image per slide. |
| Excel to CSV | XLSX/XLS/ODS → CSV | One CSV per sheet, UTF-8 with BOM so Excel opens accents correctly. |
| CSV to Excel | CSV/TSV → XLSX | Several CSVs become one workbook, one sheet each. Detects `,` `;` tab or `|` delimiters and converts numbers. |
| Excel to JSON | XLSX/CSV → JSON | Rows as objects keyed by the header row. |
| Convert images | any → JPG, PNG, WebP | HEIC from iPhones included. Transparency becomes white for JPG. |
| Resize images | any → JPG, PNG, WebP | Longest side from 800 to 3840 px. |

## Limits

- No OCR: scanned PDFs (pictures of text) can be organized, compressed, merged and edited with overlays, but their text can't be extracted or edited.
- PowerPoint: charts, SmartArt, EMF/WMF pictures and animations are not drawn. Text uses fonts installed on your device, with Carlito standing in for Calibri.
- Word to PDF reproduces content and styling, not Word's exact pagination (headers, footers, columns, section breaks).
- Text editing is line-based: a much longer replacement can run past the margin, because paragraphs aren't reflowed.
