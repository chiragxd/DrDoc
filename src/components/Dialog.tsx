import { useEffect, useRef, useState, type ReactNode } from "react";

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Ask for a PDF password. Resolves to null if cancelled. */
export function PasswordDialog({ name, error, onDone }: { name: string; error?: string; onDone: (pw: string | null) => void }) {
  const [pw, setPw] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Dialog title="Password required" onClose={() => onDone(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onDone(pw);
        }}
      >
        <p className="muted" style={{ margin: "6px 0 16px", fontSize: 14 }}>
          <b>{name}</b> is protected. Enter its password to open it. It stays on this device.
        </p>
        <input ref={ref} className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoComplete="current-password" />
        {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{error}</p>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button className="btn primary" disabled={!pw}>
            Open
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
