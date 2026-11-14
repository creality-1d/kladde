import { expandImport, joinFolder, notebookFromPdf } from "./bundle";
import {
  copySelection,
  deleteSelection,
  eraseAt,
  isEmpty,
  lassoSelect,
  moveSelection,
  pasteClip,
  recognizeShape,
  recolorSelection,
  rotateSelection,
  scaleSelection,
  selectionBounds,
  type Box,
  type Clip,
  type Selection,
} from "./edit";
import { importGoodnotes } from "./goodnotes/import";
import { icons, type IconName } from "./icons";
import { drawPenSegments, drawStroke, renderPage, textHeight } from "./ink";
import { newId, newNotebook, PAGE_HEIGHT, PAGE_WIDTH, pageAttachments, visiblePages, type Notebook, type Page, type Point, type Stroke, type Template, type TextBox, type Tool } from "./model";
import { duplicatePage, insertPage, insertPageAt, movePage, pageLike } from "./pages";
import { pdfPageSizes, renderPdfPage } from "./pdf";
import { writePdf } from "./pdfwrite";
import { loadSettings, saveSettings, type PresetTool } from "./settings";
import { storage } from "./storage";
import { mergeBack, syncNotebooks } from "./sync";
import { WebDav, type NextcloudAccount } from "./webdav";

// ---------------------------------------------------------------------------
// DOM helpers

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "html") node.innerHTML = String(value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children);
  return node;
}

const icon = (name: IconName) => h("span", { html: icons[name], class: "i" });
function iconButton(name: IconName, title: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
  const button = h("button", { class: "icon", title, html: icons[name] });
  button.onclick = (event) => {
    event.stopPropagation();
    onClick(event);
  };
  return button;
}
document.querySelectorAll<HTMLElement>("[data-icon]").forEach((node) => node.insertAdjacentHTML("afterbegin", icons[node.dataset.icon as IconName]));

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string, ms = 2600): void {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), ms);
}
function status(message: string): void {
  $("status").textContent = message;
}

