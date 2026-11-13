import { defineConfig } from "vite";

// In the browser, Nextcloud WebDAV requests need CORS. During development the
// dev server proxies /dav to the URL in NEXTCLOUD_URL. The native shells
// (Capacitor, Electron) send requests without CORS restrictions.
export default defineConfig({
  // Relative asset URLs: the same build runs from app:// (Electron), Capacitor and any web path.
  base: "./",
  // pdf.js 4 needs ES2022 (Safari/iPadOS 16.4+, current Chrome, Edge, Firefox).
  build: { target: "es2022" },
  server: process.env.NEXTCLOUD_URL
    ? {
        proxy: {
          "/dav": {
            target: process.env.NEXTCLOUD_URL,
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/dav/, "/remote.php/dav"),
          },
        },
      }
    : {},
});
