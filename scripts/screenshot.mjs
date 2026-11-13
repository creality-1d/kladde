// Development aid: opens a URL in headless Edge/Chrome via the DevTools protocol,
// waits until document.title starts with "done" (or a timeout), and saves a PNG.
// Usage: node scripts/screenshot.mjs <browser.exe> <url> <out.png> [width] [height]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [browser, url, out, width = "700", height = "1000"] = process.argv.slice(2);
const profile = mkdtempSync(join(tmpdir(), "kladde-shot-"));
const port = 9300 + Math.floor(Math.random() * 500);
const child = spawn(browser, [`--headless=new`, `--disable-gpu`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error("browser did not expose a page target");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === "Runtime.consoleAPICalled") console.error("console:", msg.params.args.map((a) => a.value ?? a.description).join(" "));
    if (msg.method === "Runtime.exceptionThrown") console.error("exception:", msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    pending.get(msg.id)?.(msg);
  });
  const call = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: false });
  // Transparent where the page paints nothing (e.g. icon corners).
  await call("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  await call("Page.navigate", { url });
  let title = "";
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    title = (await call("Runtime.evaluate", { expression: "document.title", returnByValue: true })).result?.result?.value ?? "";
    if (title.startsWith("done")) break;
  }
  console.log("title:", title);
  const shot = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  ws.close();
} finally {
  child.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
