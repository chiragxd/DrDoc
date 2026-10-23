import { useEffect, useRef, useState } from "react";
import Sortable from "sortablejs";
import { ArrowLeft, Camera, Download, Images, LoaderCircle, RotateCw, Trash } from "lucide-react";
import { pdf } from "../engine/pdf/client";
import { canvasBytes, decodeImage, drawToCanvas, type Look } from "../engine/convert/images";
import { ErrorNote } from "../components/Result";
import { Toast } from "../components/Dialog";
import { download, out } from "../lib/files";
import { handoff } from "../app/router";
import type { Tool } from "../tools/registry";

type Shot = { id: string; blob: Blob; rotate: number; order: number };

// Shots live in IndexedDB so they survive the browser reloading the tab
// while the phone's camera app is open.
const db = {
  _db: null as Promise<IDBDatabase> | null,
  open() {
    return (this._db ??= new Promise((res, rej) => {
      const r = indexedDB.open("drdoc-scan", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("shots", { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction("shots", mode);
      const req = fn(t.objectStore("shots"));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  all: () => db.run<Shot[]>("readonly", (s) => s.getAll() as IDBRequest<Shot[]>),
  put: (shot: Shot) => db.run("readwrite", (s) => void s.put(shot)),
  del: (id: string) => db.run("readwrite", (s) => void s.delete(id)),
  clear: () => db.run("readwrite", (s) => void s.clear()),
};

const LOOKS: [Look, string][] = [["original", "Original"], ["auto", "Clean"], ["gray", "Grey"], ["bw", "B&W"]];

export function Scanner({ tool }: { tool: Tool }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [look, setLook] = useState<Look>(() => (localStorage.getItem("drdoc.scanLook") as Look) || "auto");
  const [pageSize, setPageSize] = useState("a4");
  const [name, setName] = useState(`scan-${new Date().toISOString().slice(0, 10)}`);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;

  useEffect(() => {
    document.title = `${tool.name} · DrDoc`;
    db.all()
      .then((s) => setShots((s ?? []).sort((a, b) => a.order - b.order)))
      .catch(() => {})
      .finally(() => {
        const f = handoff.take();
        if (f.length) void add(f);
      });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("drdoc.scanLook", look);
    } catch {
      /* ignore */
    }
  }, [look]);

  // thumbnails with the chosen look applied
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const s of shots) {
        const key = `${s.id}|${s.rotate}|${look}`;
        if (thumbs[key]) continue;
        const img = await decodeImage(s.blob);
        const c = drawToCanvas(img, { maxSide: 420, rotate: s.rotate, look });
        img.close();
        if (cancelled) return;
        const url = c.toDataURL("image/jpeg", 0.8);
        setThumbs((t) => ({ ...t, [key]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shots, look]);

  useEffect(() => {
    if (!grid.current) return;
    const s = Sortable.create(grid.current, {
      animation: 180,
      delay: 150,
      delayOnTouchOnly: true,
      handle: ".img",
      onEnd: (e) => {
        if (e.oldIndex === undefined || e.newIndex === undefined || e.oldIndex === e.newIndex) return;
        e.from.insertBefore(e.item, e.from.children[e.oldIndex + (e.oldIndex > e.newIndex ? 1 : 0)] ?? null);
        const next = [...shotsRef.current];
        const [m] = next.splice(e.oldIndex, 1);
        next.splice(e.newIndex, 0, m);
        next.forEach((x, i) => {
          x.order = i;
          void db.put(x).catch(() => {});
        });
        setShots(next);
      },
    });
    return () => s.destroy();
  }, [shots.length > 0]);

  async function add(files: File[]) {
    setError(null);
    for (const f of files) {
      try {
        // normalise: upright, max 2400px, JPEG — keeps storage small
        const img = await decodeImage(f);
        const c = drawToCanvas(img, { maxSide: 2400 });
        img.close();
        const blob = new Blob([(await canvasBytes(c, "image/jpeg", 0.9)) as BlobPart], { type: "image/jpeg" });
        const shot: Shot = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, blob, rotate: 0, order: Date.now() };
        setShots((s) => [...s, shot]);
        await db.put(shot).catch(() => {});
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  const update = (shot: Shot) => {
    setShots((s) => s.map((x) => (x.id === shot.id ? shot : x)));
    void db.put(shot).catch(() => {});
  };
  const remove = (id: string) => {
    setShots((s) => s.filter((x) => x.id !== id));
    void db.del(id).catch(() => {});
  };

  const create = async () => {
    setBusy("Preparing pages…");
    setError(null);
    try {
      const imgs: { bytes: Uint8Array; w: number; h: number }[] = [];
      for (let i = 0; i < shots.length; i++) {
        setBusy(`Preparing page ${i + 1} of ${shots.length}…`);
        const img = await decodeImage(shots[i].blob);
        const c = drawToCanvas(img, { maxSide: 2400, rotate: shots[i].rotate, look, background: "#fff" });
        img.close();
        imgs.push({ bytes: await canvasBytes(c, "image/jpeg", look === "bw" ? 0.75 : 0.85), w: c.width, h: c.height });
      }
      setBusy("Creating PDF…");
      const bytes = await pdf.imagesToPdf(imgs, { pageSize, margin: 0 });
      download(out(`${name.trim() || "scan"}.pdf`, bytes));
      setToast(`Saved ${name.trim() || "scan"}.pdf`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ws">
      <div className="ws-bar">
        <a className="icon-btn" href="#/" aria-label="All tools">
          <ArrowLeft />
        </a>
        <span className="title">{tool.name}</span>
        <span className="sep" />
        <button className="btn sm primary" onClick={() => cam.current?.click()}>
          <Camera /> Take photo
        </button>
        <button className="btn sm ghost" onClick={() => gal.current?.click()}>
          <Images /> <span className="label-opt">Add photos</span>
        </button>
        <span className="grow" />
        {shots.length > 0 && (
          <button className="btn primary" onClick={create} disabled={!!busy}>
            {busy ? <LoaderCircle className="spin" /> : <Download />} Save PDF
          </button>
        )}
      </div>
      <div className="scan">
        {!shots.length ? (
          <div className="ws-empty" style={{ minHeight: "60vh" }}>
            <div style={{ width: "min(100%, 560px)", textAlign: "center" }}>
              <div className="tool-head" style={{ justifyContent: "center", textAlign: "left" }}>
                <span className="ico">
                  <Camera />
                </span>
                <div>
                  <h1>{tool.name}</h1>
                  <p>Photograph each page. DrDoc straightens the colours and makes one PDF.</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <button className="btn primary lg" onClick={() => cam.current?.click()}>
                  <Camera /> Take a photo
                </button>
                <button className="btn lg" onClick={() => gal.current?.click()}>
                  <Images /> Choose photos
                </button>
              </div>
              <p className="faint" style={{ fontSize: 13, marginTop: 18 }}>
                Tip: lay the page flat in good light and fill the frame.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 18 }}>
            <div className="panel panel-body" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 16 }}>
              <div className="field">
                <label>Look</label>
                <div className="segmented">
                  {LOOKS.map(([v, l]) => (
                    <button key={v} className={look === v ? "on" : ""} onClick={() => setLook(v)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field" style={{ width: 150 }}>
                <label htmlFor="ps">Page size</label>
                <select id="ps" className="select" value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                  <option value="a4">A4</option>
                  <option value="letter">US Letter</option>
                  <option value="fit">Same as photo</option>
                </select>
              </div>
              <div className="field" style={{ flex: "1 1 200px" }}>
                <label htmlFor="fn">File name</label>
                <input id="fn" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <button
                className="btn ghost"
                onClick={() => {
                  if (!confirm("Remove all pages?")) return;
                  setShots([]);
                  void db.clear().catch(() => {});
                }}
              >
                <Trash /> Clear all
              </button>
            </div>
            {busy && <p className="muted">{busy}</p>}
            {error && <ErrorNote message={error} />}
            <div className="scan-grid" ref={grid}>
              {shots.map((s, i) => (
                <div className="shot" key={s.id}>
                  <div className="img">{thumbs[`${s.id}|${s.rotate}|${look}`] ? <img src={thumbs[`${s.id}|${s.rotate}|${look}`]} alt={`Page ${i + 1}`} draggable={false} /> : <LoaderCircle className="spin faint" />}</div>
                  <div className="bar">
                    <span>Page {i + 1}</span>
                    <span>
                      <button className="icon-btn" aria-label="Rotate" onClick={() => update({ ...s, rotate: (s.rotate + 90) % 360 })}>
                        <RotateCw />
                      </button>
                      <button className="icon-btn" aria-label="Delete page" onClick={() => remove(s.id)}>
                        <Trash />
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p className="faint" style={{ fontSize: 13 }}>Drag pages to reorder. Pages are kept on this device until you clear them.</p>
          </div>
        )}
      </div>
      <input ref={cam} type="file" hidden accept="image/*" capture="environment" onChange={(e) => (e.target.files && add([...e.target.files]), (e.target.value = ""))} />
      <input ref={gal} type="file" hidden multiple accept="image/*,.heic,.heif" onChange={(e) => (e.target.files && add([...e.target.files]), (e.target.value = ""))} />
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
