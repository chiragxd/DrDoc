import { ext, stem, out, type OutFile } from "../../lib/files";

export const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "avif"];

const isHeic = (f: File) => /heic|heif/i.test(f.type) || ["heic", "heif"].includes(ext(f.name));

/** Decode any supported image, honouring the phone's rotation (EXIF). */
export async function decodeImage(file: Blob & { name?: string }): Promise<ImageBitmap> {
  let blob: Blob = file;
  if (file instanceof File && isHeic(file)) {
    const heic2any = (await import("heic2any")).default;
    const res = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    blob = Array.isArray(res) ? res[0] : res;
  }
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`${file.name ?? "This image"} can't be read. Try JPG or PNG.`);
  }
}

export type Look = "original" | "auto" | "gray" | "bw";

export function drawToCanvas(img: ImageBitmap, o: { maxSide?: number; rotate?: number; look?: Look; background?: string } = {}) {
  const s = o.maxSide ? Math.min(1, o.maxSide / Math.max(img.width, img.height)) : 1;
  const w = Math.round(img.width * s);
  const h = Math.round(img.height * s);
  const rot = (((o.rotate ?? 0) % 360) + 360) % 360;
  const c = document.createElement("canvas");
  c.width = rot % 180 ? h : w;
  c.height = rot % 180 ? w : h;
  const ctx = c.getContext("2d", { willReadFrequently: !!o.look && o.look !== "original" })!;
  if (o.background) {
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (o.look && o.look !== "original") applyLook(ctx, c.width, c.height, o.look);
  return c;
}

export function canvasBytes(c: HTMLCanvasElement, type: string, quality = 0.9): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob(async (b) => {
      if (!b) return reject(new Error("Couldn't encode the image."));
      if (b.type !== type) return reject(new Error(`Your browser can't save ${type.split("/")[1].toUpperCase()} images.`));
      resolve(new Uint8Array(await b.arrayBuffer()));
    }, type, quality),
  );
}

/** Prepare an image for embedding in a PDF: upright, flattened, sensible size. */
export async function imageForPdf(file: File, o: { quality: number; look?: Look; maxSide?: number }) {
  const img = await decodeImage(file);
  const c = drawToCanvas(img, { maxSide: o.maxSide ?? 3000, look: o.look, background: "#ffffff" });
  img.close();
  return { bytes: await canvasBytes(c, "image/jpeg", o.quality), w: c.width, h: c.height };
}

export async function convertImage(file: File, o: { format: "jpg" | "png" | "webp"; quality: number; maxSide?: number }): Promise<OutFile> {
  const img = await decodeImage(file);
  const c = drawToCanvas(img, { maxSide: o.maxSide, background: o.format === "jpg" ? "#ffffff" : undefined });
  img.close();
  const type = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[o.format];
  return out(`${stem(file.name)}.${o.format}`, await canvasBytes(c, type, o.quality));
}

// ------------------------------------------------------------------ document clean-up for scans

/** Stretch contrast per channel so paper turns white and ink turns dark. */
export function applyLook(ctx: CanvasRenderingContext2D, w: number, h: number, look: Look) {
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  const n = w * h;
  const lum = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const y = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    lum[j] = y;
    hist[y]++;
  }
  const pct = (h: Uint32Array, p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += h[v]) >= n * p) return v;
    return 255;
  };

  if (look === "bw") {
    // adaptive threshold against the local average copes with shadows
    const W = w + 1;
    const integ = new Uint32Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += lum[y * w + x];
        integ[(y + 1) * W + x + 1] = integ[y * W + x + 1] + row;
      }
    }
    const r = Math.max(8, Math.round(Math.max(w, h) / 40));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = integ[y1 * W + x1] - integ[y0 * W + x1] - integ[y1 * W + x0] + integ[y0 * W + x0];
        const v = lum[y * w + x] < (sum / ((x1 - x0) * (y1 - y0))) * 0.86 ? 0 : 255;
        const i = (y * w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
  } else if (look === "gray") {
    const lo = pct(hist, 0.02), hi = Math.max(lo + 20, pct(hist, 0.9));
    const k = 255 / (hi - lo);
    for (let i = 0, j = 0; j < n; i += 4, j++) d[i] = d[i + 1] = d[i + 2] = (lum[j] - lo) * k;
  } else {
    const lut = [0, 1, 2].map((ch) => {
      const hc = new Uint32Array(256);
      for (let i = ch; i < d.length; i += 4) hc[d[i]]++;
      const lo = pct(hc, 0.02), hi = Math.max(lo + 20, pct(hc, 0.85));
      return Uint8ClampedArray.from({ length: 256 }, (_, v) => ((v - lo) * 255) / (hi - lo));
    });
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[0][d[i]];
      d[i + 1] = lut[1][d[i + 1]];
      d[i + 2] = lut[2][d[i + 2]];
    }
  }
  ctx.putImageData(im, 0, 0);
}
