import { deleteSelection, isEmpty, lassoSelect, moveSelection, recognizeShape, scaleSelection, selectionBounds, type Selection } from "./edit";
import { importGoodnotes } from "./goodnotes/import";
import { drawStroke, hitsStroke, renderPage, textHeight } from "./ink";
import {
  newNotebook,
  newPage,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  pageAttachments,
  visiblePages,
  type Notebook,
  type Page,
  type Point,
  type Stroke,
  type Template,
  type Tool,
} from "./model";
import { renderPdfPage } from "./pdf";
import { storage } from "./storage";
import { mergeBack, syncNotebooks } from "./sync";
import { WebDav, type NextcloudAccount } from "./webdav";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("page");
canvas.width = PAGE_WIDTH;
canvas.height = PAGE_HEIGHT;
const ctx = canvas.getContext("2d")!;

let notebooks: Notebook[] = [];
let current: Notebook | undefined;
let pageIndex = 0;
let tool: Tool = "pen";
let drawing: Stroke | undefined;
/** The PDF bitmap of the current page, kept so redraws while writing stay synchronous. */
let background: { key: string; bitmap: HTMLCanvasElement } | undefined;
/** Decoded page images by attachment id. */
const images = new Map<string, ImageBitmap>();
let selection: Selection | undefined;
let lasso: Point[] | undefined;
let dragFrom: Point | undefined;
let zoom = 1;
let query = "";

const page = () => (current ? visiblePages(current)[pageIndex] : undefined);

// History: snapshots of the edited page's content, per notebook session.
type Snapshot = { pageId: string; content: string };
let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];
const contentOf = (p: Page) => JSON.stringify({ strokes: p.strokes, texts: p.texts, images: p.images });

/** Call before changing the current page so the change can be undone. */
function checkpoint(): void {
  const p = page();
  if (!p) return;
  undoStack.push({ pageId: p.id, content: contentOf(p) });
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}

function restore(from: Snapshot[], to: Snapshot[]): void {
  const snapshot = from.pop();
  const p = current?.pages.find((x) => x.id === snapshot?.pageId);
  if (!snapshot || !p || !current) return;
  to.push({ pageId: p.id, content: contentOf(p) });
  Object.assign(p, JSON.parse(snapshot.content));
  pageIndex = Math.max(0, visiblePages(current).indexOf(p));
  selection = undefined;
  touch();
  render();
}

function touch(): void {
  const now = Date.now();
  const p = page();
  if (p) p.updatedAt = now;
  if (current) {
    current.updatedAt = now;
    void storage.put(current);
  }
  scheduleSync();
}

const textHeightOf = (p: Page) => (id: string) => {
  const t = p.texts?.find((x) => x.id === id);
  return t ? textHeight(ctx, t) : 0;
};

function matches(nb: Notebook): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystack = [
    nb.title,
    nb.folder ?? "",
    ...nb.pages.flatMap((p) => [...(p.texts ?? []).map((t) => t.text), ...(p.flow?.paragraphs ?? []).map((x) => x.text)]),
  ];
  return haystack.some((s) => s.toLowerCase().includes(q));
}

function renderLibrary(): void {
  const list = $("notebooks");
  const visible = notebooks.filter((nb) => !nb.deleted && matches(nb)).sort((a, b) => (a.folder ?? "").localeCompare(b.folder ?? "") || b.updatedAt - a.updatedAt);
  const items: HTMLElement[] = [];
  let folder: string | undefined;
  for (const nb of visible) {
    if ((nb.folder ?? "") !== folder) {
      folder = nb.folder ?? "";
      if (folder) {
        const header = document.createElement("li");
        header.className = "folder";
        header.textContent = `📁 ${folder}`;
        items.push(header);
      }
    }
    const li = document.createElement("li");
    li.textContent = nb.title;
    li.className = (nb === current ? "active" : "") + (nb.folder ? " nested" : "");
    li.onclick = () => open(nb);
    li.ondblclick = () => {
      const title = prompt("Notizbuch umbenennen", nb.title);
      if (title) {
        nb.title = title;
        nb.updatedAt = Date.now();
        void storage.put(nb).then(render);
        scheduleSync();
      }
    };
    items.push(li);
  }
  list.replaceChildren(...items);
}

