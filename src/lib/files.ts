import { zipSync } from "fflate";

export type OutFile = { name: string; blob: Blob };

export const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  md: "text/markdown",
  html: "text/html",
  txt: "text/plain",
  epub: "application/epub+zip",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  json: "application/json",
};

export const ext = (name: string) => (name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
export const stem = (name: string) => name.replace(/\.[^.]+$/, "") || "file";

export function out(name: string, data: Uint8Array | Blob | string): OutFile {
  const type = MIME[ext(name)] ?? "application/octet-stream";
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  return { name, blob };
}

export async function bytesOf(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Make names unique: "a.pdf", "a (2).pdf" ... */
export function uniqueNames(files: OutFile[]): OutFile[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const n = seen.get(f.name.toLowerCase()) ?? 0;
    seen.set(f.name.toLowerCase(), n + 1);
    return n ? { ...f, name: `${stem(f.name)} (${n + 1}).${ext(f.name)}` } : f;
  });
}

export async function zip(files: OutFile[], name: string): Promise<OutFile> {
  const entries: Record<string, Uint8Array> = {};
  for (const f of uniqueNames(files)) entries[f.name] = await bytesOf(f.blob);
  // images and PDFs are already compressed: store them, deflate the rest
  return out(name, zipSync(entries, { level: 6 }));
}

export function download(file: OutFile) {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
