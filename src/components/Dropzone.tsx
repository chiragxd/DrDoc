import { useRef, useState, type ReactNode } from "react";
import { Camera, Plus, Upload } from "lucide-react";

const isTouch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export function Dropzone(props: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  compact?: boolean;
  camera?: boolean;
  title?: string;
  types?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (list: FileList | null) => {
    if (list?.length) props.onFiles([...list]);
  };
  const what = props.multiple ? "files" : "a file";

  return (
    <>
      <div
        className={`dropzone${props.compact ? " compact" : ""}${over ? " over" : ""}`}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("[data-cam]")) input.current?.click();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files);
        }}
      >
        <span className="art">{props.compact ? <Plus /> : <Upload />}</span>
        {props.compact ? (
          <strong>Add more files</strong>
        ) : (
          <>
            <strong>{props.title ?? (isTouch ? `Choose ${what}` : `Drop ${what} here`)}</strong>
            <span className="types">{props.types}</span>
            <div className="row">
              <button type="button" className="btn primary">
                <Upload /> Choose {what}
              </button>
              {props.camera && isTouch && (
                <button type="button" className="btn" data-cam onClick={() => cam.current?.click()}>
                  <Camera /> Take photo
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <input ref={input} type="file" hidden multiple={props.multiple} accept={props.accept} onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
      <input ref={cam} type="file" hidden accept="image/*" capture="environment" onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
    </>
  );
}