function render(): void {
  renderLibrary();
  const pages = current ? visiblePages(current) : [];
  $("page-label").textContent = current ? `Seite ${pageIndex + 1} / ${pages.length}` : "";
  const p = page();
  const width = p?.width ?? PAGE_WIDTH;
  const height = p?.height ?? PAGE_HEIGHT;
  if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    canvas.style.aspectRatio = `${width} / ${height}`;
  }
  // Fit the page width to the stage (at most 702 CSS px), then apply zoom.
  const fit = Math.min(702, Math.max(240, $("stage").clientWidth - 32));
  canvas.style.width = `${Math.round(fit * zoom)}px`;
  if (!p) return ctx.clearRect(0, 0, canvas.width, canvas.height);
  loadImages(p);
  const bg = p.background;
  const key = bg && `${bg.attachment}:${bg.page}:${canvas.width}`;
  renderPage(ctx, p, key && background?.key === key ? background.bitmap : undefined, images);
  drawSelection(p);
  if (bg && key && background?.key !== key) {
    renderPdfPage(bg.attachment, () => storage.getAttachment(bg.attachment), bg.page, canvas.width).then(
      (bitmap) => {
        background = { key, bitmap };
        if (page() === p) render();
      },
      (error) => ($("status").textContent = `PDF: ${(error as Error).message}`),
    );
  }
}

function loadImages(p: Page): void {
  for (const image of p.images ?? []) {
    if (images.has(image.attachment)) continue;
    void storage.getAttachment(image.attachment).then(async (bytes) => {
      if (!bytes || images.has(image.attachment)) return;
      images.set(image.attachment, await createImageBitmap(new Blob([bytes.slice()])));
      if (page() === p) render();
    });
  }
}

function drawSelection(p: Page): void {
  ctx.save();
  ctx.setLineDash([12, 8]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#2a6fdb";
  if (lasso && lasso.length > 1) {
    ctx.beginPath();
    lasso.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
  }
  const box = selection && selectionBounds(p, selection, textHeightOf(p));
  if (box) {
    ctx.strokeRect(box.x - 8, box.y - 8, box.width + 16, box.height + 16);
    // Drag the corner handle to resize the selection.
    ctx.setLineDash([]);
    ctx.fillStyle = "#2a6fdb";
    ctx.fillRect(box.x + box.width - 2, box.y + box.height - 2, 20, 20);
  }
  ctx.restore();
}

function open(nb: Notebook): void {
  current = nb;
  pageIndex = 0;
  selection = undefined;
  undoStack = [];
  redoStack = [];
  render();
}

function pointFrom(event: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    p: event.pointerType === "mouse" || event.pressure === 0 ? 0.5 : event.pressure,
  };
}

function erase(at: Point): void {
  const p = page();
  if (!p) return;
  const keep = p.strokes.filter((stroke) => !hitsStroke(stroke, at, 14));
  if (keep.length !== p.strokes.length) {
    p.strokes = keep;
    touch();
    render();
  }
}

// Pointer gestures. One pointer owns a gesture at a time; two fingers pinch to zoom.
let active: { id: number; type: string } | undefined;
const touches = new Map<number, { x: number; y: number }>();
let pinch: { distance: number; zoom: number; mid: { x: number; y: number } } | undefined;
let panFrom: { x: number; y: number } | undefined;
let resizeFrom: { origin: { x: number; y: number }; distance: number } | undefined;
const PEN_KEY = "inknotes.penSeen";
// Once a stylus has written, one finger scrolls instead of drawing.
let penSeen = (() => {
  try {
    return localStorage.getItem(PEN_KEY) === "1";
  } catch {
    return false;
  }
})();