interface MenuItem {
  label?: string;
  action?: () => void;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** Custom content instead of a button. */
  node?: HTMLElement;
}
let openMenu: HTMLElement | undefined;
function closeMenu(): void {
  openMenu?.remove();
  openMenu = undefined;
}
function showMenu(anchor: HTMLElement | { x: number; y: number }, items: MenuItem[]): void {
  closeMenu();
  const menu = h("div", { class: "menu", role: "menu" });
  for (const item of items) {
    if (item.separator) menu.append(h("hr"));
    else if (item.node) menu.append(item.node);
    else {
      const button = h("button", { class: item.danger ? "danger" : undefined, disabled: item.disabled }, item.label ?? "");
      if (item.checked) button.append(h("span", { class: "check" }, "✓"));
      button.onclick = () => {
        closeMenu();
        item.action?.();
      };
      menu.append(button);
    }
  }
  document.body.append(menu);
  const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, r.left))}px`;
  menu.style.top = `${r.bottom + height + 8 > innerHeight ? Math.max(8, r.top - height - 4) : r.bottom + 4}px`;
  openMenu = menu;
}
document.addEventListener(
  "pointerdown",
  (event) => {
    if (openMenu && !openMenu.contains(event.target as Node)) closeMenu();
  },
  true,
);

// ---------------------------------------------------------------------------
// State

const settings = loadSettings();
const saveSettingsNow = () => saveSettings(settings);
let notebooks: Notebook[] = [];
let current: Notebook | undefined;
let pageIndex = 0;
let tool: Tool = "pen";
let previousTool: Tool = "eraser";
let zoom = 1;
let query = "";
let libSection: "all" | "recent" | "favorites" = "all";
let libFolder = "";
let sidebarPane: "pages" | "bookmarks" | "outline" = "pages";
/** The lasso selection and the page it belongs to. */
let selected: { page: Page; selection: Selection } | undefined;
let clip: Clip | undefined;
const images = new Map<string, ImageBitmap>();
/** Resolved PDF backgrounds by key, so redraws while writing stay synchronous. */
const pdfBitmaps = new Map<string, HTMLCanvasElement>();
const isIOS = /iPhone|iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
const scratch = document.createElement("canvas").getContext("2d")!;

const pageW = (p: Page) => p.width ?? PAGE_WIDTH;
const pageH = (p: Page) => p.height ?? PAGE_HEIGHT;
const page = () => (current ? visiblePages(current)[pageIndex] : undefined);
const textHeightOf = (p: Page) => (id: string) => {
  const t = p.texts?.find((x) => x.id === id);
  return t ? textHeight(scratch, t) : 0;
};

// ---------------------------------------------------------------------------
// History: snapshots of one page's content, per notebook session.

type Snapshot = { pageId: string; content: string };
let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];
const contentOf = (p: Page) => JSON.stringify({ strokes: p.strokes, texts: p.texts, images: p.images });
const snapshotOf = (p: Page): Snapshot => ({ pageId: p.id, content: contentOf(p) });

function pushUndo(snapshot: Snapshot): void {
  undoStack.push(snapshot);
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}
/** Call before changing a page so the change can be undone. */
const checkpoint = (p: Page) => pushUndo(snapshotOf(p));

function restore(from: Snapshot[], to: Snapshot[]): void {
  const snapshot = from.pop();
  const p = current?.pages.find((x) => x.id === snapshot?.pageId);
  if (!snapshot || !p || !current) return updateUndoButtons();
  to.push(snapshotOf(p));
  Object.assign(p, { texts: undefined, images: undefined }, JSON.parse(snapshot.content));
  selected = undefined;
  changed(p);
  const index = visiblePages(current).indexOf(p);
  if (index >= 0 && !sheetVisible(index)) scrollToPage(index);
  updateUndoButtons();
}
const undo = () => restore(undoStack, redoStack);
const redo = () => restore(redoStack, undoStack);
function updateUndoButtons(): void {
  $<HTMLButtonElement>("undo").disabled = undoStack.length === 0;
  $<HTMLButtonElement>("redo").disabled = redoStack.length === 0;
}

/** Marks a page (or just the notebook) as changed: saves, schedules sync and redraws. */
function changed(p?: Page, redraw = true): void {
  const now = Date.now();
  if (p) p.updatedAt = now;
  if (current) {
    current.updatedAt = now;
    void storage.put(current);
  }
  scheduleSync();
  if (redraw && p) renderSheetOf(p);
  if (p) thumbs.delete(p.id);
  // Refresh the page thumbnails once writing pauses.
  clearTimeout(sidebarTimer);
  if (!$("sidebar").hidden) sidebarTimer = setTimeout(() => !gesture && renderSidebar(), 900);
}
let sidebarTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------------------
// Thumbnails for the library and the page sidebar

const thumbs = new Map<string, { updatedAt: number; url: string }>();
let thumbQueue = Promise.resolve();

/** Renders a small picture of a page; cached until the page changes. */
function thumbnail(p: Page, width: number): Promise<string> {
  const cached = thumbs.get(p.id);
  if (cached && cached.updatedAt === p.updatedAt) return Promise.resolve(cached.url);
  const job = thumbQueue.then(async () => {
    const again = thumbs.get(p.id);
    if (again && again.updatedAt === p.updatedAt) return again.url;
    const scale = width / pageW(p);
    const c = document.createElement("canvas");
    c.width = Math.round(width);
    c.height = Math.round(pageH(p) * scale);
    const tctx = c.getContext("2d")!;
    tctx.scale(scale, scale);
    const bg = p.background;
    let bitmap: HTMLCanvasElement | undefined;
    if (bg) bitmap = await renderPdfPage(bg.attachment, () => storage.getAttachment(bg.attachment), bg.page, Math.round(width * 2)).catch(() => undefined);
    await loadImagesOf(p);
    renderPage(tctx, p, bitmap, images);
    const url = c.toDataURL("image/jpeg", 0.8);
    thumbs.set(p.id, { updatedAt: p.updatedAt, url });
    return url;
  });
  thumbQueue = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

async function loadImagesOf(p: Page): Promise<void> {
  for (const image of p.images ?? []) {
    if (images.has(image.attachment)) continue;
    const bytes = await storage.getAttachment(image.attachment);
    if (bytes && !images.has(image.attachment)) images.set(image.attachment, await createImageBitmap(new Blob([bytes.slice()])));
  }
}

// ---------------------------------------------------------------------------
// Library

function folderOf(nb: Notebook): string {
  return nb.folder ?? "";
}
function matches(nb: Notebook): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystack = [
    nb.title,
    nb.folder ?? "",
    ...nb.pages.flatMap((p) => [p.title ?? "", ...(p.texts ?? []).map((t) => t.text), ...(p.flow?.paragraphs ?? []).map((x) => x.text)]),
  ];
  return haystack.some((s) => s.toLowerCase().includes(q));
}
const liveNotebooks = () => notebooks.filter((nb) => !nb.deleted);
const formatDate = (ms: number) => new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Direct subfolders of `parent`, from notebook paths and empty folders. */
function subfolders(parent: string): string[] {
  const names = new Set<string>();
  const paths = [...liveNotebooks().map(folderOf), ...settings.folders];
  for (const path of paths) {
    if (!path || (parent && !path.startsWith(parent + "/")) || path === parent) continue;
    const rest = parent ? path.slice(parent.length + 1) : path;
    names.add(rest.split("/")[0]);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "de"));
}

function renderLibrary(): void {
  const crumbs = $("crumbs");
  const parts = libFolder ? libFolder.split("/") : [];
  const rootName = libSection === "recent" ? "Zuletzt" : libSection === "favorites" ? "Favoriten" : "Dokumente";
  const crumb = (label: string, folder: string) => {
    const b = h("button", {}, label);
    b.onclick = () => {
      libFolder = folder;
      renderLibrary();
    };
    return b;
  };
  crumbs.replaceChildren(crumb(rootName, ""));
  if (libSection === "all") parts.forEach((part, i) => crumbs.append(h("span", { class: "sep" }, "›"), crumb(part, parts.slice(0, i + 1).join("/"))));
  document.querySelectorAll<HTMLButtonElement>("#lib-nav [data-section]").forEach((b) => b.classList.toggle("active", b.dataset.section === libSection));

  let books = liveNotebooks().filter(matches);
  const tiles: HTMLElement[] = [];
  if (libSection === "all" && !query) {
    for (const name of subfolders(libFolder)) tiles.push(folderTile(joinFolder(libFolder, name)!, name));
    books = books.filter((nb) => folderOf(nb) === libFolder).sort((a, b) => a.title.localeCompare(b.title, "de"));
  } else if (libSection === "recent") {
    books = books.filter((nb) => settings.opened[nb.id]).sort((a, b) => settings.opened[b.id] - settings.opened[a.id]).slice(0, 40);
  } else if (libSection === "favorites") {
    books = books.filter((nb) => nb.favorite).sort((a, b) => a.title.localeCompare(b.title, "de"));
  } else {
    books.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  for (const nb of books) tiles.push(notebookTile(nb));
  $("grid").replaceChildren(...tiles);
  const empty = $("grid-empty");
  empty.hidden = tiles.length > 0;
  empty.textContent = query
    ? "Nichts gefunden."
    : libSection === "favorites"
      ? "Noch keine Favoriten. Tippe beim Notizbuch auf ⋯ → Favorit."
      : libSection === "recent"
        ? "Noch nichts geöffnet."
        : "Dieser Ordner ist leer. Über „Neu“ ein Notizbuch anlegen oder Goodnotes-Dateien importieren.";
}

function folderTile(path: string, name: string): HTMLElement {
  const count = liveNotebooks().filter((nb) => folderOf(nb) === path || folderOf(nb).startsWith(path + "/")).length;
  const more = iconButton("more", "Ordneroptionen", (event) =>
    showMenu(event.currentTarget as HTMLElement, [
      { label: "Umbenennen", action: () => renameFolder(path) },
      { label: "Ordner auflösen (Inhalt eine Ebene hoch)", action: () => dissolveFolder(path), danger: true },
    ]),
  );
  const tile = h("div", { class: "tile folder" }, h("div", { class: "cover", html: icons.folder }), h("div", { class: "name" }, h("span", {}, name), more), h("div", { class: "meta" }, `${count} Notizbücher`));
  tile.onclick = () => {
    libFolder = path;
    renderLibrary();
  };
  tile.oncontextmenu = (event) => {
    event.preventDefault();
    more.click();
  };
  // Drop notebooks dragged from the grid into the folder.
  tile.ondragover = (event) => {
    event.preventDefault();
    tile.classList.add("drop");
  };
  tile.ondragleave = () => tile.classList.remove("drop");
  tile.ondrop = (event) => {
    event.preventDefault();
    tile.classList.remove("drop");
    const nb = notebooks.find((x) => x.id === event.dataTransfer?.getData("text/kladde-notebook"));
    if (nb) moveNotebook(nb, path);
  };
  return tile;
}

function notebookTile(nb: Notebook): HTMLElement {
  const first = visiblePages(nb)[0];
  const cover = h("div", { class: "cover" });
  if (first) void thumbnail(first, 300).then((url) => cover.replaceChildren(h("img", { src: url, alt: "" })));
  const more = iconButton("more", "Optionen", (event) => showMenu(event.currentTarget as HTMLElement, notebookMenu(nb)));
  const tile = h(
    "div",
    { class: "tile" + (first && pageW(first) > pageH(first) ? " landscape" : ""), draggable: "true" },
    cover,
    h("div", { class: "name" }, h("span", { title: nb.title }, nb.title), more),
    h("div", { class: "meta" }, formatDate(nb.updatedAt)),
  );
  if (nb.favorite) tile.append(h("span", { class: "fav", html: icons.starOn }));
  tile.onclick = () => openNotebook(nb);
  tile.oncontextmenu = (event) => {
    event.preventDefault();
    showMenu({ x: event.clientX, y: event.clientY }, notebookMenu(nb));
  };
  tile.ondragstart = (event) => event.dataTransfer?.setData("text/kladde-notebook", nb.id);
  return tile;
}

function notebookMenu(nb: Notebook): MenuItem[] {
  return [
    { label: "Öffnen", action: () => openNotebook(nb) },
    { label: nb.favorite ? "Aus Favoriten entfernen" : "Zu Favoriten", action: () => saveNotebook(nb, () => (nb.favorite = !nb.favorite || undefined)) },
    { label: "Umbenennen", action: () => renameNotebook(nb) },
    { label: "In Ordner verschieben …", action: () => moveNotebookPrompt(nb) },
    { label: "Duplizieren", action: () => duplicateNotebook(nb) },
    { separator: true },
    { label: "Löschen", danger: true, action: () => deleteNotebook(nb) },
  ];
}

function saveNotebook(nb: Notebook, change: () => void): void {
  change();
  nb.updatedAt = Date.now();
  void storage.put(nb);
  scheduleSync();
  renderLibrary();
  renderTabs();
}
function renameNotebook(nb: Notebook): void {
  const title = prompt("Notizbuch umbenennen", nb.title)?.trim();
  if (title) saveNotebook(nb, () => (nb.title = title));
}
function moveNotebook(nb: Notebook, folder: string): void {
  saveNotebook(nb, () => (nb.folder = folder || undefined));
  toast(`„${nb.title}“ → ${folder || "Dokumente"}`);
}
function moveNotebookPrompt(nb: Notebook): void {
  const folders = [...new Set([...liveNotebooks().map(folderOf), ...settings.folders].filter(Boolean))].sort();
  const items: MenuItem[] = [{ label: "Dokumente (oberste Ebene)", checked: !nb.folder, action: () => moveNotebook(nb, "") }];
  for (const f of folders) items.push({ label: f.replace(/\//g, " › "), checked: nb.folder === f, action: () => moveNotebook(nb, f) });
  items.push({ separator: true }, {
    label: "Neuer Ordner …",
    action: () => {
      const name = prompt("Ordnerpfad (z. B. Uni/Physik)", joinFolder(libFolder, "") ?? "")?.trim().replace(/^\/+|\/+$/g, "");
      if (name) moveNotebook(nb, name);
    },
  });
  showMenu({ x: innerWidth / 2 - 120, y: 120 }, items);
}
async function duplicateNotebook(nb: Notebook): Promise<void> {
  const copy: Notebook = { ...structuredClone(nb), id: newId(), title: `${nb.title} (Kopie)`, updatedAt: Date.now(), favorite: undefined };
  for (const p of copy.pages) p.id = newId();
  notebooks.push(copy);
  await storage.put(copy);
  scheduleSync();
  renderLibrary();
}
function deleteNotebook(nb: Notebook): void {
  if (!confirm(`„${nb.title}“ löschen?`)) return;
  saveNotebook(nb, () => (nb.deleted = true));
  closeTab(nb.id);
}
function renameFolder(path: string): void {
  const parent = path.split("/").slice(0, -1).join("/");
  const name = prompt("Ordner umbenennen", path.split("/").pop())?.trim().replace(/\//g, "-");
  if (!name) return;
  const target = joinFolder(parent, name)!;
  const rename = (f: string) => (f === path ? target : f.startsWith(path + "/") ? target + f.slice(path.length) : f);
  for (const nb of liveNotebooks()) if (nb.folder && rename(nb.folder) !== nb.folder) saveNotebook(nb, () => (nb.folder = rename(nb.folder!)));
  settings.folders = settings.folders.map(rename);
  saveSettingsNow();
  renderLibrary();
}
function dissolveFolder(path: string): void {
  const parent = path.split("/").slice(0, -1).join("/");
  for (const nb of liveNotebooks()) {
    const f = folderOf(nb);
    if (f === path || f.startsWith(path + "/")) saveNotebook(nb, () => (nb.folder = joinFolder(parent, f.slice(path.length + 1))));
  }
  settings.folders = settings.folders.filter((f) => f !== path && !f.startsWith(path + "/"));
  saveSettingsNow();
  renderLibrary();
}

document.querySelectorAll<HTMLButtonElement>("#lib-nav [data-section]").forEach((button) => {
  button.onclick = () => {
    libSection = button.dataset.section as typeof libSection;
    libFolder = "";
    renderLibrary();
  };
});
$<HTMLInputElement>("search").oninput = (event) => {
  query = (event.target as HTMLInputElement).value.trim();
  renderLibrary();
};
$("lib-new").onclick = (event) =>
  showMenu(event.currentTarget as HTMLElement, [
    { label: "Notizbuch", action: () => newNotebookDialog() },
    {
      label: "Ordner",
      action: () => {
        const name = prompt("Name des Ordners")?.trim().replace(/\//g, "-");
        if (!name) return;
        settings.folders.push(joinFolder(libFolder, name)!);
        saveSettingsNow();
        renderLibrary();
      },
    },
    { separator: true },
    { label: "Importieren: Goodnotes, PDF oder ZIP …", action: () => $("import-file").click() },
  ]);

function newNotebookDialog(): void {
  const dialog = $<HTMLDialogElement>("notebook-dialog");
  const form = dialog.querySelector("form")!;
  form.reset();
  dialog.showModal();
  dialog.onclose = async () => {
    if (dialog.returnValue !== "create") return;
    const data = new FormData(form);
    const nb = newNotebook(String(data.get("title")).trim() || "Neues Notizbuch");
    const first = nb.pages[0];
    first.template = data.get("template") as Template;
    if (data.get("format") === "landscape") Object.assign(first, { width: PAGE_HEIGHT, height: PAGE_WIDTH });
    nb.folder = libSection === "all" ? libFolder || undefined : undefined;
    notebooks.push(nb);
    await storage.put(nb);
    scheduleSync();
    openNotebook(nb);
  };
}

function showLibrary(): void {
  finishTextEdit();
  $("editor-view").hidden = true;
  $("library-view").hidden = false;
  renderLibrary();
}

// ---------------------------------------------------------------------------
// Tabs

function renderTabs(): void {
  const tabs = settings.tabs.map((id) => notebooks.find((nb) => nb.id === id && !nb.deleted)).filter((nb): nb is Notebook => !!nb);
  $("tabs").replaceChildren(
    ...tabs.map((nb) => {
      const close = iconButton("close", "Tab schließen", () => closeTab(nb.id));
      const tab = h("div", { class: "tab" + (nb === current ? " active" : ""), title: nb.title }, h("span", {}, nb.title), close);
      tab.onclick = () => nb !== current && openNotebook(nb);
      return tab;
    }),
  );
}
function closeTab(id: string): void {
  const index = settings.tabs.indexOf(id);
  if (index < 0) return;
  settings.tabs.splice(index, 1);
  saveSettingsNow();
  if (current?.id === id) {
    const next = notebooks.find((nb) => nb.id === settings.tabs[Math.min(index, settings.tabs.length - 1)]);
    if (next) openNotebook(next);
    else {
      current = undefined;
      showLibrary();
    }
  } else renderTabs();
}

// ---------------------------------------------------------------------------
// Editor: sheets (one per visible page), laid out vertically or horizontally

interface Sheet {
  page: Page;
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  live: boolean;
}
let sheets: Sheet[] = [];
const stage = $("stage");
const pagesEl = $("pages");
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const sheet = sheets.find((s) => s.el === entry.target);
      if (!sheet) continue;
      sheet.live = entry.isIntersecting;
      if (sheet.live) renderSheet(sheet);
      else {
        // Off-screen pages give their bitmap memory back.
        sheet.canvas.width = sheet.canvas.height = 1;
      }
    }
  },
  { root: stage, rootMargin: "120% 120%" },
);

function openNotebook(nb: Notebook): void {
  finishTextEdit();
  const switching = current !== nb;
  current = nb;
  if (switching) {
    pageIndex = 0;
    selected = undefined;
    undoStack = [];
    redoStack = [];
    zoom = 1;
  }
  settings.opened[nb.id] = Date.now();
  if (!settings.tabs.includes(nb.id)) settings.tabs.push(nb.id);
  saveSettingsNow();
  $("library-view").hidden = true;
  $("editor-view").hidden = false;
  buildSheets();
  renderTabs();
  renderContext();
  updateUndoButtons();
  if (switching) stage.scrollTo(0, 0);
}

/** Rebuilds the page elements, e.g. after pages were added, removed or reordered. */
function buildSheets(): void {
  observer.disconnect();
  const pages = current ? visiblePages(current) : [];
  sheets = pages.map((p) => {
    const canvas = h("canvas");
    const el = h("div", { class: "sheet" }, canvas) as HTMLDivElement;
    el.style.aspectRatio = `${pageW(p)} / ${pageH(p)}`;
    return { page: p, el, canvas, ctx: canvas.getContext("2d")!, live: false };
  });
  const add = h("button", { class: "add-sheet", title: "Seite hinzufügen" }, icon("plus"), "Seite hinzufügen");
  add.onclick = () => addPage(pages[pages.length - 1]);
  pagesEl.replaceChildren(...sheets.map((s) => s.el), add);
  pagesEl.classList.toggle("horizontal", settings.scroll === "horizontal");
  layoutSheets();
  for (const s of sheets) observer.observe(s.el);
  pageIndex = Math.min(pageIndex, Math.max(0, sheets.length - 1));
  updatePageUi();
}

/** Sizes every sheet for the stage and zoom; CSS only, so it is cheap during pinch. */
function layoutSheets(): void {
  const width = stage.clientWidth - 32;
  const height = stage.clientHeight - 56;
  for (const s of sheets) {
    const ratio = pageW(s.page) / pageH(s.page);
    // Vertical: fit the width (at most 1000 px). Horizontal: fit the whole page.
    const fit = settings.scroll === "horizontal" ? Math.min(width, height * ratio) : Math.min(1000, width);
    s.el.style.width = `${Math.max(120, Math.round(fit * zoom))}px`;
  }
  const add = pagesEl.lastElementChild as HTMLElement | null;
  const last = sheets[sheets.length - 1];
  if (add && last) {
    add.style.width = settings.scroll === "horizontal" ? "160px" : last.el.style.width;
    add.style.height = settings.scroll === "horizontal" ? last.el.getBoundingClientRect().height + "px" : "120px";
  }
}

function sheetVisible(index: number): boolean {
  const s = sheets[index];
  if (!s) return false;
  const a = s.el.getBoundingClientRect();
  const b = stage.getBoundingClientRect();
  return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
}

function scrollToPage(index: number, smooth = false): void {
  const s = sheets[index];
  if (!s) return;
  pageIndex = index;
  const behavior = smooth ? "smooth" : "auto";
  if (settings.scroll === "horizontal") stage.scrollTo({ left: s.el.offsetLeft - (stage.clientWidth - s.el.offsetWidth) / 2, behavior });
  else stage.scrollTo({ top: s.el.offsetTop - 12, behavior });
  updatePageUi();
}

/** The page with the largest visible area becomes the current page. */
function trackCurrentPage(): void {
  const b = stage.getBoundingClientRect();
  let best = pageIndex;
  let bestArea = -1;
  sheets.forEach((s, i) => {
    const a = s.el.getBoundingClientRect();
    const area = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    if (area > bestArea) [best, bestArea] = [i, area];
  });
  if (best !== pageIndex) {
    pageIndex = best;
    updatePageUi();
  }
}
let scrollFrame = 0;
stage.addEventListener("scroll", () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    trackCurrentPage();
  });
});

function updatePageUi(): void {
  const p = page();
  $("page-label").textContent = sheets.length ? `${pageIndex + 1} / ${sheets.length}` : "";
  const bookmark = $("bookmark");
  bookmark.innerHTML = p?.bookmark ? icons.bookmarkOn : icons.bookmark;
  bookmark.classList.toggle("active", !!p?.bookmark);
  if (!$("sidebar").hidden) renderSidebar();
}

const sheetOf = (p: Page) => sheets.find((s) => s.page === p);
function renderSheetOf(p: Page): void {
  const s = sheetOf(p);
  if (s) renderSheet(s);
}
function renderAllSheets(): void {
  for (const s of sheets) if (s.live) renderSheet(s);
}

let editingTextId: string | undefined;
function renderSheet(s: Sheet): void {
  if (!s.live) return;
  const p = s.page;
  const w = Math.round(pageW(p));
  const hgt = Math.round(pageH(p));
  if (s.canvas.width !== w || s.canvas.height !== hgt) {
    s.canvas.width = w;
    s.canvas.height = hgt;
  }
  const shown = editingTextId ? { ...p, texts: p.texts?.filter((t) => t.id !== editingTextId) } : p;
  const bg = p.background;
  const key = bg && `${bg.attachment}:${bg.page}:${w}`;
  renderPage(s.ctx, shown, key ? pdfBitmaps.get(key) : undefined, images);
  if (gesture?.sheet === s) drawOverlay(s);
  if (selected?.page === p) drawSelection(s);
  if (bg && key && !pdfBitmaps.has(key)) {
    renderPdfPage(bg.attachment, () => storage.getAttachment(bg.attachment), bg.page, w).then(
      (bitmap) => {
        pdfBitmaps.set(key, bitmap);
        // Keep only a handful of full-size backgrounds in memory.
        while (pdfBitmaps.size > 12) pdfBitmaps.delete(pdfBitmaps.keys().next().value!);
        if (s.live) renderSheet(s);
      },
      (error) => toast(`PDF: ${(error as Error).message}`),
    );
  }
  if ((p.images ?? []).some((i) => !images.has(i.attachment))) void loadImagesOf(p).then(() => s.live && renderSheet(s));
}

/** In-progress lasso path and eraser ring. */
function drawOverlay(s: Sheet): void {
  const ctx = s.ctx;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#2a6fdb";
  if (gesture?.kind === "lasso" && gesture.lasso.length > 1) {
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    gesture.lasso.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
  }
  if (gesture?.kind === "erase" && gesture.at) {
    ctx.strokeStyle = "#66717e";
    ctx.beginPath();
    ctx.arc(gesture.at.x, gesture.at.y, eraserRadius(), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

const HANDLE = 30;
const ROTATE_OFFSET = 56;
function selectionBox(): Box | undefined {
  return selected && selectionBounds(selected.page, selected.selection, textHeightOf(selected.page));
}
function drawSelection(s: Sheet): void {
  const box = selectionBox();
  const ctx = s.ctx;
  if (!box) return;
  ctx.save();
  ctx.setLineDash([12, 8]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#2a6fdb";
  ctx.strokeRect(box.x - 8, box.y - 8, box.width + 16, box.height + 16);
  ctx.setLineDash([]);
  ctx.fillStyle = "#2a6fdb";
  // Resize handle bottom right, rotate handle above the top edge.
  ctx.fillRect(box.x + box.width - 2, box.y + box.height - 2, 22, 22);
  ctx.beginPath();
  ctx.moveTo(box.x + box.width / 2, box.y - 8);
  ctx.lineTo(box.x + box.width / 2, box.y - ROTATE_OFFSET + 12);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(box.x + box.width / 2, box.y - ROTATE_OFFSET, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Floating actions above the lasso selection. */
function renderSelectionMenu(): void {
  document.querySelector(".sel-menu")?.remove();
  const box = selectionBox();
  const s = selected && sheetOf(selected.page);
  if (!box || !s || gesture) return;
  const scale = s.el.clientWidth / pageW(s.page);
  const action = (label: string, run: () => void) => {
    const b = h("button", {}, label);
    b.onpointerdown = (event) => event.stopPropagation();
    b.onclick = (event) => {
      event.stopPropagation();
      run();
    };
    return b;
  };
  const menu = h(
    "div",
    { class: "sel-menu" },
    action("Kopieren", () => copySelected()),
    action("Ausschneiden", () => cutSelected()),
    action("Duplizieren", () => duplicateSelected()),
    action("Farbe", () => {
      const preset = settings.presets.pen;
      showMenu(menu, [
        ...preset.colors.map((color) => ({ node: colorRow(color, () => recolorSelected(color)) })),
        { label: "Andere Farbe …", action: () => pickColor(preset.colors[0], recolorSelected) },
      ]);
    }),
    action("Löschen", () => deleteSelected()),
  );
  menu.style.left = `${(box.x + box.width / 2) * scale}px`;
  menu.style.top = `${Math.max(46, (box.y - ROTATE_OFFSET - 18) * scale)}px`;
  s.el.append(menu);
}
function colorRow(color: string, run: () => void): HTMLElement {
  const b = h("button", {}, h("span", { class: "swatch" }, h("i", { style: `background:${color}` })), color);
  b.onclick = () => {
    closeMenu();
    run();
  };
  return b;
}

// ---------------------------------------------------------------------------
// Tools and the context bar (colours, sizes, eraser modes)

const presetTool = (): PresetTool | undefined => (tool === "pen" || tool === "highlighter" || tool === "shape" || tool === "text" ? tool : undefined);
const currentColor = (t: PresetTool = presetTool() ?? "pen") => settings.presets[t].colors[settings.presets[t].color];
const currentWidth = (t: PresetTool = presetTool() ?? "pen") => settings.presets[t].widths[settings.presets[t].width];
const eraserRadius = () => settings.eraser.sizes[settings.eraser.size];

function setTool(next: Tool): void {
  if (next !== tool) previousTool = tool;
  tool = next;
  finishTextEdit();
  if (tool !== "lasso" && selected) {
    selected = undefined;
    renderAllSheets();
    renderSelectionMenu();
  }
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  renderContext();
}
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => (button.onclick = () => setTool(button.dataset.tool as Tool)));

const colorInput = $<HTMLInputElement>("color-input");
function pickColor(initial: string, done: (color: string) => void): void {
  colorInput.value = initial;
  colorInput.oninput = colorInput.onchange = () => done(colorInput.value);
  colorInput.click();
}

function renderContext(): void {
  const bar = $("context");
  const t = presetTool();
  const items: HTMLElement[] = [];
  if (t) {
    const preset = settings.presets[t];
    preset.colors.forEach((color, i) => {
      const b = h("button", { class: "swatch" + (i === preset.color ? " active" : ""), title: i === preset.color ? "Nochmal tippen: Farbe ändern" : "Farbe" }, h("i", { style: `background:${color}` }));
      b.onclick = () => {
        if (i !== preset.color) {
          preset.color = i;
          saveSettingsNow();
          return renderContext();
        }
        pickColor(color, (value) => {
          preset.colors[i] = value;
          saveSettingsNow();
          renderContext();
        });
      };
      items.push(b);
    });
    items.push(h("span", { class: "divider" }));
    preset.widths.forEach((width, i) => {
      const dot = Math.max(3, Math.min(18, (t === "highlighter" ? width * 2 : t === "text" ? width * 3 : width * 1.6) + 2));
      const b = h("button", { class: "size" + (i === preset.width ? " active" : ""), title: i === preset.width ? "Nochmal tippen: Stärke ändern" : "Stärke" }, h("i", { style: `width:${dot}px;height:${dot}px` }));
      b.onclick = () => {
        if (i !== preset.width) {
          preset.width = i;
          saveSettingsNow();
          return renderContext();
        }
        const range = h("input", { type: "range", min: "1", max: t === "highlighter" ? "16" : "12", step: "0.5", value: String(width) }) as HTMLInputElement;
        const label = h("span", {}, String(width));
        range.oninput = () => {
          preset.widths[i] = Number(range.value);
          label.textContent = range.value;
          saveSettingsNow();
          renderContext();
        };
        showMenu(b, [{ node: h("div", { class: "slider" }, "Stärke", range, label) }]);
      };
      items.push(b);
    });
  } else if (tool === "eraser") {
    settings.eraser.sizes.forEach((size, i) => {
      const dot = 4 + i * 5;
      const b = h("button", { class: "size" + (i === settings.eraser.size ? " active" : ""), title: `Radierer ${["klein", "mittel", "groß"][i]}` }, h("i", { style: `width:${dot}px;height:${dot}px` }));
      b.onclick = () => {
        settings.eraser.size = i;
        saveSettingsNow();
        renderContext();
      };
      items.push(b);
      void size;
    });
    items.push(h("span", { class: "divider" }));
    const labels = { stroke: "Ganze Striche", partial: "Teilweise", highlighter: "Nur Textmarker" } as const;
    const mode = h("button", { class: "label", title: "Radiermodus" }, `${labels[settings.eraser.mode]} ▾`);
    mode.onclick = () =>
      showMenu(
        mode,
        (Object.keys(labels) as (keyof typeof labels)[]).map((m) => ({
          label: labels[m],
          checked: settings.eraser.mode === m,
          action: () => {
            settings.eraser.mode = m;
            saveSettingsNow();
            renderContext();
          },
        })),
      );
    items.push(mode);
  } else if (tool === "lasso") {
    const paste = h("button", { class: "label", disabled: !clip }, "Einfügen");
    paste.onclick = () => pasteHere();
    items.push(h("span", { class: "label hint" }, selected ? "Ziehen: verschieben · Ecke: Größe · Kreis: drehen" : "Umkreisen zum Auswählen"), paste);
  }
  bar.replaceChildren(...items);
}

// Apple Pencil double tap, reported by the iOS shell (SceneDelegate.swift).
window.addEventListener("pencildoubletap", (event) => {
  const system = (event as Event & { action?: string }).action ?? "eraser";
  const action = settings.doubleTap === "system" ? system : settings.doubleTap;
  if (action === "eraser") setTool(tool === "eraser" ? (previousTool === "eraser" ? "pen" : previousTool) : "eraser");
  else if (action === "previous") setTool(previousTool);
  else if (action === "palette") {
    const t = presetTool();
    if (t) pickColor(currentColor(t), (value) => {
      settings.presets[t].colors[settings.presets[t].color] = value;
      saveSettingsNow();
      renderContext();
    });
  }
});

// ---------------------------------------------------------------------------
// Pointer input on the pages

type Gesture =
  | { kind: "draw"; id: number; type: string; sheet: Sheet; stroke: Stroke; drawn: number; snapped: boolean }
  | { kind: "erase"; id: number; type: string; sheet: Sheet; at?: Point; before: Snapshot; changed: boolean }
  | { kind: "lasso"; id: number; type: string; sheet: Sheet; lasso: Point[] }
  | { kind: "drag" | "resize" | "rotate"; id: number; type: string; sheet: Sheet; last: Point; origin: Point; before: Snapshot; changed: boolean }
  | { kind: "pan"; id: number; type: string; sheet?: Sheet; last: { x: number; y: number }; start: { x: number; y: number }; track: { x: number; y: number; t: number }[] };
let gesture: Gesture | undefined;
const touches = new Map<number, { x: number; y: number }>();
let pinch: { distance: number; zoom: number; mid: { x: number; y: number } } | undefined;
const PEN_KEY = "kladde.penSeen";
let penSeen = (() => {
  try {
    return localStorage.getItem(PEN_KEY) === "1";
  } catch {
    return false;
  }
})();
/** Whether a single finger scrolls instead of drawing. */
const fingersScroll = () => settings.penOnly === "pen" || (settings.penOnly === "auto" && penSeen);

const client = (event: PointerEvent) => ({ x: event.clientX, y: event.clientY });
function pointIn(s: Sheet, event: { clientX: number; clientY: number; pointerType?: string; pressure?: number }): Point {
  const rect = s.el.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * pageW(s.page),
    y: ((event.clientY - rect.top) / rect.height) * pageH(s.page),
    p: event.pointerType === "mouse" || !event.pressure ? 0.5 : event.pressure,
  };
}
const sheetAt = (event: PointerEvent) => sheets.find((s) => s.el === (event.target as HTMLElement).closest(".sheet"));

// Multi-finger taps: two fingers undo, three fingers redo. A tap is short, barely moves and
// starts with no stylus on the page; anything else stays a pinch or scroll.
const TAP_MS = 300;
const TAP_SLOP = 12;
let tap: { started: number; fingers: number; zoom: number; scroll: { left: number; top: number }; from: Map<number, { x: number; y: number }> } | undefined;
let tapBroken = false;
function tapDown(event: PointerEvent): void {
  if (touches.size === 1) {
    tap = { started: event.timeStamp, fingers: 0, zoom, scroll: { left: stage.scrollLeft, top: stage.scrollTop }, from: new Map() };
    tapBroken = gesture?.type === "pen";
  }
  if (!tap) return;
  tap.from.set(event.pointerId, client(event));
  tap.fingers = Math.max(tap.fingers, touches.size);
  if (event.timeStamp - tap.started > TAP_MS || gesture?.type === "pen") tapBroken = true;
}
function tapMove(event: PointerEvent): void {
  const start = tap?.from.get(event.pointerId);
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) tapBroken = true;
}
/** After a finger lifts: fires undo/redo once the last finger of a valid tap is up. */
function tapUp(event: PointerEvent): void {
  if (!tap || !tap.from.has(event.pointerId)) return;
  if (event.type === "pointercancel" || event.timeStamp - tap.started > TAP_MS) tapBroken = true;
  if (touches.size > 0) return;
  const { fingers, zoom: before, scroll } = tap;
  tap = undefined;
  if (tapBroken || fingers < 2 || fingers > 3 || !settings.tapUndo) return;
  // The fingers may have nudged zoom or scroll; a tap leaves the view as it was.
  if (zoom !== before) setZoom(before);
  stage.scrollTo(scroll.left, scroll.top);
  if (fingers === 2) {
    undo();
    toast("Rückgängig", 900);
  } else {
    redo();
    toast("Wiederholt", 900);
  }
}

/** Ends the current gesture without committing an unfinished stroke or lasso. */
function cancelGesture(): void {
  if (!gesture) return;
  if (pagesEl.hasPointerCapture(gesture.id)) pagesEl.releasePointerCapture(gesture.id);
  const g = gesture;
  gesture = undefined;
  clearTimeout(holdTimer);
  if ((g.kind === "drag" || g.kind === "resize" || g.kind === "rotate" || g.kind === "erase") && g.changed) {
    pushUndo(g.before);
    changed(g.sheet.page, false);
  }
  if (g.sheet) renderSheet(g.sheet);
  renderSelectionMenu();
}

function startPinch(): void {
  const [a, b] = [...touches.values()];
  pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}
function updatePinch(): void {
  if (!pinch || touches.size < 2) return;
  const [a, b] = [...touches.values()];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  setZoom(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance), mid, false);
  // Two fingers moving together pan the view.
  stage.scrollBy(pinch.mid.x - mid.x, pinch.mid.y - mid.y);
  pinch.mid = mid;
}

/** Sets the zoom and keeps the content point under `anchor` (client coordinates) in place. */
function setZoom(value: number, anchor?: { x: number; y: number }, announce = true): void {
  const next = Math.min(5, Math.max(0.5, value));
  if (next === zoom) return;
  const rect = stage.getBoundingClientRect();
  const ax = (anchor?.x ?? rect.left + rect.width / 2) - rect.left;
  const ay = (anchor?.y ?? rect.top + rect.height / 2) - rect.top;
  const cx = stage.scrollLeft + ax;
  const cy = stage.scrollTop + ay;
  const ratio = next / zoom;
  zoom = next;
  layoutSheets();
  stage.scrollLeft = cx * ratio - ax;
  stage.scrollTop = cy * ratio - ay;
  if (announce) toast(`${Math.round(zoom * 100)} %`, 700);
  renderSelectionMenu();
}

let holdTimer: ReturnType<typeof setTimeout> | undefined;
let holdAnchor: Point | undefined;
/** Holding the pen still at the end of a stroke turns it into the shape it resembles. */
function armHold(at: Point): void {
  if (!settings.holdToShape || gesture?.kind !== "draw" || gesture.snapped) return;
  if (holdAnchor && Math.hypot(at.x - holdAnchor.x, at.y - holdAnchor.y) < 6) return;
  holdAnchor = at;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    const g = gesture;
    if (g?.kind !== "draw" || g.stroke.points.length < 6) return;
    let shape = recognizeShape(g.stroke.points);
    if (shape && g.stroke.tool === "highlighter" && shape.length !== 2) shape = undefined;
    if (!shape) return;
    g.stroke.points = shape;
    g.snapped = true;
    renderSheet(g.sheet);
    drawStroke(g.sheet.ctx, g.stroke);
  }, 500);
}

function erase(g: Extract<Gesture, { kind: "erase" }>, at: Point): void {
  g.at = at;
  const p = g.sheet.page;
  const next = eraseAt(p.strokes, at, eraserRadius(), settings.eraser.mode, newId);
  if (next) {
    p.strokes = next;
    g.changed = true;
  }
  renderSheet(g.sheet);
}

pagesEl.addEventListener("pointerdown", (event) => {
  if ((event.target as HTMLElement).closest(".sel-menu, .text-editor, .add-sheet")) return;
  const s = sheetAt(event);
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
    if (gesture?.type === "touch") cancelGesture();
    pinch = undefined;
  }
  if (event.pointerType === "touch") {
    touches.set(event.pointerId, client(event));
    tapDown(event);
    // Palm rejection: while the pen writes, touches are ignored.
    if (gesture?.type === "pen") return;
    if (touches.size === 2) {
      cancelGesture();
      return startPinch();
    }
    if (touches.size > 2 || pinch) return;
  }
  if (gesture) return;
  stopInertia();
  if (finishTextEdit() && tool === "text") return;
  pagesEl.setPointerCapture(event.pointerId);
  const base = { id: event.pointerId, type: event.pointerType };
  if ((event.pointerType === "touch" && fingersScroll()) || !s) {
    const at = client(event);
    gesture = { ...base, kind: "pan", sheet: s, last: at, start: at, track: [{ ...at, t: event.timeStamp }] };
    return;
  }
  const at = pointIn(s, event);
  if (tool === "text") {
    // Text boxes open on release, so a scroll that starts on the page still scrolls.
    const pos = client(event);
    gesture = { ...base, kind: "pan", sheet: s, last: pos, start: pos, track: [{ ...pos, t: event.timeStamp }] };
    return;
  }
  if (tool === "eraser") {
    gesture = { ...base, kind: "erase", sheet: s, before: snapshotOf(s.page), changed: false };
    return erase(gesture, at);
  }
  if (tool === "lasso") {
    const box = selected?.page === s.page ? selectionBox() : undefined;
    const before = snapshotOf(s.page);
    if (box && Math.hypot(at.x - (box.x + box.width / 2), at.y - (box.y - ROTATE_OFFSET)) <= HANDLE) {
      gesture = { ...base, kind: "rotate", sheet: s, last: at, origin: { x: box.x + box.width / 2, y: box.y + box.height / 2, p: 0 }, before, changed: false };
    } else if (box && Math.abs(at.x - (box.x + box.width + 8)) <= HANDLE && Math.abs(at.y - (box.y + box.height + 8)) <= HANDLE) {
      gesture = { ...base, kind: "resize", sheet: s, last: at, origin: { x: box.x, y: box.y, p: 0 }, before, changed: false };
    } else if (box && at.x >= box.x - 8 && at.x <= box.x + box.width + 8 && at.y >= box.y - 8 && at.y <= box.y + box.height + 8) {
      gesture = { ...base, kind: "drag", sheet: s, last: at, origin: at, before, changed: false };
    } else {
      const old = selected && sheetOf(selected.page);
      selected = undefined;
      if (old && old !== s) renderSheet(old);
      gesture = { ...base, kind: "lasso", sheet: s, lasso: [at] };
    }
    renderSelectionMenu();
    return;
  }
  const t = presetTool() ?? "pen";
  gesture = {
    ...base,
    kind: "draw",
    sheet: s,
    snapped: false,
    drawn: 0,
    stroke: { id: newId(), tool: tool === "highlighter" ? "highlighter" : "pen", color: currentColor(t), width: currentWidth(t), points: [at] },
  };
  holdAnchor = undefined;
  armHold(at);
});

pagesEl.addEventListener("pointermove", (event) => {
  if (touches.has(event.pointerId)) {
    touches.set(event.pointerId, client(event));
    tapMove(event);
  }
  if (pinch) return updatePinch();
  const g = gesture;
  if (!g || event.pointerId !== g.id) return;
  if (g.kind === "pan") {
    const now = client(event);
    stage.scrollBy(g.last.x - now.x, g.last.y - now.y);
    g.last = now;
    g.track.push({ ...now, t: event.timeStamp });
    if (g.track.length > 8) g.track.shift();
    return;
  }
  const events = event.getCoalescedEvents?.() ?? [event];
  const points = (events.length ? events : [event]).map((e) => pointIn(g.sheet, e));
  const at = points[points.length - 1];
  if (g.kind === "erase") return points.forEach((q) => erase(g, q));
  if (g.kind === "lasso") {
    g.lasso.push(...points);
    return renderSheet(g.sheet);
  }
  const sel = selected;
  if ((g.kind === "drag" || g.kind === "resize" || g.kind === "rotate") && sel) {
    const p = sel.page;
    if (g.kind === "drag") moveSelection(p, sel.selection, at.x - g.last.x, at.y - g.last.y);
    else if (g.kind === "resize") {
      const before = Math.hypot(g.last.x - g.origin.x, g.last.y - g.origin.y);
      const after = Math.hypot(at.x - g.origin.x, at.y - g.origin.y);
      if (after < 10 || before < 1) return;
      scaleSelection(p, sel.selection, g.origin, after / before);
    } else {
      const angle = Math.atan2(at.y - g.origin.y, at.x - g.origin.x) - Math.atan2(g.last.y - g.origin.y, g.last.x - g.origin.x);
      rotateSelection(p, sel.selection, g.origin, angle, textHeightOf(p));
    }
    g.last = at;
    g.changed = true;
    return renderSheet(g.sheet);
  }
  if (g.kind !== "draw" || g.snapped) return;
  g.stroke.points.push(...points);
  armHold(at);
  if (g.stroke.tool === "pen") {
    drawPenSegments(g.sheet.ctx, g.stroke, Math.max(1, g.drawn));
    g.drawn = g.stroke.points.length;
  } else {
    renderSheet(g.sheet);
    drawStroke(g.sheet.ctx, g.stroke);
  }
});

const finish = (event: PointerEvent) => {
  touches.delete(event.pointerId);
  tapUp(event);
  if (pinch && touches.size < 2) {
    pinch = undefined;
    renderSelectionMenu();
  }
  const g = gesture;
  if (!g || event.pointerId !== g.id) return;
  gesture = undefined;
  clearTimeout(holdTimer);
  if (g.kind === "pan") {
    const moved = Math.hypot(g.last.x - g.start.x, g.last.y - g.start.y) > 8;
    if (!moved && event.type === "pointerup" && g.sheet) {
      if (tool === "text") return startTextEdit(g.sheet, pointIn(g.sheet, event));
      if (tool === "lasso" && selected) {
        selected = undefined;
        renderAllSheets();
        renderSelectionMenu();
      }
    }
    if (moved) startInertia(g.track);
    return;
  }
  const p = g.sheet.page;
  if (g.kind === "erase" || g.kind === "drag" || g.kind === "resize" || g.kind === "rotate") {
    if (g.changed) {
      pushUndo(g.before);
      changed(p, false);
    }
  } else if (g.kind === "lasso") {
    const selection = g.lasso.length > 2 ? lassoSelect(p, g.lasso, textHeightOf(p)) : undefined;
    selected = selection && !isEmpty(selection) ? { page: p, selection } : undefined;
    renderContext();
  } else if (g.kind === "draw") {
    // Busy frames can deliver few move events; the release point completes the stroke.
    if (event.type === "pointerup" && !g.snapped) {
      const end = pointIn(g.sheet, event);
      const last = g.stroke.points[g.stroke.points.length - 1];
      if (end.x !== last.x || end.y !== last.y) g.stroke.points.push({ ...end, p: last.p });
    }
    if (tool === "shape" && !g.snapped) g.stroke.points = recognizeShape(g.stroke.points) ?? g.stroke.points;
    checkpoint(p);
    p.strokes.push(g.stroke);
    changed(p, false);
  }
  renderSheet(g.sheet);
  renderSelectionMenu();
};
pagesEl.addEventListener("pointerup", finish);
pagesEl.addEventListener("pointercancel", finish);

// Finger scrolling keeps moving briefly after release, like native scrolling.
let inertiaFrame = 0;
function stopInertia(): void {
  cancelAnimationFrame(inertiaFrame);
  inertiaFrame = 0;
}
function startInertia(track: { x: number; y: number; t: number }[]): void {
  const a = track[0];
  const b = track[track.length - 1];
  const dt = b.t - a.t;
  if (dt <= 0 || dt > 200) return snapHorizontal();
  let vx = (a.x - b.x) / dt;
  let vy = (a.y - b.y) / dt;
  let last = performance.now();
  const step = (now: number) => {
    const ms = now - last;
    last = now;
    stage.scrollBy(vx * ms, vy * ms);
    const decay = Math.pow(0.995, ms);
    vx *= decay;
    vy *= decay;
    if (Math.hypot(vx, vy) > 0.02) inertiaFrame = requestAnimationFrame(step);
    else {
      inertiaFrame = 0;
      snapHorizontal();
    }
  };
  if (settings.scroll === "horizontal" && zoom <= 1.01) {
    // Paged: a flick turns exactly one page.
    const dir = Math.abs(vx) > 0.3 ? Math.sign(vx) : 0;
    return scrollToPage(Math.max(0, Math.min(sheets.length - 1, pageIndex + dir)), true);
  }
  inertiaFrame = requestAnimationFrame(step);
}
function snapHorizontal(): void {
  if (settings.scroll === "horizontal" && zoom <= 1.01) scrollToPage(pageIndex, true);
}

// ---------------------------------------------------------------------------
// Text boxes, edited in place

let textEdit: { sheet: Sheet; area: HTMLTextAreaElement; text: TextBox; isNew: boolean } | undefined;

function startTextEdit(s: Sheet, at: Point): void {
  const p = s.page;
  const hit = (p.texts ?? []).find((t) => at.x >= t.x - 10 && at.x <= t.x + t.width + 10 && at.y >= t.y - 10 && at.y <= t.y + textHeight(scratch, t) + 10);
  const text: TextBox = hit ?? {
    id: newId(),
    x: at.x,
    y: at.y - (12 * currentWidth("text") + 16) * 0.6,
    width: Math.max(240, pageW(p) - at.x - 60),
    text: "",
    fontSize: 12 * currentWidth("text") + 16,
    color: currentColor("text"),
  };
  const scale = s.el.clientWidth / pageW(p);
  const area = h("textarea", { class: "text-editor", spellcheck: "true" }) as HTMLTextAreaElement;
  Object.assign(area.style, {
    left: `${text.x * scale}px`,
    top: `${text.y * scale}px`,
    width: `${text.width * scale}px`,
    fontSize: `${text.fontSize * scale}px`,
    fontWeight: text.bold ? "bold" : "normal",
    color: text.color,
  });
  area.value = text.text;
  const grow = () => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight + 2}px`;
  };
  area.oninput = grow;
  area.onkeydown = (event) => {
    if (event.key === "Escape") finishTextEdit();
  };
  area.onblur = () => finishTextEdit();
  s.el.append(area);
  textEdit = { sheet: s, area, text, isNew: !hit };
  editingTextId = text.id;
  renderSheet(s);
  grow();
  area.focus();
}

