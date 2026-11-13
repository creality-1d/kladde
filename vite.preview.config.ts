import { cpSync } from "node:fs";
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

// Development aid: builds the import preview page next to the app for visual
// checks, with local sample archives from test-samples/ (never part of app builds).
export default mergeConfig(base, defineConfig({
  build: { outDir: "dist-preview", rollupOptions: { input: { main: "index.html", preview: "preview.html" } } },
  plugins: [{ name: "copy-samples", closeBundle: () => cpSync("test-samples", "dist-preview/samples", { recursive: true }) }],
}));
