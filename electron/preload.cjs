// Exposes a CORS-free request function for Nextcloud WebDAV (see src/webdav.ts).
// contextBridge copies values structurally, so this returns plain data and the
// page builds the Response.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kladdeNative", {
  request: (url, init) => ipcRenderer.invoke("kladde:fetch", url, init),
});
