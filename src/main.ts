import { deleteSelection, isEmpty, lassoSelect, moveSelection, recognizeShape, selectionBounds, type Selection } from "./edit";
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
import { syncNotebooks } from "./sync";
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
  if (box) ctx.strokeRect(box.x - 8, box.y - 8, box.width + 16, box.height + 16);
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

canvas.addEventListener("pointerdown", (event) => {
  const p = page();
  // Palm rejection: while a pen is in use, ignore touch input.
  if (!p || (event.pointerType === "touch" && drawing)) return;
  canvas.setPointerCapture(event.pointerId);
  const at = pointFrom(event);
  if (tool === "eraser") {
    checkpoint();
    return erase(at);
  }
  if (tool === "text") return addText(at);
  if (tool === "lasso") {
    const box = selection && selectionBounds(p, selection, textHeightOf(p));
    if (box && at.x >= box.x - 8 && at.x <= box.x + box.width + 8 && at.y >= box.y - 8 && at.y <= box.y + box.height + 8) {
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
  if (!canvas.hasPointerCapture(event.pointerId)) return;
  const events = event.getCoalescedEvents?.() ?? [event];
  const p = page();
  if (tool === "eraser") return events.forEach((e) => erase(pointFrom(e)));
  if (lasso) {
    lasso.push(...events.map(pointFrom));
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

const finish = () => {
  const p = page();
  if (lasso && p) {
    selection = lasso.length > 2 ? lassoSelect(p, lasso, textHeightOf(p)) : undefined;
    if (selection && isEmpty(selection)) selection = undefined;
    lasso = undefined;
  } else if (dragFrom) {
    dragFrom = undefined;
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
  open(nb);
};

$("folder").onclick = () => {
  if (!current) return;
  const folder = prompt("Ordner für dieses Notizbuch (z. B. Uni/Physik, leer für keinen)", current.folder ?? "");
  if (folder === null) return;
  current.folder = folder.trim() || undefined;
  current.updatedAt = Date.now();
  void storage.put(current).then(render);
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

$("sync").onclick = async () => {
  const account = loadAccount();
  const status = $("status");
  if (!account) return $("settings").click();
  status.textContent = "Synchronisiere …";
  try {
    notebooks = await syncNotebooks(notebooks, new WebDav(account), {
      get: (id) => storage.getAttachment(id),
      put: (id, bytes) => storage.putAttachment(id, bytes),
    });
    await Promise.all(notebooks.map((nb) => storage.put(nb)));
    current = notebooks.find((nb) => nb.id === current?.id) ?? current;
    status.textContent = `Synchronisiert: ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    status.textContent = `Fehler: ${(error as Error).message}`;
  }
  render();
};

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
})();