/** Commits an open text box. Returns true when one was open. */
function finishTextEdit(): boolean {
  const edit = textEdit;
  if (!edit) return false;
  textEdit = undefined;
  editingTextId = undefined;
  edit.area.remove();
  const p = edit.sheet.page;
  const value = edit.area.value.replace(/\s+$/, "");
  if (value !== edit.text.text) {
    checkpoint(p);
    if (!value) p.texts = p.texts?.filter((t) => t.id !== edit.text.id);
    else if (edit.isNew) (p.texts ??= []).push({ ...edit.text, text: value });
    else edit.text.text = value;
    changed(p, false);
  }
  renderSheet(edit.sheet);
  return true;
}

// ---------------------------------------------------------------------------
// Selection actions

function copySelected(): void {
  if (!selected) return;
  clip = copySelection(selected.page, selected.selection);
  toast("Kopiert");
  renderContext();
}
function cutSelected(): void {
  copySelected();
  deleteSelected();
}
function deleteSelected(): void {
  if (!selected) return;
  const p = selected.page;
  checkpoint(p);
  deleteSelection(p, selected.selection);
  selected = undefined;
  changed(p);
  renderSelectionMenu();
}
function duplicateSelected(): void {
  if (!selected) return;
  const copy = copySelection(selected.page, selected.selection);
  const p = selected.page;
  checkpoint(p);
  selected = { page: p, selection: pasteClip(p, copy, 30, 30, newId) };
  changed(p);
  renderSelectionMenu();
}
function recolorSelected(color: string): void {
  if (!selected) return;
  const p = selected.page;
  checkpoint(p);
  recolorSelection(p, selected.selection, color);
  changed(p);
}
function pasteHere(): void {
  const p = page();
  if (!clip || !p) return;
  checkpoint(p);
  // Same page: offset so the copy is visible; another page: same position.
  const offset = selected?.page === p ? 30 : 0;
  const old = selected && sheetOf(selected.page);
  selected = { page: p, selection: pasteClip(p, clip, offset, offset, newId) };
  if (old) renderSheet(old);
  if (tool !== "lasso") setTool("lasso");
  changed(p);
  renderContext();
  renderSelectionMenu();
}

