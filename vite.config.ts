/// <reference types="vitest/config" />
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { serviceWorker } from "./scripts/sw-plugin.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react(), serviceWorker()],
  worker: { format: "es" },
  // MuPDF ships its own WebAssembly loader; pre-bundling breaks its asset URL.
  optimizeDeps: { exclude: ["mupdf"] },
  server: {
    // Allow the real path too, in case the project is opened through a
    // mapped drive or symlink (Vite resolves workers to the real path).
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), here, realpathSync.native(here)] },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
