import { importGoodnotes } from "./goodnotes/import";
import { drawStroke, hitsStroke, renderPage } from "./ink";
import {
  newNotebook,
  newPage,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  visiblePages,
  type Notebook,
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

const page = () => (current ? visiblePages(current)[pageIndex] : undefined);

function touch(): void {
  const now = Date.now();
  const p = page();
  if (p) p.updatedAt = now;
  if (current) {
    current.updatedAt = now;
    void storage.put(current);
  }
}

function render(): void {
  const list = $("notebooks");
  list.replaceChildren(
    ...notebooks
      .filter((nb) => !nb.deleted)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((nb) => {
        const li = document.createElement("li");
        li.textContent = nb.title;
        li.className = nb === current ? "active" : "";
        li.onclick = () => open(nb);
        li.ondblclick = () => {
          const title = prompt("Notizbuch umbenennen", nb.title);
          if (title) {
            nb.title = title;
            nb.updatedAt = Date.now();
            void storage.put(nb).then(render);
          }
        };
        return li;
      }),
  );
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
  if (!p) return ctx.clearRect(0, 0, canvas.width, canvas.height);
  const bg = p.background;
  const key = bg && `${bg.attachment}:${bg.page}:${canvas.width}`;
  renderPage(ctx, p, key && background?.key === key ? background.bitmap : undefined);
  if (bg && key && background?.key !== key) {
    renderPdfPage(bg.attachment, () => storage.getAttachment(bg.attachment), bg.page, canvas.width).then(
      (bitmap) => {
        background = { key, bitmap };
        if (page() === p) renderPage(ctx, p, bitmap);
      },
      (error) => ($("status").textContent = `PDF: ${(error as Error).message}`),
    );
  }
}

function open(nb: Notebook): void {
  current = nb;
  pageIndex = 0;
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
  const before = p.strokes.length;
  p.strokes = p.strokes.filter((stroke) => !hitsStroke(stroke, at, 14));
  if (p.strokes.length !== before) {
    touch();
    render();
  }
}

canvas.addEventListener("pointerdown", (event) => {
  // Palm rejection: while a pen is in use, ignore touch input.
  if (!page() || (event.pointerType === "touch" && drawing)) return;
  canvas.setPointerCapture(event.pointerId);
  const at = pointFrom(event);
  if (tool === "eraser") return erase(at);
  if (tool === "text") return addText(at);
  drawing = {
    id: crypto.randomUUID(),
    tool,
    color: $<HTMLInputElement>("color").value,
    width: Number($<HTMLInputElement>("width").value),
    points: [at],
  };
});

function addText(at: Point): void {
  const p = page();
  const text = prompt("Text");
  if (!p || !text) return;
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
  if (tool === "eraser") return events.forEach((e) => erase(pointFrom(e)));
  if (!drawing) return;
  for (const e of events) drawing.points.push(pointFrom(e));
  render();
  drawStroke(ctx, drawing);
});

const finish = () => {
  const p = page();
  if (drawing && p) {
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
    document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b === button));
  };
});

$("undo").onclick = () => {
  const p = page();
  if (p?.strokes.pop()) {
    touch();
    render();
  }
};

$("new-notebook").onclick = async () => {
  const title = prompt("Name des Notizbuchs", "Neues Notizbuch");
  if (!title) return;
  const nb = newNotebook(title);
  notebooks.push(nb);
  await storage.put(nb);
  open(nb);
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
  render();
};
$("next").onclick = () => {
  if (current) pageIndex = Math.min(visiblePages(current).length - 1, pageIndex + 1);
  render();
};

$("export").onclick = () => {
  if (!current) return;
  const off = document.createElement("canvas");
  const octx = off.getContext("2d")!;
  const images = visiblePages(current).map((p) => {
    off.width = Math.round(p.width ?? PAGE_WIDTH);
    off.height = Math.round(p.height ?? PAGE_HEIGHT);
    renderPage(octx, p);
    const img = new Image();
    img.src = off.toDataURL("image/png");
    return img;
  });
  $("print").replaceChildren(...images);
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

void (async () => {
  notebooks = await storage.all();
  if (notebooks.length === 0) {
    const nb = newNotebook("Mein erstes Notizbuch");
    notebooks.push(nb);
    await storage.put(nb);
  }
  open(notebooks[0]);
})();