$("undo").onclick = undo;
$("redo").onclick = redo;
document.addEventListener("keydown", (event) => {
  if ((event.target as HTMLElement).closest("input, textarea, dialog") || $("editor-view").hidden) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  } else if (mod && key === "y") {
    event.preventDefault();
    redo();
  } else if (mod && key === "c") copySelected();
  else if (mod && key === "x") cutSelected();
  else if (mod && key === "v") pasteHere();
  else if (mod && key === "d") {
    event.preventDefault();
    duplicateSelected();
  } else if (event.key === "Delete" || event.key === "Backspace") deleteSelected();
  else if (event.key === "Escape" && selected) {
    selected = undefined;
    renderAllSheets();
    renderSelectionMenu();
  }
});

// ---------------------------------------------------------------------------
// Pages: add, delete, duplicate, move, bookmarks, outline

function addPage(after = page()): void {
  if (!current) return;
  finishTextEdit();
  const fresh = pageLike(after);
  const index = insertPage(current, fresh, after);
  changed();
  buildSheets();
  scrollToPage(index, true);
}
function addPageAt(index: number, like: Page): void {
  if (!current) return;
  finishTextEdit();
  insertPageAt(current, pageLike(like), index);
  changed();
  buildSheets();
  scrollToPage(index, true);
}
function deletePage(p: Page): void {
  if (!current || !confirm("Diese Seite löschen?")) return;
  p.deleted = true;
  p.strokes = [];
  p.texts = p.images = undefined;
  if (selected?.page === p) selected = undefined;
  changed(p, false);
  if (visiblePages(current).length === 0) current.pages.push(pageLike(p));
  buildSheets();
}
function duplicate(p: Page): void {
  if (!current) return;
  const copy = duplicatePage(current, p);
  changed(copy, false);
  buildSheets();
  scrollToPage(visiblePages(current).indexOf(copy), true);
}
function move(from: number, to: number): void {
  if (!current) return;
  movePage(current, from, to);
  changed();
  buildSheets();
  scrollToPage(to);
}
function toggleBookmark(p = page()): void {
  if (!p) return;
  p.bookmark = !p.bookmark || undefined;
  changed(p, false);
  updatePageUi();
}
function setOutlineTitle(p: Page): void {
  const title = prompt("Eintrag in der Gliederung (leer zum Entfernen)", p.title ?? "")?.trim();
  if (title === undefined) return;
  p.title = title || undefined;
  changed(p, false);
  renderSidebar();
}
function setTemplate(p: Page, template: Template): void {
  p.template = template;
  changed(p);
}
function pageMenu(p: Page): MenuItem[] {
  const pages = current ? visiblePages(current) : [];
  const i = pages.indexOf(p);
  const templates: [Template, string][] = [
    ["lined", "Liniert"],
    ["grid", "Kariert"],
    ["dotted", "Gepunktet"],
    ["blank", "Blanko"],
  ];
  return [
    { label: "Neue Seite davor", action: () => addPageAt(i, p) },
    { label: "Neue Seite danach", action: () => addPage(p) },
    { label: "Seite duplizieren", action: () => duplicate(p) },
    { label: "Nach oben", disabled: i <= 0, action: () => move(i, i - 1) },
    { label: "Nach unten", disabled: i >= pages.length - 1, action: () => move(i, i + 1) },
    { separator: true },
    { label: p.bookmark ? "Lesezeichen entfernen" : "Lesezeichen setzen", action: () => toggleBookmark(p) },
    { label: p.title ? "Gliederungseintrag ändern …" : "Zur Gliederung hinzufügen …", action: () => setOutlineTitle(p) },
    { separator: true },
    ...templates.map(([value, label]) => ({ label: `Papier: ${label}`, checked: p.template === value, action: () => setTemplate(p, value) })),
    { separator: true },
    { label: "Seite löschen", danger: true, action: () => deletePage(p) },
  ];
}

