import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { acceptAttr, type Opts, type Tool } from "../tools/registry";
import { Dropzone } from "../components/Dropzone";
import { FileList, type Item } from "../components/FileList";
import { OptionsForm, defaultOpts } from "../components/OptionsForm";
import { ErrorNote, Progress, Result } from "../components/Result";
import { ext, uniqueNames, type OutFile } from "../lib/files";
import { handoff } from "../app/router";

let uid = 0;
const toItems = (files: File[]): Item[] => files.map((file) => ({ id: `f${++uid}`, file }));

export function ToolHeader({ tool }: { tool: Tool }) {
  const Icon = tool.icon;
  return (
    <>
      <a className="crumb" href="#/">
        <ArrowLeft /> All tools
      </a>
      <div className="tool-head">
        <span className="ico">
          <Icon />
        </span>
        <div>
          <h1>{tool.name}</h1>
          <p>{tool.desc}</p>
        </div>
      </div>
    </>
  );
}

type State = { kind: "idle" } | { kind: "running"; progress: number | null } | { kind: "done"; files: OutFile[] } | { kind: "error"; message: string };

export function ToolPage({ tool }: { tool: Tool }) {
  const [items, setItems] = useState<Item[]>(() => {
    const files = handoff.take().filter((f) => tool.accept.includes(ext(f.name)));
    return toItems(tool.multiple ? files : files.slice(0, 1));
  });
  const [opts, setOpts] = useState<Opts>(() => defaultOpts(tool.options));
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    document.title = `${tool.name} · DrDoc`;
  }, [tool]);

  const addFiles = useCallback(
    (files: File[]) => {
      const ok = files.filter((f) => tool.accept.includes(ext(f.name)) || (tool.accept.includes("jpg") && f.type.startsWith("image/")));
      const rejected = files.length - ok.length;
      if (rejected) setState({ kind: "error", message: `${rejected === 1 ? "That file isn't" : `${rejected} files aren't`} supported here. This tool takes ${tool.accept.map((e) => e.toUpperCase()).join(", ")}.` });
      else setState({ kind: "idle" });
      if (!ok.length) return;
      setItems((cur) => (tool.multiple ? [...cur, ...toItems(ok)] : toItems(ok.slice(0, 1))));
    },
    [tool],
  );
  const onReorder = useCallback((next: Item[]) => setItems(next), []);

  const run = async () => {
    if (!items.length) return setState({ kind: "error", message: "Add a file first." });
    setState({ kind: "running", progress: null });
    try {
      const res = await tool.run!(items.map((i) => i.file), opts, {
        progress: (p) => setState({ kind: "running", progress: Math.min(1, Math.max(0, p)) }),
      });
      setState({ kind: "done", files: uniqueNames(Array.isArray(res) ? res : [res]) });
    } catch (e) {
      console.error(e);
      setState({ kind: "error", message: (e as Error).message || "Something went wrong." });
    }
  };

  const reset = () => {
    setItems([]);
    setState({ kind: "idle" });
  };

  const busy = state.kind === "running";
  const inputSize = items.reduce((a, i) => a + i.file.size, 0);
  const types = tool.accept.filter((e) => !["jpeg", "heif", "markdown", "htm", "xlsm"].includes(e)).map((e) => e.toUpperCase()).join(", ");

  return (
    <div className="page">
      <ToolHeader tool={tool} />
      <div className="workspace">
        <div>
          {state.kind === "done" ? null : !items.length ? (
            <Dropzone accept={acceptAttr(tool)} multiple={tool.multiple} onFiles={addFiles} camera={tool.accept.includes("jpg")} types={types} />
          ) : (
            <>
              {tool.multiple && <Dropzone accept={acceptAttr(tool)} multiple onFiles={addFiles} compact />}
              <FileList items={items} onChange={onReorder} ordered={tool.ordered} />
            </>
          )}
          {state.kind === "done" && (
            <div className="panel">
              <div className="panel-body">
                <Result files={state.files} inputSize={tool.id.includes("compress") || tool.id.includes("resize") ? inputSize : undefined} zipName={`${tool.id}.zip`} onReset={reset} />
              </div>
            </div>
          )}
        </div>
        {state.kind !== "done" && (
          <aside className="panel side">
            <div className="panel-body">
              {tool.options?.length ? (
                <>
                  <h2>Options</h2>
                  <OptionsForm options={tool.options} values={opts} onChange={setOpts} />
                </>
              ) : (
                <p className="muted" style={{ fontSize: 14 }}>
                  {items.length ? "Ready when you are." : `Add ${tool.multiple ? "one or more files" : "a file"} to get started.`}
                </p>
              )}
              {state.kind === "error" && <ErrorNote message={state.message} />}
              {busy ? (
                <Progress value={state.progress} label={state.progress === null ? "Working…" : `Working… ${Math.round(state.progress * 100)}%`} />
              ) : (
                <div className="sticky-action">
                  <button className="btn primary lg block" onClick={run} disabled={!items.length}>
                    {tool.action ?? "Convert"}
                  </button>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