const client = (event: PointerEvent) => ({ x: event.clientX, y: event.clientY });
const HANDLE = 28;
const nearHandle = (box: { x: number; y: number; width: number; height: number }, at: Point) =>
  Math.abs(at.x - (box.x + box.width + 8)) <= HANDLE && Math.abs(at.y - (box.y + box.height + 8)) <= HANDLE;

/** Ends the current gesture without committing an unfinished stroke or lasso. */
function cancelGesture(): void {
  if (active && canvas.hasPointerCapture(active.id)) canvas.releasePointerCapture(active.id);
  if (dragFrom || resizeFrom) touch();
  active = drawing = lasso = dragFrom = resizeFrom = panFrom = undefined;
  render();
}

function startPinch(): void {
  const [a, b] = [...touches.values()];
  pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

function updatePinch(): void {
  if (!pinch || touches.size < 2) return;
  const [a, b] = [...touches.values()];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Keep the page point under the previous finger midpoint under the new one.
  const before = canvas.getBoundingClientRect();
  const fx = (pinch.mid.x - before.left) / before.width;
  const fy = (pinch.mid.y - before.top) / before.height;
  setZoom(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance));
  const after = canvas.getBoundingClientRect();
  const stage = $("stage");
  stage.scrollLeft += after.left + fx * after.width - mid.x;
  stage.scrollTop += after.top + fy * after.height - mid.y;
  pinch.mid = mid;
}

canvas.addEventListener("pointerdown", (event) => {
  const p = page();
  if (!p) return;
  if (event.pointerType === "pen") {
    if (!penSeen) {
      penSeen = true;
      try {
        localStorage.setItem(PEN_KEY, "1");
      } catch {
        // Only a convenience; without storage the next start draws with fingers again.
      }
    }
    // The palm often lands before the pen; the pen takes over.
    if (active?.type === "touch") cancelGesture();
  }
  if (event.pointerType === "touch") {
    touches.set(event.pointerId, client(event));
    // Palm rejection: while the pen writes, touches are ignored.
    if (active?.type === "pen") return;
    if (touches.size === 2) {
      cancelGesture();
      return startPinch();
    }
    if (touches.size > 2 || pinch) return;
  }
  if (active) return;
  if (tool === "text") return addText(pointFrom(event));
  active = { id: event.pointerId, type: event.pointerType };
  canvas.setPointerCapture(event.pointerId);
  if (event.pointerType === "touch" && penSeen) {
    panFrom = client(event);
    return;
  }
  const at = pointFrom(event);
  if (tool === "eraser") {
    checkpoint();
    return erase(at);
  }
  if (tool === "lasso") {
    const box = selection && selectionBounds(p, selection, textHeightOf(p));
    if (box && nearHandle(box, at)) {
      checkpoint();
      resizeFrom = { origin: { x: box.x, y: box.y }, distance: Math.hypot(at.x - box.x, at.y - box.y) };
    } else if (box && at.x >= box.x - 8 && at.x <= box.x + box.width + 8 && at.y >= box.y - 8 && at.y <= box.y + box.height + 8) {
      checkpoint();
      dragFrom = at;
    } else {
      selection = undefined;
      lasso = [at];
    }
    return;
  }
  selection = undefined;
  drawing = {
    id: crypto.randomUUID(),
    tool: tool === "highlighter" ? "highlighter" : "pen",
    color: $<HTMLInputElement>("color").value,
    width: Number($<HTMLInputElement>("width").value),
    points: [at],
  };
});

function addText(at: Point): void {
  const p = page();
  const text = prompt("Text");
  if (!p || !text) return;
  checkpoint();
  const width = (p.width ?? PAGE_WIDTH) - at.x - 40;
  (p.texts ??= []).push({
    id: crypto.randomUUID(),
    x: at.x,
    y: at.y,
    width: Math.max(200, width),
    text,
    fontSize: 12 * Number($<HTMLInputElement>("width").value) + 16,
    color: $<HTMLInputElement>("color").value,
  });
  touch();
  render();
}

