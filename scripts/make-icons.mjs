// Renders the app icons (PNG) from the DrDoc mark with MuPDF's vector API.
// Run: node scripts/make-icons.mjs
import * as mupdf from "mupdf";
import { writeFileSync } from "node:fs";

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const K = 0.5523; // circle-to-bezier constant

// The mark in its 32x32 design grid (same geometry as public/favicon.svg)
function roundRect(p, x, y, w, h, r) {
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.curveTo(x + w - r + r * K, y, x + w, y + r - r * K, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.curveTo(x + w, y + h - r + r * K, x + w - r + r * K, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.curveTo(x + r - r * K, y + h, x, y + h - r + r * K, x, y + h - r);
  p.lineTo(x, y + r);
  p.curveTo(x, y + r - r * K, x + r - r * K, y, x + r, y);
  p.closePath();
}

function sheet() {
  const p = new mupdf.Path();
  const r = 2.5;
  p.moveTo(8.5, 2.5);
  p.lineTo(19.7, 2.5);
  p.lineTo(28, 10.8);
  p.lineTo(28, 27);
  p.curveTo(28, 27 + r * K, 27 - 1.5 + r * K, 29.5, 25.5, 29.5);
  p.lineTo(8.5, 29.5);
  p.curveTo(8.5 - r * K, 29.5, 6, 27 + r * K, 6, 27);
  p.lineTo(6, 5);
  p.curveTo(6, 5 - r * K, 8.5 - r * K, 2.5, 8.5, 2.5);
  p.closePath();
  return p;
}

function render(size, pad, bg) {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, size, size], false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
  const rgb = mupdf.ColorSpace.DeviceRGB;
  const full = new mupdf.Path();
  full.rect(0, 0, size, size);
  dev.fillPath(full, false, mupdf.Matrix.identity, rgb, hex(bg), 1);
  const s = (size - pad * 2) / 32;
  const m = [s, 0, 0, s, pad, pad];
  dev.fillPath(sheet(), false, m, rgb, hex("#0f7b6c"), 1);
  const fold = new mupdf.Path();
  fold.moveTo(19.7, 2.5);
  fold.lineTo(19.7, 8.8);
  fold.curveTo(19.7, 9.9, 20.6, 10.8, 21.7, 10.8);
  fold.lineTo(28, 10.8);
  dev.strokePath(fold, new mupdf.StrokeState({ lineWidth: 1.6, lineJoin: "Round", lineCap: "Butt", miterLimit: 10 }), m, rgb, [1, 1, 1], 0.35);
  const cross = new mupdf.Path();
  roundRect(cross, 15, 13, 4, 12, 1.2);
  roundRect(cross, 11, 17, 12, 4, 1.2);
  dev.fillPath(cross, false, m, rgb, [1, 1, 1], 1);
  dev.close();
  return pix.asPNG();
}

const BG = "#eef6f4";
writeFileSync("public/icon-512.png", render(512, 72, BG));
writeFileSync("public/icon-192.png", render(192, 27, BG));
writeFileSync("public/icon-maskable-512.png", render(512, 120, BG));
writeFileSync("public/apple-touch-icon.png", render(180, 30, BG));
console.log("icons written");
