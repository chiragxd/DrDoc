import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft, Bold, Download, Eraser, GripVertical, Highlighter, Image as ImageIcon, Italic, LoaderCircle, MousePointer2, Redo2, Signature, Trash, Type, Undo2, ZoomIn, ZoomOut,
} from "lucide-react";
import { pdf } from "../engine/pdf/client";
import type { EditOp, EditorFont, EditorLine, EditorRun } from "../engine/pdf/core";
import { cssFontFor } from "../engine/pdf/fonts";
import { Dropzone } from "../components/Dropzone";
import { PasswordDialog, Toast } from "../components/Dialog";
import { SignatureDialog, type Signature as Sig } from "../components/SignatureDialog";
import { ErrorNote } from "../components/Result";
import { download, out, stem } from "../lib/files";
import { handoff } from "../app/router";
import type { Tool } from "../tools/registry";

type ToolMode = "edit" | "text" | "image" | "sign" | "whiteout" | "highlight";
type Rgb = [number, number, number];
type RunEdit = { text: string; fontKey: number; size: number; color: Rgb };
type Item =
  | { id: string; page: number; kind: "text"; x: number; y: number; text: string; size: number; color: Rgb; font: number | "sans" | "serif" | "mono"; bold: boolean; italic: boolean }
  | { id: string; page: number; kind: "image"; x: number; y: number; w: number; h: number; bytes: Uint8Array; url: string }
  | { id: string; page: number; kind: "rect"; x: number; y: number; w: number; h: number; color: Rgb; opacity: number; blend?: string };
type Snapshot = { lines: Record<string, RunEdit[]>; items: Item[] };

const COLORS: Rgb[] = [[0, 0, 0], [0.11, 0.25, 0.73], [0.75, 0.1, 0.1], [0.06, 0.48, 0.42], [0.45, 0.45, 0.45]];
const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
let idSeq = 0;
const nid = () => `i${++idSeq}`;
const DPR = () => Math.min(2.5, window.devicePixelRatio || 1);

