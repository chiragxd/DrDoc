import { useCallback, useEffect, useRef, useState } from "react";
import Sortable from "sortablejs";
import { ArrowLeft, Check, Copy, Download, FilePlus, LoaderCircle, Plus, RotateCcw, RotateCw, Trash, X } from "lucide-react";
import { pdf } from "../engine/pdf/client";
import { imageForPdf, IMAGE_EXT } from "../engine/convert/images";
import { Dropzone } from "../components/Dropzone";
import { PasswordDialog, Toast } from "../components/Dialog";
import { ErrorNote } from "../components/Result";
import { download, ext, out, stem } from "../lib/files";
import { handoff } from "../app/router";
import type { Tool } from "../tools/registry";

const COLORS = ["#0f7b6c", "#c2410c", "#2563eb", "#9333ea", "#ca8a04", "#db2777", "#0891b2", "#4d7c0f"];

type Source = { id: number; name: string; color: string; bytes: Uint8Array; password: string; count: number; sizes: { w: number; h: number }[] };
type Page = { key: string; src: number; index: number; rotate: number } | { key: string; blank: true; w: number; h: number; rotate: number };

let keySeq = 0;
const newKey = () => `p${++keySeq}`;

/** Move array item, used by Sortable callbacks. */
function move<T>(arr: T[], from: number, to: number) {
  const next = [...arr];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** Keep React in charge of the DOM: undo Sortable's move, then update state. */
function sortable(el: HTMLElement, opts: Sortable.Options & { onMove2: (from: number, to: number) => void }) {
  return Sortable.create(el, {
    animation: 180,
    ...opts,
    onEnd: (e) => {
      if (e.oldIndex === undefined || e.newIndex === undefined || e.oldIndex === e.newIndex) return;
      e.from.insertBefore(e.item, e.from.children[e.oldIndex + (e.oldIndex > e.newIndex ? 1 : 0)] ?? null);
      opts.onMove2(e.oldIndex, e.newIndex);
    },
  });
}

export function Organizer({ tool }: { tool: Tool }) {
  const merge = tool.id === "merge";
  const [sources, setSources] = useState<Source[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ name: string; error?: string; resolve: (pw: string | null) => void } | null>(null);
  const srcSeq = useRef(0);
  const grid = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `${tool.name} · DrDoc`;
    const files = handoff.take();
    if (files.length) void addFiles(files);
    return () => Object.values(thumbsRef.current).forEach((u) => URL.revokeObjectURL(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;

  const askPassword = (name: string, err?: string) => new Promise<string | null>((resolve) => setAsk({ name, error: err, resolve }));

  const addFiles = useCallback(async (files: File[]) => {
    setError(null);
    const accepted = files.filter((f) => ["pdf", ...IMAGE_EXT].includes(ext(f.name)) || f.type.startsWith("image/"));
    if (accepted.length < files.length) setToast(`${files.length - accepted.length} file(s) skipped: only PDFs and images can be added.`);
    for (const f of accepted) {
      setBusy(`Opening ${f.name}…`);
      try {
        let bytes: Uint8Array;
        if (ext(f.name) === "pdf") bytes = new Uint8Array(await f.arrayBuffer());
        else bytes = await pdf.imagesToPdf([await imageForPdf(f, { quality: 0.9 })], { pageSize: "a4", margin: 0 });
        let password = "";
        let info = await pdf.info(bytes);
        let msg: string | undefined;
        while (info.locked) {
          const pw = await askPassword(f.name, msg);
          setAsk(null);
          if (pw === null) throw new Error(`${f.name} was skipped because it's password protected.`);
          info = await pdf.info(bytes, pw);
          password = pw;
          msg = "That password didn't work. Try again.";
        }
        const id = ++srcSeq.current;
        const src: Source = { id, name: f.name, color: COLORS[(id - 1) % COLORS.length], bytes, password, count: info.pageCount, sizes: info.pages };
        const newPages: Page[] = Array.from({ length: info.pageCount }, (_, index) => ({ key: newKey(), src: id, index, rotate: 0 }));
        setSources((s) => [...s, src]);
        setPages((p) => [...p, ...newPages]);
        void renderThumbs(src, newPages);
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setBusy(null);
  }, []);

  async function renderThumbs(src: Source, list: Page[]) {
    const { id } = await pdf.open(src.bytes, src.password);
    try {
      for (const p of list) {
        if ("blank" in p) continue;
        const size = src.sizes[p.index];
        const r = await pdf.renderOpen(id, p.index, { scale: 260 / Math.max(size.w, size.h), format: "jpeg", quality: 78 });
        const url = URL.createObjectURL(new Blob([r.data as BlobPart], { type: "image/jpeg" }));
        setThumbs((t) => ({ ...t, [`${src.id}:${p.index}`]: url }));
      }
    } finally {
      pdf.close(id);
    }
  }

  // drag to reorder pages
  useEffect(() => {
    if (!grid.current) return;
    const s = sortable(grid.current, {
      onMove2: (from, to) => setPages((p) => move(p, from, to)),
      delay: 120,
      delayOnTouchOnly: true,
      filter: ".tools, .pick",
      preventOnFilter: false,
    });
    return () => s.destroy();
  }, [pages.length > 0]);

  // drag file chips to reorder whole files
  useEffect(() => {
    if (!chips.current) return;
    const s = sortable(chips.current, {
      onMove2: (from, to) => {
        const order = move(sourcesRef.current, from, to);
        setSources(order);
        const rank = new Map(order.map((s, i) => [s.id, i]));
        // blank pages travel with the page before them
        let last = -1;
        const ranked = pagesRef.current.map((p, i) => {
          if (!("blank" in p)) last = rank.get(p.src)!;
          return { p, r: last, i };
        });
        setPages(ranked.sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.p));
      },
      filter: "button",
      preventOnFilter: false,
    });
    return () => s.destroy();
  }, [sources.length > 1]);

  const targets = () => (sel.size ? pages.filter((p) => sel.has(p.key)).map((p) => p.key) : pages.map((p) => p.key));
  const rotate = (keys: string[], d: number) => setPages((ps) => ps.map((p) => (keys.includes(p.key) ? { ...p, rotate: (p.rotate + d + 360) % 360 } : p)));
  const remove = (keys: string[]) => {
    setPages((ps) => ps.filter((p) => !keys.includes(p.key)));
    setSel(new Set());
  };
  const duplicate = (keys: string[]) =>
    setPages((ps) => ps.flatMap((p) => (keys.includes(p.key) ? [p, { ...p, key: newKey() }] : [p])));
  const insertBlank = () => {
    setPages((ps) => {
      const firstReal = ps.find((p) => !("blank" in p)) as Extract<Page, { src: number }> | undefined;
      const size = firstReal ? sources.find((s) => s.id === firstReal.src)?.sizes[firstReal.index] : undefined;
      const blank: Page = { key: newKey(), blank: true, w: size?.w ?? 595.28, h: size?.h ?? 841.89, rotate: 0 };
      const lastSel = ps.map((p) => sel.has(p.key)).lastIndexOf(true);
      const at = lastSel >= 0 ? lastSel + 1 : ps.length;
      return [...ps.slice(0, at), blank, ...ps.slice(at)];
    });
  };
  const removeSource = (id: number) => {
    setSources((s) => s.filter((x) => x.id !== id));
    setPages((ps) => ps.filter((p) => "blank" in p || p.src !== id));
  };
  const toggle = (key: string) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const save = async () => {
    if (!pages.length) return;
    setBusy("Building your PDF…");
    setError(null);
    try {
      const index = new Map(sources.map((s, i) => [s.id, i]));
      const refs = pages.map((p) => ("blank" in p ? { blank: true as const, w: p.w, h: p.h } : { src: index.get(p.src)!, index: p.index, rotate: p.rotate }));
      const bytes = await pdf.compose(sources.map((s) => ({ bytes: s.bytes, password: s.password })), refs);
      const name = merge || sources.length > 1 ? "merged.pdf" : `${stem(sources[0].name)}-organized.pdf`;
      download(out(name, bytes));
      setToast(`Saved ${name} · ${pages.length} page${pages.length > 1 ? "s" : ""}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const srcOf = (id: number) => sources.find((s) => s.id === id);
  const t = targets();
  const scope = sel.size ? `${sel.size} selected` : "all pages";

  return (
    <div className="ws">
      <div className="ws-bar">
        <a className="icon-btn" href="#/" aria-label="All tools" title="All tools">
          <ArrowLeft />
        </a>
        <span className="title">{tool.name}</span>
        {pages.length > 0 && (
          <>
            <span className="sep" />
            <button className="btn sm ghost" onClick={() => input.current?.click()} title="Add PDFs or images">
              <FilePlus /> <span className="label-opt">Add files</span>
            </button>
            <button className="btn sm ghost" onClick={insertBlank} title="Insert a blank page">
              <Plus /> <span className="label-opt">Blank page</span>
            </button>
            <span className="sep" />
            <button className="icon-btn" onClick={() => rotate(t, -90)} title={`Rotate left (${scope})`}>
              <RotateCcw />
            </button>
            <button className="icon-btn" onClick={() => rotate(t, 90)} title={`Rotate right (${scope})`}>
              <RotateCw />
            </button>
            <button className="icon-btn" onClick={() => duplicate(t)} disabled={!sel.size} title="Duplicate selected">
              <Copy />
            </button>
            <button className="icon-btn" onClick={() => remove(t)} disabled={!sel.size} title="Delete selected">
              <Trash />
            </button>
            {sel.size > 0 && (
              <button className="btn sm ghost" onClick={() => setSel(new Set())}>
                <X /> <span className="label-opt">{sel.size} selected</span>
              </button>
            )}
            <span className="grow" />
            <span className="faint label-opt" style={{ fontSize: 13, marginRight: 8 }}>
              {pages.length} page{pages.length === 1 ? "" : "s"}
            </span>
            <button className="btn primary" onClick={save} disabled={!!busy || !pages.length}>
              {busy ? <LoaderCircle className="spin" /> : <Download />}
              {merge || sources.length > 1 ? "Merge & download" : "Download"}
            </button>
          </>
        )}
      </div>

      {!pages.length ? (
        <div className="ws-empty">
          <div style={{ width: "min(100%, 620px)" }}>
            <div className="tool-head" style={{ marginBottom: 18 }}>
              <span className="ico">
                <tool.icon />
              </span>
              <div>
                <h1>{tool.name}</h1>
                <p>{merge ? "Add files, then drag files or single pages into the order you want." : "Add a PDF to see every page. Drag to reorder, rotate or remove."}</p>
              </div>
            </div>
            {busy ? (
              <div className="panel panel-body">
                <p className="muted">{busy}</p>
              </div>
            ) : (
              <Dropzone accept=".pdf,image/*,.heic,.heif" multiple onFiles={addFiles} types="PDF and images (JPG, PNG, HEIC, WebP)" />
            )}
            {error && <div style={{ marginTop: 12 }}><ErrorNote message={error} /></div>}
          </div>
        </div>
      ) : (
        <div className="org">
          {error && <div style={{ marginBottom: 14 }}><ErrorNote message={error} /></div>}
          {sources.length > 1 && (
            <div className="org-files" ref={chips} title="Drag to change file order">
              {sources.map((s) => (
                <span className="org-chip" key={s.id}>
                  <span className="dot" style={{ background: s.color }} />
                  <span className="n">{s.name}</span>
                  <span className="c">{s.count}</span>
                  <button aria-label={`Remove ${s.name}`} onClick={() => removeSource(s.id)}>
                    <X />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="pages" ref={grid}>
            {pages.map((p, i) => {
              const src = "blank" in p ? null : srcOf(p.src);
              const url = src && !("blank" in p) ? thumbs[`${src.id}:${p.index}`] : null;
              return (
                <div className={`pg${sel.has(p.key) ? " sel" : ""}`} key={p.key}>
                  <div className="sheet" onClick={() => toggle(p.key)}>
                    {"blank" in p ? (
                      <div className="blank" style={{ rotate: `${p.rotate}deg` }} />
                    ) : url ? (
                      <img src={url} alt={`Page ${i + 1}`} style={{ rotate: `${p.rotate}deg` }} draggable={false} />
                    ) : (
                      <div className="ph" />
                    )}
                    {sources.length > 1 && src && <span className="tag" style={{ background: src.color }} />}
                    <span className="pick">{sel.has(p.key) && <Check />}</span>
                  </div>
                  <div className="tools">
                    <button className="icon-btn" title="Rotate" onClick={() => rotate([p.key], 90)}>
                      <RotateCw />
                    </button>
                    <button className="icon-btn" title="Delete page" onClick={() => remove([p.key])}>
                      <Trash />
                    </button>
                  </div>
                  <div className="label">{i + 1}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <input ref={input} type="file" hidden multiple accept=".pdf,image/*,.heic,.heif" onChange={(e) => (e.target.files && addFiles([...e.target.files]), (e.target.value = ""))} />
      {ask && <PasswordDialog name={ask.name} error={ask.error} onDone={ask.resolve} />}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