// ---------------------------------------------------------------------------
// Sidebar: page thumbnails, bookmarks, outline

let dragPage: number | undefined;
function renderSidebar(): void {
  const list = $("sidebar-list");
  document.querySelectorAll<HTMLButtonElement>("#sidebar [data-pane]").forEach((b) => b.classList.toggle("active", b.dataset.pane === sidebarPane));
  const pages = current ? visiblePages(current) : [];
  if (sidebarPane === "pages") {
    const nodes = pages.map((p, i) => {
      const picture = h("div", { class: "blank", style: `aspect-ratio:${pageW(p)} / ${pageH(p)}` });
      const more = iconButton("more", "Seitenoptionen", (event) => showMenu(event.currentTarget as HTMLElement, pageMenu(p)));
      const node = h("div", { class: "thumb" + (i === pageIndex ? " current" : ""), draggable: "true" }, picture, h("div", { class: "num" }, String(i + 1), more));
      if (p.bookmark) node.append(h("span", { class: "mark", html: icons.bookmarkOn }));
      void thumbnail(p, 180).then((url) => {
        const img = h("img", { src: url, alt: `Seite ${i + 1}`, style: `aspect-ratio:${pageW(p)} / ${pageH(p)}` });
        picture.replaceWith(img);
      });
      node.onclick = () => scrollToPage(i);
      node.oncontextmenu = (event) => {
        event.preventDefault();
        showMenu({ x: event.clientX, y: event.clientY }, pageMenu(p));
      };
      node.ondragstart = () => (dragPage = i);
      node.ondragover = (event) => {
        event.preventDefault();
        node.classList.add("drop-before");
      };
      node.ondragleave = () => node.classList.remove("drop-before");
      node.ondrop = (event) => {
        event.preventDefault();
        node.classList.remove("drop-before");
        if (dragPage !== undefined && dragPage !== i) move(dragPage, dragPage < i ? i - 1 : i);
        dragPage = undefined;
      };
      return node;
    });
    list.replaceChildren(...nodes);
    list.querySelector(".current")?.scrollIntoView({ block: "nearest" });
  } else {
    const marked = pages.map((p, i) => ({ p, i })).filter(({ p }) => (sidebarPane === "bookmarks" ? p.bookmark : p.title));
    const nodes: HTMLElement[] = marked.map(({ p, i }) => {
      const b = h("button", { class: "entry" }, h("span", {}, sidebarPane === "outline" ? p.title! : p.title ?? `Seite ${i + 1}`), h("small", {}, String(i + 1)));
      b.onclick = () => scrollToPage(i);
      b.oncontextmenu = (event) => {
        event.preventDefault();
        if (sidebarPane === "outline") setOutlineTitle(p);
        else toggleBookmark(p);
      };
      return b;
    });
    if (!nodes.length) nodes.push(h("p", { class: "hint" }, sidebarPane === "bookmarks" ? "Noch keine Lesezeichen. Oben links auf das Lesezeichen tippen." : "Noch keine Gliederung."));
    if (sidebarPane === "outline") {
      const add = h("button", {}, icon("plus"), "Aktuelle Seite eintragen");
      add.onclick = () => page() && setOutlineTitle(page()!);
      nodes.push(add);
    }
    list.replaceChildren(...nodes);
  }
}
document.querySelectorAll<HTMLButtonElement>("#sidebar [data-pane]").forEach((button) => {
  button.onclick = () => {
    sidebarPane = button.dataset.pane as typeof sidebarPane;
    renderSidebar();
  };
});
$("toggle-sidebar").onclick = () => {
  const sidebar = $("sidebar");
  sidebar.hidden = !sidebar.hidden;
  $("toggle-sidebar").classList.toggle("active", !sidebar.hidden);
  if (!sidebar.hidden) renderSidebar();
  layoutSheets();
};