export function Editor({ tool }: { tool: Tool }) {
  const [session, setSession] = useState<{ id: number; name: string; pages: { w: number; h: number }[] } | null>(null);
  const [mode, setMode] = useState<ToolMode>(tool.id === "sign-pdf" ? "sign" : "edit");
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(1);
  const [lines, setLines] = useState<Record<number, EditorLine[]>>({});
  const [fonts, setFonts] = useState<EditorFont[]>([]);
  const [snap, setSnap] = useState<Snapshot>({ lines: {}, items: [] });
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [version, setVersion] = useState<Record<number, number>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [ask, setAsk] = useState<{ name: string; error?: string; resolve: (p: string | null) => void } | null>(null);
  const [textStyle, setTextStyle] = useState<{ size: number; color: Rgb; font: number | "sans" | "serif" | "mono"; bold: boolean; italic: boolean }>({ size: 14, color: [0, 0, 0], font: "sans", bold: false, italic: false });
  const canvasArea = useRef<HTMLDivElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const pendingImagePage = useRef(0);

  const scale = fit * zoom;
  const dirty = Object.keys(snap.lines).length > 0 || snap.items.length > 0;

  // ------------------------------------------------------------ open a file
  const openFile = useCallback(async (file: File) => {
    setError(null);
    setBusy("Opening…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let password = "";
      let info = await pdf.info(bytes);
      let msg: string | undefined;
      while (info.locked) {
        const pw = await new Promise<string | null>((resolve) => setAsk({ name: file.name, error: msg, resolve }));
        setAsk(null);
        if (pw === null) throw new Error("This PDF is password protected.");
        info = await pdf.info(bytes, pw);
        password = pw;
        msg = "That password didn't work. Try again.";
      }
      const s = await pdf.editorOpen(bytes, password);
      setSession({ id: s.id, name: file.name, pages: s.pages });
      setSnap({ lines: {}, items: [] });
      setPast([]);
      setFuture([]);
      setLines({});
      if (tool.id === "sign-pdf") setSigOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [tool.id]);

  useEffect(() => {
    document.title = `${tool.name} · DrDoc`;
    const f = handoff.take().find((x) => /\.pdf$/i.test(x.name));
    if (f) void openFile(f);
  }, [openFile, tool.name]);

  useEffect(() => () => {
    if (session) pdf.close(session.id);
  }, [session]);

  // warn before leaving with unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", h);
    return () => removeEventListener("beforeunload", h);
  }, [dirty]);

  // fit page width to the viewport
  useLayoutEffect(() => {
    if (!session || !canvasArea.current) return;
    const measure = () => {
      const w = canvasArea.current!.clientWidth - (innerWidth < 640 ? 16 : 48);
      const maxW = Math.max(...session.pages.map((p) => p.w));
      setFit(Math.max(0.3, Math.min(1.6, w / maxW)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvasArea.current);
    return () => ro.disconnect();
  }, [session]);

  const loadLines = useCallback(async (page: number) => {
    if (!session || lines[page]) return;
    const l = await pdf.editorLines(session.id, page).catch(() => null);
    if (!l) return;
    setLines((cur) => ({ ...cur, [page]: l }));
    setFonts(await pdf.editorFonts(session.id));
  }, [session, lines]);

  // ------------------------------------------------------------ history
  const commit = useCallback((next: Snapshot, changedPages: number[] = []) => {
    setPast((p) => [...p.slice(-60), snapRef.current]);
    setFuture([]);
    setSnap(next);
    if (changedPages.length) void rebake(next, changedPages);
  }, []);

  const rebake = async (s: Snapshot, pages: number[]) => {
    if (!sessionRef.current) return;
    await pdf.editorApply(sessionRef.current.id, lineOps(s));
    setVersion((v) => {
      const n = { ...v };
      for (const p of pages) n[p] = (n[p] ?? 0) + 1;
      return n;
    });
  };
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const lineOps = (s: Snapshot): EditOp[] =>
    Object.entries(s.lines).map(([lineId, runs]) => ({ type: "replace-line", page: +lineId.split(":")[0], lineId, runs }));

  const pagesOf = (a: Snapshot, b: Snapshot) => {
    const keys = new Set([...Object.keys(a.lines), ...Object.keys(b.lines)]);
    return [...new Set([...keys].filter((k) => JSON.stringify(a.lines[k]) !== JSON.stringify(b.lines[k])).map((k) => +k.split(":")[0]))];
  };

  const undo = () => {
    if (!past.length) return;
    const prev = past.at(-1)!;
    setFuture((f) => [snap, ...f]);
    setPast((p) => p.slice(0, -1));
    const changed = pagesOf(prev, snap);
    setSnap(prev);
    if (changed.length) void rebake(prev, changed);
  };
  const redo = () => {
    if (!future.length) return;
    const next = future[0];
    setPast((p) => [...p, snap]);
    setFuture((f) => f.slice(1));
    const changed = pagesOf(next, snap);
    setSnap(next);
    if (changed.length) void rebake(next, changed);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, [contenteditable]");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected && !typing) {
        e.preventDefault();
        commit({ ...snap, items: snap.items.filter((i) => i.id !== selected) });
        setSelected(null);
      } else if (e.key === "Escape") {
        setSelected(null);
      }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  // ------------------------------------------------------------ actions
  const commitLine = (line: EditorLine, runs: RunEdit[] | null) => {
    setEditing(null);
    if (!runs) return;
    const original = line.runs.map((r) => r.text).join("");
    const text = runs.map((r) => r.text).join("");
    const lines = { ...snap.lines };
    if (text === original && runs.length === line.runs.length) delete lines[line.id];
    else lines[line.id] = runs;
    if (JSON.stringify(lines[line.id]) === JSON.stringify(snap.lines[line.id])) return;
    commit({ ...snap, lines }, [+line.id.split(":")[0]]);
  };

  const addItem = (item: Item) => {
    commit({ ...snap, items: [...snap.items, item] });
    setSelected(item.id);
  };
  const updateItem = (item: Item, record = true) => {
    const items = snap.items.map((i) => (i.id === item.id ? item : i));
    if (record) commit({ ...snap, items });
    else setSnap({ ...snap, items });
  };

  const placeImage = (page: number, s: { bytes: Uint8Array; w: number; h: number; url: string }, widthFrac = 0.35) => {
    const size = session!.pages[page];
    const w = size.w * widthFrac;
    const h = (w * s.h) / s.w;
    addItem({ id: nid(), page, kind: "image", x: (size.w - w) / 2, y: Math.min(size.h - h - 20, size.h * 0.62), w, h, bytes: s.bytes, url: s.url });
    setMode("edit");
  };

  const save = async () => {
    if (!session) return;
    setBusy("Saving…");
    setEditing(null);
    try {
      const ops: EditOp[] = [...lineOps(snap)];
      for (const it of snap.items) {
        if (it.kind === "text" && it.text.trim()) {
          ops.push({ type: "text", page: it.page, x: it.x, y: it.y + it.size * 0.95, text: it.text, size: it.size, color: it.color, fontKey: it.font, bold: it.bold, italic: it.italic });
        } else if (it.kind === "image") ops.push({ type: "image", page: it.page, rect: [it.x, it.y, it.x + it.w, it.y + it.h], bytes: it.bytes });
        else if (it.kind === "rect") ops.push({ type: "rect", page: it.page, rect: [it.x, it.y, it.x + it.w, it.y + it.h], color: it.color, opacity: it.opacity, blend: it.blend });
      }
      await pdf.editorApply(session.id, ops);
      const bytes = await pdf.editorSave(session.id);
      await pdf.editorApply(session.id, lineOps(snap)); // keep the on-screen render free of overlay items
      download(out(`${stem(session.name)}-edited.pdf`, bytes));
      setToast("Saved. Your edited PDF is downloading.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // track the page in view
  useEffect(() => {
    const area = canvasArea.current;
    if (!area || !session) return;
    const on = () => {
      const pages = [...area.querySelectorAll<HTMLElement>("[data-page]")];
      const mid = area.getBoundingClientRect().top + area.clientHeight / 3;
      const hit = pages.find((p) => p.getBoundingClientRect().bottom > mid);
      if (hit) setCurrent(+hit.dataset.page!);
    };
    area.addEventListener("scroll", on, { passive: true });
    return () => area.removeEventListener("scroll", on);
  }, [session]);

  const scrollTo = (i: number) => canvasArea.current?.querySelector(`[data-page="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  // ------------------------------------------------------------ render
  if (!session) {
    return (
      <div className="ws">
        <div className="ws-bar">
          <a className="icon-btn" href="#/" aria-label="All tools">
            <ArrowLeft />
          </a>
          <span className="title">{tool.name}</span>
        </div>
        <div className="ws-empty">
          <div style={{ width: "min(100%, 620px)" }}>
            <div className="tool-head" style={{ marginBottom: 18 }}>
              <span className="ico">
                <tool.icon />
              </span>
              <div>
                <h1>{tool.name}</h1>
                <p>{tool.id === "sign-pdf" ? "Open a PDF, then draw, type or upload your signature." : "Click any line of text to change it. DrDoc keeps the original font, size and colour."}</p>
              </div>
            </div>
            {busy ? <div className="panel panel-body"><p className="muted">{busy}</p></div> : <Dropzone accept=".pdf" onFiles={(f) => openFile(f[0])} types="PDF" />}
            {error && <div style={{ marginTop: 12 }}><ErrorNote message={error} /></div>}
          </div>
        </div>
        {ask && <PasswordDialog name={ask.name} error={ask.error} onDone={ask.resolve} />}
      </div>
    );
  }

  const sel = snap.items.find((i) => i.id === selected);
  const MODES: { id: ToolMode; icon: typeof Type; label: string }[] = [
    { id: "edit", icon: MousePointer2, label: "Edit text" },
    { id: "text", icon: Type, label: "Add text" },
    { id: "image", icon: ImageIcon, label: "Image" },
    { id: "sign", icon: Signature, label: "Sign" },
    { id: "whiteout", icon: Eraser, label: "Erase" },
    { id: "highlight", icon: Highlighter, label: "Highlight" },
  ];
  const hint = {
    edit: "Click any text to edit it. Press Enter to apply.",
    text: "Click where you want to add text.",
    image: "Choose an image to place on the page.",
    sign: "Create your signature, then drag it into place.",
    whiteout: "Drag over an area to cover it with white.",
    highlight: "Drag over text to highlight it.",
  }[mode];

  return (
    <div className="ws">
      <div className="ws-bar">
        <a className="icon-btn" href="#/" aria-label="All tools" title="All tools">
          <ArrowLeft />
        </a>
        <span className="title" title={session.name}>{session.name}</span>
        <span className="sep" />
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`btn sm ${mode === m.id ? "" : "ghost"}`}
            style={mode === m.id ? { background: "var(--brand-soft)", borderColor: "var(--brand-line)", color: "var(--brand)" } : undefined}
            title={m.label}
            onClick={() => {
              setMode(m.id);
              setSelected(null);
              if (m.id === "image") {
                pendingImagePage.current = current;
                imgInput.current?.click();
              }
              if (m.id === "sign") setSigOpen(true);
            }}
          >
            <m.icon /> <span className="label-opt">{m.label}</span>
          </button>
        ))}
        <span className="sep" />
        <button className="icon-btn" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">
          <Undo2 />
        </button>
        <button className="icon-btn" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Shift+Z)">
          <Redo2 />
        </button>
        <span className="sep label-opt" />
        <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))} title="Zoom out">
          <ZoomOut />
        </button>
        <button className="btn sm ghost label-opt" onClick={() => setZoom(1)} title="Fit width" style={{ minWidth: 54 }}>
          {Math.round(scale * 100)}%
        </button>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))} title="Zoom in">
          <ZoomIn />
        </button>
        <span className="grow" />
        <button className="btn primary" onClick={save} disabled={!!busy}>
          {busy ? <LoaderCircle className="spin" /> : <Download />} Download
        </button>
      </div>

      {(sel?.kind === "text" || mode === "text") && (
        <TextProps
          style={sel?.kind === "text" ? sel : textStyle}
          fonts={fonts}
          onChange={(st) => {
            setTextStyle({ ...textStyle, ...st });
            if (sel?.kind === "text") updateItem({ ...sel, ...st });
          }}
          onDelete={sel ? () => (commit({ ...snap, items: snap.items.filter((i) => i.id !== sel.id) }), setSelected(null)) : undefined}
        />
      )}
      {sel && sel.kind !== "text" && (
        <div className="ws-bar" style={{ minHeight: 48 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {sel.kind === "image" ? "Drag to move, drag the corner to resize." : "Drag to move, drag the corner to resize."}
          </span>
          <span className="grow" />
          <button className="btn sm ghost" onClick={() => (commit({ ...snap, items: snap.items.filter((i) => i.id !== sel.id) }), setSelected(null))}>
            <Trash /> Delete
          </button>
        </div>
      )}

      <div className="ws-main">
        <div className="ed-thumbs" aria-label="Pages">
          {session.pages.map((p, i) => (
            <Thumb key={i} session={session.id} index={i} size={p} version={version[i] ?? 0} on={i === current} onClick={() => scrollTo(i)} />
          ))}
        </div>
        <div className="ed-canvas" ref={canvasArea} onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
          <div className="ed-hint">{hint}</div>
          {error && <ErrorNote message={error} />}
          {session.pages.map((p, i) => (
            <EditorPage
              key={i}
              index={i}
              session={session.id}
              size={p}
              scale={scale}
              version={version[i] ?? 0}
              mode={mode}
              lines={lines[i]}
              loadLines={loadLines}
              fonts={fonts}
              edits={snap.lines}
              items={snap.items.filter((it) => it.page === i)}
              editing={editing}
              setEditing={setEditing}
              selected={selected}
              setSelected={setSelected}
              onCommitLine={commitLine}
              onItemChange={updateItem}
              onCreate={(item) => {
                if (item.kind === "text") addItem({ ...item, ...textStyle } as Item);
                else addItem(item);
                if (mode !== "highlight" && mode !== "whiteout") setMode("edit");
              }}
            />
          ))}
        </div>
      </div>

      <input
        ref={imgInput}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return setMode("edit");
          const bmp = await createImageBitmap(f);
          let bytes = new Uint8Array(await f.arrayBuffer());
          if (!/png|jpe?g/.test(f.type)) {
            const c = document.createElement("canvas");
            c.width = bmp.width;
            c.height = bmp.height;
            c.getContext("2d")!.drawImage(bmp, 0, 0);
            bytes = new Uint8Array(await (await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"))).arrayBuffer());
          }
          placeImage(pendingImagePage.current, { bytes, w: bmp.width, h: bmp.height, url: URL.createObjectURL(f) }, 0.4);
        }}
      />
      {sigOpen && (
        <SignatureDialog
          onDone={(s: Sig | null) => {
            setSigOpen(false);
            if (s) placeImage(current, s, 0.28);
            else setMode("edit");
          }}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ text style bar

function TextProps({ style, fonts, onChange, onDelete }: {
  style: { size: number; color: Rgb; font: number | "sans" | "serif" | "mono"; bold: boolean; italic: boolean };
  fonts: EditorFont[];
  onChange: (s: Partial<typeof style>) => void;
  onDelete?: () => void;
}) {
  const seen = new Set<string>();
  const docFonts = fonts.filter((f) => {
    const k = f.family.toLowerCase();
    if (seen.has(k) || !f.family.trim()) return false;
    seen.add(k);
    return true;
  });
  return (
    <div className="ws-bar ed-props" style={{ minHeight: 48 }}>
      <select className="select" value={String(style.font)} onChange={(e) => onChange({ font: /^\d+$/.test(e.target.value) ? +e.target.value : (e.target.value as "sans") })} aria-label="Font">
        {docFonts.length > 0 && (
          <optgroup label="From this document">
            {docFonts.map((f) => (
              <option key={f.key} value={f.key}>
                {f.family}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Standard">
          <option value="sans">Sans serif</option>
          <option value="serif">Serif</option>
          <option value="mono">Monospace</option>
        </optgroup>
      </select>
      <select className="select" value={style.size} onChange={(e) => onChange({ size: +e.target.value })} aria-label="Size">
        {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map((s) => (
          <option key={s} value={s}>
            {s} pt
          </option>
        ))}
      </select>
      <button className={`icon-btn${style.bold ? " active" : ""}`} onClick={() => onChange({ bold: !style.bold })} aria-label="Bold">
        <Bold />
      </button>
      <button className={`icon-btn${style.italic ? " active" : ""}`} onClick={() => onChange({ italic: !style.italic })} aria-label="Italic">
        <Italic />
      </button>
      {COLORS.map((c) => (
        <button key={c.join()} className={`color-dot${style.color.join() === c.join() ? " on" : ""}`} style={{ background: css(c) }} onClick={() => onChange({ color: c })} aria-label="Colour" />
      ))}
      <span className="grow" />
      {onDelete && (
        <button className="btn sm ghost" onClick={onDelete}>
          <Trash /> Delete
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ thumbnails

const Thumb = memo(function Thumb({ session, index, size, version, on, onClick }: { session: number; index: number; size: { w: number; h: number }; version: number; on: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const r = await pdf.editorRender(session, index, 220 / Math.max(size.w, size.h)).catch(() => null); // session closed
      if (!r) return;
      el.width = r.w;
      el.height = r.h;
      el.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer as ArrayBuffer, r.data.byteOffset, r.data.length), r.w, r.h), 0, 0);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [session, index, size, version]);
  return (
    <button className={`ed-thumb${on ? " on" : ""}`} onClick={onClick}>
      <canvas ref={ref} style={{ width: "100%", aspectRatio: `${size.w} / ${size.h}`, borderRadius: 3, boxShadow: on ? "0 0 0 2px var(--brand)" : "0 0 0 1px var(--border)", background: "#fff" }} />
      {index + 1}
    </button>
  );
});

// ------------------------------------------------------------------ one page

type PageProps = {
  index: number;
  session: number;
  size: { w: number; h: number };
  scale: number;
  version: number;
  mode: ToolMode;
  lines?: EditorLine[];
  loadLines: (i: number) => void;
  fonts: EditorFont[];
  edits: Record<string, RunEdit[]>;
  items: Item[];
  editing: string | null;
  setEditing: (id: string | null) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  onCommitLine: (line: EditorLine, runs: RunEdit[] | null) => void;
  onItemChange: (item: Item, record?: boolean) => void;
  onCreate: (item: Item) => void;
};

function EditorPage(p: PageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const { scale, size } = p;

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "600px 0px" });
    io.observe(wrap.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await pdf.editorRender(p.session, p.index, scale * DPR()).catch(() => null); // session closed
      if (!r) return;
      if (cancelled || !canvas.current) return;
      canvas.current.width = r.w;
      canvas.current.height = r.h;
      canvas.current.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer as ArrayBuffer, r.data.byteOffset, r.data.length), r.w, r.h), 0, 0);
    }, 60);
    if (p.mode === "edit") p.loadLines(p.index);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [visible, scale, p.version, p.session, p.index, p.mode === "edit"]);

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    p.setSelected(null);
    const pt = toPage(e);
    if (p.mode === "text") {
      e.preventDefault(); // keep focus in the new text box instead of the page
      p.onCreate({ id: nid(), page: p.index, kind: "text", x: pt.x, y: pt.y - 10, text: "", size: 14, color: [0, 0, 0], font: "sans", bold: false, italic: false });
    } else if (p.mode === "whiteout" || p.mode === "highlight") {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const pt = toPage(e);
    setDrag({ ...drag, x1: pt.x, y1: pt.y });
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const end = toPage(e); // include where the pointer was released
    const x = Math.min(drag.x0, end.x), y = Math.min(drag.y0, end.y);
    const w = Math.abs(end.x - drag.x0), h = Math.abs(end.y - drag.y0);
    setDrag(null);
    if (w < 3 || h < 3) return;
    p.onCreate(
      p.mode === "whiteout"
        ? { id: nid(), page: p.index, kind: "rect", x, y, w, h, color: [1, 1, 1], opacity: 1 }
        : { id: nid(), page: p.index, kind: "rect", x, y, w, h, color: [1, 0.86, 0.2], opacity: 0.45, blend: "Multiply" },
    );
  };

  const fontFor = (key: number) => {
    const f = p.fonts[key];
    return f ? cssFontFor(f) : "Arial, sans-serif";
  };

  return (
    <div className="ed-page" data-page={p.index} ref={wrap} style={{ width: size.w * scale, height: size.h * scale }}>
      <canvas ref={canvas} />
      <div
        className={`ed-layer${p.mode === "edit" ? " edit-text" : ""}`}
        style={{ cursor: p.mode === "text" ? "text" : p.mode === "whiteout" || p.mode === "highlight" ? "crosshair" : "default" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        {p.mode === "edit" &&
          p.lines?.map((l) =>
            p.editing === l.id ? (
              <LineEditor key={l.id} line={l} runs={p.edits[l.id] ?? l.runs} scale={scale} fontFor={fontFor} fonts={p.fonts} onDone={(runs) => p.onCommitLine(l, runs)} />
            ) : (
              <div
                key={l.id}
                className={`ed-line${p.edits[l.id] ? " changed" : ""}`}
                style={{ left: l.bbox[0] * scale - 2, top: l.bbox[1] * scale - 1, width: (l.bbox[2] - l.bbox[0]) * scale + 4, height: (l.bbox[3] - l.bbox[1]) * scale + 2 }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => p.setEditing(l.id)}
                title="Click to edit"
              />
            ),
          )}
        {p.items.map((it) => (
          <ItemView key={it.id} item={it} scale={scale} fontFor={fontFor} selected={p.selected === it.id} onSelect={() => p.setSelected(it.id)} onChange={p.onItemChange} />
        ))}
        {drag && (
          <div
            style={{
              position: "absolute", left: Math.min(drag.x0, drag.x1) * scale, top: Math.min(drag.y0, drag.y1) * scale,
              width: Math.abs(drag.x1 - drag.x0) * scale, height: Math.abs(drag.y1 - drag.y0) * scale,
              background: p.mode === "whiteout" ? "#fff" : "rgba(255,220,50,.45)", outline: "1px dashed var(--brand)", mixBlendMode: p.mode === "highlight" ? "multiply" : undefined,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ inline line editor

function LineEditor({ line, runs, scale, fontFor, fonts, onDone }: { line: EditorLine; runs: (EditorRun | RunEdit)[]; scale: number; fontFor: (k: number) => string; fonts: EditorFont[]; onDone: (runs: RunEdit[] | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const maxSize = Math.max(...runs.map((r) => r.size));

  useEffect(() => {
    const el = ref.current!;
    el.focus();
    const sel = getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

  const finish = (cancel = false) => {
    if (done.current) return;
    done.current = true;
    if (cancel) return onDone(null);
    const el = ref.current!;
    const res: RunEdit[] = [];
    let last: RunEdit = { ...runs[0] } as RunEdit;
    const push = (text: string, base: RunEdit) => {
      if (!text) return;
      const prev = res.at(-1);
      if (prev && prev.fontKey === base.fontKey && prev.size === base.size && prev.color.join() === base.color.join()) prev.text += text;
      else res.push({ text, fontKey: base.fontKey, size: base.size, color: base.color });
    };
    el.childNodes.forEach((n) => {
      const k = n instanceof HTMLElement ? n.dataset.k : undefined;
      const base: RunEdit = k !== undefined ? { ...(runs[+k] as RunEdit) } : last;
      push((n.textContent ?? "").replace(/\n/g, " "), base);
      last = base;
    });
    onDone(res.length ? res : [{ text: "", fontKey: runs[0].fontKey, size: runs[0].size, color: runs[0].color as Rgb }]);
  };

  return (
    <div
      ref={ref}
      className="ed-input"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={{ left: line.bbox[0] * scale - 1, top: (line.baseline - maxSize * 0.93) * scale, minHeight: maxSize * 1.15 * scale }}
      onBlur={() => finish()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish();
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(true);
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " "));
      }}
    >
      {runs.map((r, i) => {
        const f = fonts[r.fontKey];
        return (
          <span
            key={i}
            data-k={i}
            style={{ fontFamily: fontFor(r.fontKey), fontSize: r.size * scale, fontWeight: f?.bold ? 700 : 400, fontStyle: f?.italic ? "italic" : "normal", color: css(r.color as Rgb) }}
          >
            {r.text}
          </span>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ movable items

function ItemView({ item, scale, fontFor, selected, onSelect, onChange }: { item: Item; scale: number; fontFor: (k: number) => string; selected: boolean; onSelect: () => void; onChange: (i: Item, record?: boolean) => void }) {
  const start = useRef<{ x: number; y: number; item: Item; resize: boolean } | null>(null);
  const moved = useRef(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (item.kind === "text" && !item.text) requestAnimationFrame(() => textRef.current?.focus());
  }, []);

  const down = (e: React.PointerEvent, resize = false) => {
    if ((e.target as HTMLElement).tagName === "TEXTAREA") {
      // clicking the text itself edits it; drag with the handle instead
      e.stopPropagation();
      onSelect();
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, item, resize };
    moved.current = false;
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = (e.clientX - s.x) / scale, dy = (e.clientY - s.y) / scale;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) moved.current = true;
    if (s.resize && s.item.kind !== "text") {
      const ratio = s.item.h / s.item.w;
      const w = Math.max(8, s.item.w + dx);
      onChange({ ...s.item, w, h: s.item.kind === "image" ? w * ratio : Math.max(4, s.item.h + dy) }, false);
    } else onChange({ ...s.item, x: s.item.x + dx, y: s.item.y + dy }, false);
  };
  const up = () => {
    if (start.current && moved.current) onChange(item, true);
    start.current = null;
  };

  const common = { onPointerDown: (e: React.PointerEvent) => down(e), onPointerMove: move, onPointerUp: up };
  if (item.kind === "text") {
    const lines = item.text.split("\n");
    const cols = Math.max(item.text ? 2 : 10, ...lines.map((l) => l.length + 1));
    const family = typeof item.font === "number" ? fontFor(item.font) : item.font === "serif" ? "'Times New Roman', Times, serif" : item.font === "mono" ? "'Courier New', monospace" : "Arial, Helvetica, sans-serif";
    return (
      <div className={`ed-item${selected ? " sel" : ""}`} style={{ left: item.x * scale, top: item.y * scale }} {...common}>
        {selected && (
          <span className="move" title="Drag to move" onPointerDown={(e) => down(e)} onPointerMove={move} onPointerUp={up}>
            <GripVertical />
          </span>
        )}
        <textarea
          ref={textRef}
          value={item.text}
          placeholder="Type here"
          rows={lines.length}
          cols={cols}
          spellCheck={false}
          onFocus={onSelect}
          onChange={(e) => onChange({ ...item, text: e.target.value }, false)}
          onBlur={() => onChange(item, true)}
          style={{ fontFamily: family, fontSize: item.size * scale, color: css(item.color), fontWeight: item.bold ? 700 : 400, fontStyle: item.italic ? "italic" : "normal", width: `${cols * 0.62}em` }}
        />
      </div>
    );
  }
  return (
    <div className={`ed-item${selected ? " sel" : ""}`} style={{ left: item.x * scale, top: item.y * scale, width: item.w * scale, height: item.h * scale }} {...common}>
      {item.kind === "image" ? (
        <img src={item.url} alt="" draggable={false} style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", background: css(item.color), opacity: item.opacity, mixBlendMode: item.blend ? "multiply" : undefined, boxShadow: item.opacity === 1 ? "0 0 0 1px rgba(0,0,0,.06)" : undefined }} />
      )}
      {selected && <span className="handle" onPointerDown={(e) => down(e, true)} onPointerMove={move} onPointerUp={up} />}
    </div>
  );
}