canvas.addEventListener("pointermove", (event) => {
  if (touches.has(event.pointerId)) touches.set(event.pointerId, client(event));
  if (pinch) return updatePinch();
  if (event.pointerId !== active?.id) return;
  if (panFrom) {
    const now = client(event);
    $("stage").scrollBy(panFrom.x - now.x, panFrom.y - now.y);
    panFrom = now;
    return;
  }
  const events = event.getCoalescedEvents?.() ?? [event];
  const p = page();
  if (tool === "eraser") return events.forEach((e) => erase(pointFrom(e)));
  if (lasso) {
    lasso.push(...events.map(pointFrom));
    return render();
  }
  if (resizeFrom && selection && p) {
    const at = pointFrom(event);
    const distance = Math.hypot(at.x - resizeFrom.origin.x, at.y - resizeFrom.origin.y);
    if (distance < 10 || resizeFrom.distance < 1) return;
    scaleSelection(p, selection, resizeFrom.origin, distance / resizeFrom.distance);
    resizeFrom.distance = distance;
    return render();
  }
  if (dragFrom && selection && p) {
    const at = pointFrom(event);
    moveSelection(p, selection, at.x - dragFrom.x, at.y - dragFrom.y);
    dragFrom = at;
    return render();
  }
  if (!drawing) return;
  for (const e of events) drawing.points.push(pointFrom(e));
  render();
  drawStroke(ctx, drawing);
});

const finish = (event: PointerEvent) => {
  touches.delete(event.pointerId);
  if (pinch && touches.size < 2) pinch = undefined;
  if (event.pointerId !== active?.id) return;
  active = undefined;
  if (panFrom) {
    panFrom = undefined;
    return;
  }
  const p = page();
  // Busy frames can deliver few move events; the release point completes the stroke.
  if (drawing && event.type === "pointerup") {
    const end = pointFrom(event);
    const last = drawing.points[drawing.points.length - 1];
    if (end.x !== last.x || end.y !== last.y) drawing.points.push({ ...end, p: last.p });
  }
  if (lasso && p) {
    selection = lasso.length > 2 ? lassoSelect(p, lasso, textHeightOf(p)) : undefined;
    if (selection && isEmpty(selection)) selection = undefined;
    lasso = undefined;
  } else if (dragFrom || resizeFrom) {
    dragFrom = resizeFrom = undefined;
    touch();
  } else if (drawing && p) {
    if (tool === "shape") drawing.points = recognizeShape(drawing.points) ?? drawing.points;
    checkpoint();
    p.strokes.push(drawing);
    touch();
  }
  drawing = undefined;
  render();
};
canvas.addEventListener("pointerup", finish);
canvas.addEventListener("pointercancel", finish);

document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
  button.onclick = () => {
    tool = button.dataset.tool as Tool;
    if (tool !== "lasso") selection = undefined;
    document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b === button));
    render();
  };
});

function deleteSelected(): void {
  const p = page();
  if (!p || !selection) return;
  checkpoint();
  deleteSelection(p, selection);
  selection = undefined;
  touch();
  render();
}

$("undo").onclick = () => restore(undoStack, redoStack);
$("redo").onclick = () => restore(redoStack, undoStack);
$("delete-selection").onclick = deleteSelected;
document.addEventListener("keydown", (event) => {
  if ((event.target as HTMLElement).closest("input, textarea, dialog")) return;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault();
    restore(event.shiftKey ? redoStack : undoStack, event.shiftKey ? undoStack : redoStack);
  } else if (mod && event.key.toLowerCase() === "y") {
    event.preventDefault();
    restore(redoStack, undoStack);
  } else if (event.key === "Delete" || event.key === "Backspace") {
    deleteSelected();
  }
});

$("new-notebook").onclick = async () => {
  const title = prompt("Name des Notizbuchs", "Neues Notizbuch");
  if (!title) return;
  const nb = newNotebook(title);
  nb.folder = current?.folder;
  notebooks.push(nb);
  await storage.put(nb);
  scheduleSync();
  open(nb);
};

