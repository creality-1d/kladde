// Desktop shell (Windows, Linux, macOS). Serves the built web app from the
// privileged app:// scheme and performs Nextcloud requests in the main process,
// where browser CORS rules do not apply.
const { app, BrowserWindow, ipcMain, net, protocol, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DIST = path.join(__dirname, "..", "dist");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function serveApp() {
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname === "/" ? "/index.html" : pathname)));
    if (!file.startsWith(DIST + path.sep)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

ipcMain.handle("kladde:fetch", async (_event, url, init) => {
  const { protocol: scheme } = new URL(url);
  if (scheme !== "https:" && scheme !== "http:") throw new Error(`unsupported URL scheme ${scheme}`);
  const response = await net.fetch(url, { method: init.method, headers: init.headers, body: init.body });
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers],
    body: new Uint8Array(await response.arrayBuffer()),
  };
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    title: "Kladde",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  // Links leave the app in the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  void window.loadURL("app://kladde/index.html");
}

app.whenReady().then(() => {
  serveApp();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
