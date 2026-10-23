import { useState } from "react";
import { CircleAlert, CircleCheck, Download, LoaderCircle } from "lucide-react";
import { download, formatSize, zip, type OutFile } from "../lib/files";

export function Progress({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="progress" role="status" aria-live="polite">
      <div className={`bar${value === null ? " indet" : ""}`}>
        <i style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
      </div>
      <p>{label}</p>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="alert" role="alert">
      <CircleAlert />
      <div>{message}</div>
    </div>
  );
}

export function Result({ files, inputSize, zipName, onReset }: { files: OutFile[]; inputSize?: number; zipName: string; onReset: () => void }) {
  const [zipping, setZipping] = useState(false);
  const total = files.reduce((a, f) => a + f.blob.size, 0);
  const saved = inputSize && total < inputSize ? Math.round((1 - total / inputSize) * 100) : 0;
  const single = files.length === 1;

  return (
    <div className="result">
      <div className="done">
        <CircleCheck />
        {single ? "Your file is ready" : `${files.length} files are ready`}
      </div>
      {saved >= 1 && (
        <div className="saving">
          {formatSize(inputSize!)} → {formatSize(total)} · {saved}% smaller
        </div>
      )}
      {single ? (
        <div className="out-item">
          <span className="n" title={files[0].name}>
            {files[0].name}
          </span>
          <span className="s">{formatSize(files[0].blob.size)}</span>
        </div>
      ) : (
        <div className="out-list">
          {files.map((f) => (
            <div className="out-item" key={f.name}>
              <span className="n" title={f.name}>
                {f.name}
              </span>
              <span className="s">{formatSize(f.blob.size)}</span>
              <button className="icon-btn" aria-label={`Download ${f.name}`} onClick={() => download(f)}>
                <Download />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        className="btn primary lg block"
        autoFocus
        disabled={zipping}
        onClick={async () => {
          if (single) return download(files[0]);
          setZipping(true);
          try {
            download(await zip(files, zipName));
          } finally {
            setZipping(false);
          }
        }}
      >
        {zipping ? <LoaderCircle className="spin" /> : <Download />}
        {single ? "Download" : "Download all (.zip)"}
      </button>
      <button className="btn ghost block" onClick={onReset}>
        Start over
      </button>
    </div>
  );
}
