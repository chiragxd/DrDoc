import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronRight, Lock, Search, Upload, WifiOff, X, Zap } from "lucide-react";

const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
import { CATEGORIES, POPULAR, TOOLS, TOOL_BY_ID, toolsForFile, type Tool } from "../tools/registry";
import { go, handoff } from "../app/router";
import { formatSize } from "../lib/files";

function ToolRow({ t, onClick }: { t: Tool; onClick?: () => void }) {
  const Icon = t.icon;
  return (
    <a className="tool-row" href={`#/tool/${t.id}`} onClick={onClick}>
      <span className="ico">
        <Icon />
      </span>
      <span className="txt">
        <span className="name">{t.name}</span>
        <span className="desc">{t.desc}</span>
      </span>
    </a>
  );
}

function QuickDrop() {
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const tools = useMemo(() => {
    if (!files.length) return [];
    const sets = files.map((f) => new Set(toolsForFile(f.name).map((t) => t.id)));
    return TOOLS.filter((t) => sets.every((s) => s.has(t.id)) && (files.length === 1 || t.multiple));
  }, [files]);

  return (
    <div
      className={`quickdrop${over ? " over" : ""}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) setFiles([...e.dataTransfer.files]);
      }}
    >
      {!files.length ? (
        <>
          <div className="art">
            <Upload />
          </div>
          <h2>Start with a file</h2>
          <p>{touch ? "Pick a file and we'll show you everything you can do with it." : "Drop it here and we'll show you everything you can do with it."}</p>
          <div className="row">
            <button className="btn primary lg" onClick={() => input.current?.click()}>
              Choose a file
            </button>
            {touch && (
              <a className="btn lg" href="#/tool/scan">
                <Camera /> Scan with camera
              </a>
            )}
          </div>
          <div className="types">PDF, Word, PowerPoint, Excel, images, Markdown, HTML, EPUB</div>
        </>
      ) : (
        <div className="suggest">
          <div className="file-chip">
            <span className="name">{files.length === 1 ? files[0].name : `${files.length} files`}</span>
            <span className="faint" style={{ fontSize: 12.5 }}>
              {formatSize(files.reduce((a, f) => a + f.size, 0))}
            </span>
            <button className="icon-btn" aria-label="Clear" onClick={() => setFiles([])}>
              <X />
            </button>
          </div>
          {tools.length ? (
            <>
              <h3>What would you like to do?</h3>
              <div className="suggest-list">
                {tools.map((t) => (
                  <ToolRow key={t.id} t={t} onClick={() => handoff.set(files)} />
                ))}
              </div>
            </>
          ) : (
            <p className="muted" style={{ textAlign: "center", padding: "12px 0" }}>
              DrDoc doesn't have a tool for this file type yet.
            </p>
          )}
        </div>
      )}
      <input ref={input} type="file" hidden multiple onChange={(e) => (e.target.files?.length && setFiles([...e.target.files]), (e.target.value = ""))} />
    </div>
  );
}

export function Home() {
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.title = "DrDoc · Doctor Document";
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && document.activeElement === document.body)) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (t: Tool) => {
    const hay = `${t.name} ${t.desc} ${t.cat} ${t.keywords ?? ""} ${t.accept.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const hits = TOOLS.filter(match);

  return (
    <div className="page">
      <section className="hero">
        <div>
          <h1>
            Every document fix, <em>in your browser.</em>
          </h1>
          <p className="lead">
            Edit, convert, organize and compress PDFs, Word, PowerPoint and Excel files. Your files are processed on your device and never uploaded.
          </p>
          <div className="facts">
            <span>
              <Lock /> Private by design
            </span>
            <span>
              <WifiOff /> Works offline once loaded
            </span>
            <span>
              <Zap /> Free, no sign-up
            </span>
          </div>
        </div>
        <QuickDrop />
      </section>

      {!q && (
        <section className="popular" aria-label="Popular tools">
          {POPULAR.map((id) => {
            const t = TOOL_BY_ID[id];
            const Icon = t.icon;
            return (
              <a key={id} className="pop" href={`#/tool/${id}`}>
                <span className="ico">
                  <Icon />
                </span>
                <span>
                  <div className="name">{t.name}</div>
                  <div className="desc">{t.desc}</div>
                </span>
              </a>
            );
          })}
        </section>
      )}

      <div className="directory-head">
        <h2>All tools</h2>
        <label className="search">
          <Search />
          <input ref={search} className="input" type="search" placeholder="Search tools" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tools" />
          <kbd>Ctrl K</kbd>
        </label>
      </div>

      {CATEGORIES.map((c) => {
        const ts = hits.filter((t) => t.cat === c);
        if (!ts.length) return null;
        return (
          <section className="cat" key={c}>
            <h3>{c}</h3>
            <div className="tool-grid">
              {ts.map((t) => (
                <ToolRow key={t.id} t={t} />
              ))}
            </div>
          </section>
        );
      })}
      {!hits.length && (
        <div className="empty">
          No tool matches “{q}”.{" "}
          <button className="btn sm ghost" onClick={() => setQ("")}>
            Clear search
          </button>
        </div>
      )}
    </div>
  );
}

export function NotFound() {
  return (
    <div className="page">
      <div className="empty">
        <h1 style={{ fontSize: 24, color: "var(--text)" }}>Page not found</h1>
        <p style={{ margin: "8px 0 16px" }}>That link doesn't lead anywhere.</p>
        <button className="btn primary" onClick={() => go("/")}>
          Go to all tools <ChevronRight />
        </button>
      </div>
    </div>
  );
}
