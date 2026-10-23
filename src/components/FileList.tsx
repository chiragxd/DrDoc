import { useEffect, useRef } from "react";
import Sortable from "sortablejs";
import { GripVertical, X } from "lucide-react";
import { ext, formatSize } from "../lib/files";

export type Item = { id: string; file: File };

/** Files with optional drag-to-reorder (works with touch). */
export function FileList({ items, onChange, ordered }: { items: Item[]; onChange: (items: Item[]) => void; ordered?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(items);
  latest.current = items;

  useEffect(() => {
    if (!ordered || !ref.current) return;
    const s = Sortable.create(ref.current, {
      animation: 160,
      handle: ".grip",
      onEnd: (e) => {
        if (e.oldIndex === undefined || e.newIndex === undefined || e.oldIndex === e.newIndex) return;
        // undo Sortable's DOM move; React re-renders in the new order
        const parent = e.from;
        parent.insertBefore(e.item, parent.children[e.oldIndex + (e.oldIndex > e.newIndex ? 1 : 0)] ?? null);
        const next = [...latest.current];
        const [moved] = next.splice(e.oldIndex, 1);
        next.splice(e.newIndex, 0, moved);
        onChange(next);
      },
    });
    return () => s.destroy();
  }, [ordered, onChange]);

  if (!items.length) return null;
  const total = items.reduce((a, i) => a + i.file.size, 0);
  return (
    <>
      <div className="files-head">
        <span>
          {items.length} file{items.length > 1 ? "s" : ""} · {formatSize(total)}
          {ordered && items.length > 1 ? " · drag to reorder" : ""}
        </span>
        <button type="button" onClick={() => onChange([])}>
          Clear
        </button>
      </div>
      <div className="files" ref={ref}>
        {items.map((it) => (
          <div className="file" key={it.id}>
            {ordered && items.length > 1 && (
              <span className="grip" aria-label="Drag to reorder">
                <GripVertical />
              </span>
            )}
            <span className="badge">{(ext(it.file.name) || "FILE").slice(0, 4).toUpperCase()}</span>
            <div className="meta">
              <div className="name" title={it.file.name}>
                {it.file.name}
              </div>
              <div className="size">{formatSize(it.file.size)}</div>
            </div>
            <button className="icon-btn" aria-label={`Remove ${it.file.name}`} onClick={() => onChange(items.filter((x) => x.id !== it.id))}>
              <X />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
