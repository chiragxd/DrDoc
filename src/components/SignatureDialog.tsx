import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";

type Mode = "draw" | "type" | "upload";
const INKS = ["#111111", "#1d3fbb", "#0f5132"];

/** Crop a canvas to its non-transparent pixels and return PNG bytes + size. */
async function trimmed(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 <= x0 || y1 <= y0) return null;
  const pad = 6;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + pad * 2;
  out.height = y1 - y0 + pad * 2;
  out.getContext("2d")!.drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob>((r) => out.toBlob((b) => r(b!), "image/png"));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: out.width, h: out.height, url: URL.createObjectURL(blob) };
}

export type Signature = { bytes: Uint8Array; w: number; h: number; url: string };

export function SignatureDialog({ onDone }: { onDone: (s: Signature | null) => void }) {
  const [mode, setMode] = useState<Mode>("draw");
  const [ink, setInk] = useState(INKS[0]);
  const [name, setName] = useState("");
  const [hasInk, setHasInk] = useState(false);
  const pad = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const c = pad.current;
    if (!c || mode !== "draw") return;
    const dpr = Math.min(3, devicePixelRatio || 1);
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let pts: { x: number; y: number }[] = [];
    let drawing = false;
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      drawing = true;
      c.setPointerCapture(e.pointerId);
      pts = [pos(e)];
    };
    const line = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      ctx.strokeStyle = inkRef.current;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    };
    const moveFn = (e: PointerEvent) => {
      if (!drawing) return;
      pts.push(pos(e));
      setHasInk(true);
      if (pts.length === 2) {
        // first segment: from the touch point to the first curve's start
        const [a, b] = pts;
        line(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        return;
      }
      const [a, b, p] = pts.slice(-3);
      ctx.strokeStyle = inkRef.current;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.quadraticCurveTo(b.x, b.y, (b.x + p.x) / 2, (b.y + p.y) / 2);
      ctx.stroke();
    };
    const up = (e: PointerEvent) => {
      if (!drawing) return;
      drawing = false;
      const end = pos(e);
      const last = pts.at(-1)!;
      // finish the stroke at the release point (or draw a dot for a tap)
      if (pts.length >= 2) line({ x: (pts.at(-2)!.x + last.x) / 2, y: (pts.at(-2)!.y + last.y) / 2 }, end);
      else line(last, { x: end.x + 0.1, y: end.y + 0.1 });
      setHasInk(true);
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", moveFn);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", moveFn);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
    };
  }, [mode]);
  const inkRef = useRef(ink);
  inkRef.current = ink;

  const clear = () => {
    const c = pad.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const finish = async () => {
    if (mode === "draw") return onDone(await trimmed(pad.current!));
    if (mode === "type") {
      const c = document.createElement("canvas");
      c.width = 1400;
      c.height = 300;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = ink;
      ctx.font = `110px "Segoe Script", "Brush Script MT", "Snell Roundhand", "Apple Chancery", cursive`;
      ctx.textBaseline = "middle";
      ctx.fillText(name, 20, 150);
      return onDone(await trimmed(c));
    }
  };

  return (
    <Dialog title="Your signature" onClose={() => onDone(null)}>
      <div className="segmented" style={{ margin: "14px 0" }}>
        {(["draw", "type", "upload"] as Mode[]).map((m) => (
          <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
            {m === "draw" ? "Draw" : m === "type" ? "Type" : "Upload"}
          </button>
        ))}
      </div>
      {mode === "draw" && (
        <>
          <canvas ref={pad} className="sigpad" aria-label="Signature pad: draw with your finger, pen or mouse" />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            {INKS.map((c) => (
              <button key={c} className={`color-dot${ink === c ? " on" : ""}`} style={{ background: c }} onClick={() => setInk(c)} aria-label={`Ink ${c}`} />
            ))}
            <span style={{ flex: 1 }} />
            <button className="btn sm ghost" onClick={clear}>
              Clear
            </button>
          </div>
        </>
      )}
      {mode === "type" && (
        <>
          <input className="input" placeholder="Type your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <div style={{ height: 90, display: "grid", placeItems: "center", marginTop: 10, borderRadius: 10, background: "#fff", color: ink, font: `42px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive`, overflow: "hidden" }}>
            {name || <span style={{ color: "#aaa", fontSize: 15, fontFamily: "var(--font)" }}>Preview</span>}
          </div>
        </>
      )}
      {mode === "upload" && (
        <div className="dropzone" style={{ minHeight: 140 }} onClick={() => file.current?.click()}>
          <strong>Choose an image of your signature</strong>
          <span className="types">PNG with a transparent background looks best.</span>
          <input
            ref={file}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const bmp = await createImageBitmap(f);
              onDone({ bytes: new Uint8Array(await f.arrayBuffer()), w: bmp.width, h: bmp.height, url: URL.createObjectURL(f) });
            }}
          />
        </div>
      )}
      <div className="actions">
        <button className="btn ghost" onClick={() => onDone(null)}>
          Cancel
        </button>
        {mode !== "upload" && (
          <button className="btn primary" onClick={finish} disabled={mode === "draw" ? !hasInk : !name.trim()}>
            Place signature
          </button>
        )}
      </div>
    </Dialog>
  );
}
