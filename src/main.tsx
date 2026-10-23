import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles/app.css";
import { App } from "./App";
import { warmUp } from "./engine/pdf/client";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Load the PDF engine in the background so the first job starts instantly.
const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 800));
idle(() => warmUp());

// Offline support (production builds only; the dev server has no service worker).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