// ---------------------------------------------------------------------------
// Top bar actions

$("back").onclick = showLibrary;
$("bookmark").onclick = () => toggleBookmark();
$("add-page").onclick = () => addPage();
$("more").onclick = (event) => {
  const p = page();
  if (!current || !p) return;
  const nb = current;
  showMenu(event.currentTarget as HTMLElement, [
    ...pageMenu(p).filter((item) => !item.label?.startsWith("Nach ")),
    { separator: true },
    { label: "Seiten untereinander", checked: settings.scroll === "vertical", action: () => setScroll("vertical") },
    { label: "Seiten nebeneinander", checked: settings.scroll === "horizontal", action: () => setScroll("horizontal") },
    { label: `Zoom zurücksetzen (${Math.round(zoom * 100)} %)`, action: () => setZoom(1) },
    { separator: true },
    { label: "Notizbuch umbenennen", action: () => renameNotebook(nb) },
    { label: "Einstellungen", action: openSettings },
  ]);
};
function setScroll(mode: "vertical" | "horizontal"): void {
  const index = pageIndex;
  settings.scroll = mode;
  saveSettingsNow();
  buildSheets();
  scrollToPage(index);
}
$("share").onclick = (event) =>
  showMenu(event.currentTarget as HTMLElement, [
    { label: "Als PDF teilen oder sichern", action: () => void exportPdf() },
    { label: "Drucken", action: () => void printNotebook() },
  ]);