$("folder").onclick = () => {
  if (!current) return;
  const folder = prompt("Ordner für dieses Notizbuch (z. B. Uni/Physik, leer für keinen)", current.folder ?? "");
  if (folder === null) return;
  current.folder = folder.trim() || undefined;
  current.updatedAt = Date.now();
  void storage.put(current).then(render);
  scheduleSync();
};

$<HTMLInputElement>("search").oninput = (event) => {
  query = (event.target as HTMLInputElement).value.trim();
  renderLibrary();
};

$("add-page").onclick = () => {
  if (!current) return;
  const template = $<HTMLSelectElement>("template").value as Template;
  const all = current.pages;
  const at = all.indexOf(page()!) + 1;
  all.splice(at, 0, newPage(template));
  pageIndex += 1;
  touch();
  render();
};

$("delete-page").onclick = () => {
  const p = page();
  if (!current || !p || !confirm("Diese Seite löschen?")) return;
  p.deleted = true;
  p.strokes = [];
  touch();
  pageIndex = Math.max(0, Math.min(pageIndex, visiblePages(current).length - 1));
  render();
};

$("template").onchange = () => {
  const p = page();
  if (!p) return;
  p.template = $<HTMLSelectElement>("template").value as Template;
  touch();
  render();
};

$("prev").onclick = () => {
  pageIndex = Math.max(0, pageIndex - 1);
  selection = undefined;
  render();
};
$("next").onclick = () => {
  if (current) pageIndex = Math.min(visiblePages(current).length - 1, pageIndex + 1);
  selection = undefined;
  render();
};

const setZoom = (value: number) => {
  zoom = Math.min(4, Math.max(0.4, value));
  $("zoom-label").textContent = `${Math.round(zoom * 100)} %`;
  render();
};
$("zoom-in").onclick = () => setZoom(zoom * 1.25);
$("zoom-out").onclick = () => setZoom(zoom / 1.25);
$("stage").addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  },
  { passive: false },
);

$("insert-image").onclick = () => $<HTMLInputElement>("image-file").click();
$<HTMLInputElement>("image-file").onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const p = page();
  if (!file || !p) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const attachment = crypto.randomUUID();
  await storage.putAttachment(attachment, bytes);
  images.set(attachment, bitmap);
  const scale = Math.min(1, (canvas.width * 0.6) / bitmap.width);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  checkpoint();
  (p.images ??= []).push({ id: crypto.randomUUID(), x: (canvas.width - width) / 2, y: (canvas.height - height) / 3, width, height, attachment });
  touch();
  render();
};

$("export").onclick = async () => {
  if (!current) return;
  const off = document.createElement("canvas");
  const octx = off.getContext("2d")!;
  const shots: HTMLImageElement[] = [];
  for (const p of visiblePages(current)) {
    off.width = Math.round(p.width ?? PAGE_WIDTH);
    off.height = Math.round(p.height ?? PAGE_HEIGHT);
    const bg = p.background;
    const bitmap = bg ? await renderPdfPage(bg.attachment, () => storage.getAttachment(bg.attachment), bg.page, off.width) : undefined;
    for (const id of pageAttachments(p)) {
      if (images.has(id) || id === bg?.attachment) continue;
      const bytes = await storage.getAttachment(id);
      if (bytes) images.set(id, await createImageBitmap(new Blob([bytes.slice()])));
    }
    renderPage(octx, p, bitmap, images);
    const img = new Image();
    img.src = off.toDataURL("image/png");
    shots.push(img);
  }
  $("print").replaceChildren(...shots);
  // The system print dialog offers "Save as PDF" on every target platform.
  setTimeout(() => window.print(), 100);
};

