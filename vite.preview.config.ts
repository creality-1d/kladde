import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

// Development aid: builds the import preview page next to the app for visual checks.
export default mergeConfig(base, defineConfig({
  build: { outDir: "dist-preview", rollupOptions: { input: { main: "index.html", preview: "preview.html" } } },
}));