$("insert-image").onclick = () => $<HTMLInputElement>("image-file").click();
$<HTMLInputElement>("image-file").onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const p = page();
  if (!file || !p) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const attachment = newId();
  await storage.putAttachment(attachment, bytes);
  images.set(attachment, bitmap);
  const scale = Math.min(1, (pageW(p) * 0.6) / bitmap.width);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  checkpoint(p);
  const image = { id: newId(), x: (pageW(p) - width) / 2, y: (pageH(p) - height) / 3, width, height, attachment };
  (p.images ??= []).push(image);
  // Like other note apps: the new image is selected, ready to move and resize.
  setTool("lasso");
  selected = { page: p, selection: { strokes: new Set(), texts: new Set(), images: new Set([image.id]) } };
  changed(p);
  renderContext();
  renderSelectionMenu();
};

// ---------------------------------------------------------------------------
// Export

async function renderForExport(p: Page): Promise<HTMLCanvasElement> {
  const off = document.createElement("canvas");
  off.width = Math.round(pageW(p));
  off.height = Math.round(pageH(p));
  const bg = p.background;
  const bitmap = bg ? await renderPdfPage(bg.attachment, () => storage.getAttachment(bg.attachment), bg.page, off.width) : undefined;
  for (const id of pageAttachments(p)) {
    if (images.has(id) || id === bg?.attachment) continue;
    const bytes = await storage.getAttachment(id);
    if (bytes) images.set(id, await createImageBitmap(new Blob([bytes.slice()])));
  }
  renderPage(off.getContext("2d")!, p, bitmap, images);
  return off;
}