$("import").onclick = () => $<HTMLInputElement>("import-file").click();
// iOS greys out files whose extension it has no type for, and .goodnotes is
// only known when Goodnotes is installed. The importer validates the file instead.
if (/iPhone|iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) {
  $<HTMLInputElement>("import-file").removeAttribute("accept");
}
$<HTMLInputElement>("import-file").onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const status = $("status");
  for (const file of Array.from(input.files ?? [])) {
    try {
      const { notebook, attachments, report } = importGoodnotes(new Uint8Array(await file.arrayBuffer()), {
        fallbackTitle: file.name.replace(/\.goodnotes$/i, ""),
      });
      await Promise.all([...attachments].map(([id, bytes]) => storage.putAttachment(id, bytes)));
      notebook.folder = current?.folder;
      notebooks.push(notebook);
      await storage.put(notebook);
      scheduleSync();
      open(notebook);
      status.textContent = `Importiert: ${notebook.title} (${report.pages} Seiten, ${report.strokes} Striche, ${report.texts} Texte)`;
      if (report.warnings.length) console.warn(report.warnings);
    } catch (error) {
      status.textContent = `Import fehlgeschlagen: ${(error as Error).message}`;
    }
  }
  input.value = "";
};

const ACCOUNT_KEY = "inknotes.nextcloud";
function loadAccount(): NextcloudAccount | undefined {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as NextcloudAccount) : undefined;
  } catch {
    return undefined;
  }
}

const dialog = $<HTMLDialogElement>("account");
$("settings").onclick = () => {
  const form = dialog.querySelector("form")!;
  const account = loadAccount();
  if (account) for (const [key, value] of Object.entries(account)) (form.elements.namedItem(key) as HTMLInputElement).value = value;
  dialog.showModal();
};
dialog.addEventListener("close", () => {
  if (dialog.returnValue !== "save") return;
  const data = Object.fromEntries(new FormData(dialog.querySelector("form")!)) as unknown as NextcloudAccount;
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(data));
});

// Sync runs on a copy; edits made meanwhile merge back in and trigger another sync.
let syncing = false;
let changedDuringSync = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
const AUTO_SYNC_DELAY = 20_000;

/** Called after every local change: syncs once editing has paused. */
function scheduleSync(): void {
  if (syncing) changedDuringSync = true;
  if (!loadAccount()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void sync(), AUTO_SYNC_DELAY);
}

async function sync(): Promise<void> {
  const account = loadAccount();
  if (!account || syncing) return;
  clearTimeout(syncTimer);
  syncing = true;
  changedDuringSync = false;
  const status = $("status");
  status.textContent = "Synchronisiere …";
  try {
    const synced = await syncNotebooks(structuredClone(notebooks), new WebDav(account), {
      get: (id) => storage.getAttachment(id),
      put: (id, bytes) => storage.putAttachment(id, bytes),
    });
    notebooks = mergeBack(notebooks, synced);
    await Promise.all(notebooks.map((nb) => storage.put(nb)));
    current = notebooks.find((nb) => nb.id === current?.id) ?? current;
    status.textContent = `Synchronisiert: ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    status.textContent = `Sync-Fehler: ${(error as Error).message}`;
  } finally {
    syncing = false;
  }
  if (changedDuringSync) scheduleSync();
  // Keep an in-progress stroke or lasso on screen; the next render shows synced content.
  if (!active) render();
}

$("sync").onclick = () => (loadAccount() ? void sync() : $("settings").click());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && syncTimer !== undefined) void sync();
});
window.addEventListener("online", () => void sync());

// Installed web app only; the Electron and Capacitor shells ship their files.
if ("serviceWorker" in navigator && location.protocol === "https:" && !("Capacitor" in window)) {
  void navigator.serviceWorker.register("./sw.js");
}

window.addEventListener("resize", () => render());

void (async () => {
  notebooks = await storage.all();
  if (notebooks.length === 0) {
    const nb = newNotebook("Mein erstes Notizbuch");
    notebooks.push(nb);
    await storage.put(nb);
  }
  open(notebooks[0]);
  void sync();
})();