async function exportPdf(): Promise<void> {
  if (!current) return;
  finishTextEdit();
  toast("PDF wird erstellt …", 10000);
  const pages = [];
  for (const p of visiblePages(current)) {
    const c = await renderForExport(p);
    const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG"))), "image/jpeg", 0.9));
    // A4 width in points maps to the standard page width.
    const pt = 595.28 / PAGE_WIDTH;
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), pixelWidth: c.width, pixelHeight: c.height, width: pageW(p) * pt, height: pageH(p) * pt });
  }
  const bytes = writePdf(pages);
  const name = `${current.title.replace(/[\\/:*?"<>|]/g, "_")}.pdf`;
  const file = new File([bytes.slice().buffer as ArrayBuffer], name, { type: "application/pdf" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: current.title });
      return toast("Geteilt");
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") return toast("Abgebrochen");
  }
  if ("Capacitor" in window) {
    // The app shells have no download folder for web pages; the print dialog can save as PDF.
    toast("Teilen nicht verfügbar – Druckdialog geöffnet („Als PDF sichern“)");
    return printNotebook();
  }
  const url = URL.createObjectURL(file);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  toast(`Gespeichert: ${name}`);
}

async function printNotebook(): Promise<void> {
  if (!current) return;
  const shots: HTMLImageElement[] = [];
  for (const p of visiblePages(current)) shots.push(h("img", { src: (await renderForExport(p)).toDataURL("image/png") }));
  $("print").replaceChildren(...shots);
  // The system print dialog offers "Save as PDF" on every target platform.
  setTimeout(() => window.print(), 100);
}

// ---------------------------------------------------------------------------
// Import: Goodnotes files, PDFs and ZIP archives of both, keeping folders

$("import-file").addEventListener("click", () => {
  // iOS greys out files whose extension it has no type for, and .goodnotes is
  // only known when Goodnotes is installed. The importer checks the contents instead.
  if (isIOS) $<HTMLInputElement>("import-file").removeAttribute("accept");
});
$<HTMLInputElement>("import-file").onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  await importFiles(files);
};

async function importFiles(files: File[]): Promise<void> {
  const base = libSection === "all" && !$("library-view").hidden ? libFolder : (current?.folder ?? "");
  let done = 0;
  let failed = 0;
  let last: Notebook | undefined;
  const items = [];
  for (const file of files) {
    const found = expandImport(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!found.length) {
      failed++;
      status(`Nicht erkannt: ${file.name}`);
    }
    items.push(...found);
  }
  for (const item of items) {
    toast(`Importiere ${done + failed + 1} von ${items.length}: ${item.title}`, 20000);
    try {
      let notebook: Notebook;
      if (item.kind === "goodnotes") {
        const result = importGoodnotes(item.bytes, { fallbackTitle: item.title });
        await Promise.all([...result.attachments].map(([id, bytes]) => storage.putAttachment(id, bytes)));
        notebook = result.notebook;
        if (result.report.warnings.length) console.warn(item.title, result.report.warnings);
      } else {
        const attachment = newId();
        await storage.putAttachment(attachment, item.bytes);
        notebook = notebookFromPdf(item.title, attachment, await pdfPageSizes(item.bytes));
      }
      notebook.folder = joinFolder(base, item.folder);
      notebooks.push(notebook);
      await storage.put(notebook);
      last = notebook;
      done++;
    } catch (error) {
      failed++;
      status(`Import fehlgeschlagen: ${item.title}: ${(error as Error).message}`);
    }
  }
  scheduleSync();
  toast(failed ? `${done} importiert, ${failed} fehlgeschlagen (Details links unten)` : `${done} importiert`, 4000);
  if (done === 1 && last) openNotebook(last);
  else renderLibrary();
}

// Drag and drop files onto the window (desktop).
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length) return;
  event.preventDefault();
  void importFiles(files);
});

// ---------------------------------------------------------------------------
// Settings, welcome

const ACCOUNT_KEY = "kladde.nextcloud";
function loadAccount(): NextcloudAccount | undefined {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    const account = raw ? (JSON.parse(raw) as NextcloudAccount) : undefined;
    return account?.server ? account : undefined;
  } catch {
    return undefined;
  }
}

const settingsDialog = $<HTMLDialogElement>("settings-dialog");
function openSettings(): void {
  const form = settingsDialog.querySelector("form")!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  for (const name of ["penOnly", "doubleTap", "scroll"] as const) field(name).value = settings[name];
  (field("tapUndo") as HTMLInputElement).checked = settings.tapUndo;
  (field("holdToShape") as HTMLInputElement).checked = settings.holdToShape;
  const account = loadAccount();
  for (const name of ["server", "user", "appPassword", "folder"] as const) field(name).value = account?.[name] ?? (name === "folder" ? "Kladde" : "");
  settingsDialog.showModal();
}
settingsDialog.addEventListener("close", () => {
  if (settingsDialog.returnValue === "welcome") return showWelcome();
  if (settingsDialog.returnValue !== "save") return;
  const data = new FormData(settingsDialog.querySelector("form")!);
  const scroll = data.get("scroll") as typeof settings.scroll;
  settings.penOnly = data.get("penOnly") as typeof settings.penOnly;
  settings.doubleTap = data.get("doubleTap") as typeof settings.doubleTap;
  settings.tapUndo = data.get("tapUndo") === "on";
  settings.holdToShape = data.get("holdToShape") === "on";
  saveSettingsNow();
  if (scroll !== settings.scroll) setScroll(scroll);
  const account = { server: String(data.get("server")).trim(), user: String(data.get("user")).trim(), appPassword: String(data.get("appPassword")), folder: String(data.get("folder")).trim() || "Kladde" };
  try {
    if (account.server && account.user && account.appPassword) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    else localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    toast("Konto konnte nicht gespeichert werden");
  }
  toast("Einstellungen gespeichert");
});
$("lib-settings").onclick = openSettings;

const welcome = $<HTMLDialogElement>("welcome-dialog");
function showWelcome(): void {
  (welcome.querySelector('[name="penOnly"]') as HTMLInputElement).checked = settings.penOnly !== "finger";
  welcome.showModal();
}
welcome.addEventListener("close", () => {
  const penOnly = (welcome.querySelector('[name="penOnly"]') as HTMLInputElement).checked;
  settings.penOnly = penOnly ? (settings.penOnly === "pen" ? "pen" : "auto") : "finger";
  settings.welcomeSeen = true;
  saveSettingsNow();
  if (welcome.returnValue === "import") $("import-file").click();
});

// ---------------------------------------------------------------------------
// Sync: runs on a copy; edits made meanwhile merge back in and trigger another sync.

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
  status("Synchronisiere …");
  $("lib-sync").classList.add("active");
  try {
    const synced = await syncNotebooks(structuredClone(notebooks), new WebDav(account), {
      get: (id) => storage.getAttachment(id),
      put: (id, bytes) => storage.putAttachment(id, bytes),
    });
    notebooks = mergeBack(notebooks, synced);
    await Promise.all(notebooks.map((nb) => storage.put(nb)));
    status(`Synchronisiert: ${new Date().toLocaleTimeString("de-DE")}`);
  } catch (error) {
    status(`Sync-Fehler: ${(error as Error).message}`);
  } finally {
    syncing = false;
    $("lib-sync").classList.remove("active");
  }
  if (changedDuringSync) scheduleSync();
  // Merged notebooks are new objects; point the editor at them unless the user is mid-gesture.
  const id = current?.id;
  if (gesture || textEdit) return;
  current = notebooks.find((nb) => nb.id === id && !nb.deleted);
  selected = undefined;
  if (!$("library-view").hidden || !current) {
    if (!current && !$("editor-view").hidden) showLibrary();
    else renderLibrary();
  } else {
    const top = stage.scrollTop;
    const left = stage.scrollLeft;
    buildSheets();
    stage.scrollTo(left, top);
    renderTabs();
  }
}

$("lib-sync").onclick = () => (loadAccount() ? void sync() : openSettings());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    finishTextEdit();
    if (syncTimer !== undefined) void sync();
  }
});
window.addEventListener("online", () => void sync());

// Installed web app only; the Electron and Capacitor shells ship their files.
if ("serviceWorker" in navigator && location.protocol === "https:" && !("Capacitor" in window)) {
  void navigator.serviceWorker.register("./sw.js");
}

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    if ($("editor-view").hidden) return;
    const index = pageIndex;
    layoutSheets();
    scrollToPage(index);
    renderSelectionMenu();
  });
});
stage.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), { x: event.clientX, y: event.clientY });
  },
  { passive: false },
);

// Debug and test hook: exposes state for automated UI tests.
(window as unknown as { kladde: unknown }).kladde = {
  get notebooks() {
    return notebooks;
  },
  get current() {
    return current;
  },
  get pageIndex() {
    return pageIndex;
  },
  get tool() {
    return tool;
  },
  get zoom() {
    return zoom;
  },
  get selected() {
    return selected;
  },
  settings,
  undoDepth: () => undoStack.length,
};

void (async () => {
  notebooks = await storage.all();
  if (liveNotebooks().length === 0) {
    const nb = newNotebook("Mein erstes Notizbuch");
    notebooks.push(nb);
    await storage.put(nb);
  }
  const lastTab = notebooks.find((nb) => nb.id === settings.tabs[settings.tabs.length - 1] && !nb.deleted);
  settings.tabs = settings.tabs.filter((id) => notebooks.some((nb) => nb.id === id && !nb.deleted));
  if (lastTab) openNotebook(lastTab);
  else showLibrary();
  updateUndoButtons();
  if (!settings.welcomeSeen) showWelcome();
  void sync();
})();
