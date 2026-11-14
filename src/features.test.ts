import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createBackup, isBackup, restoreBackup } from "./backup";
import { expandImport, joinFolder, notebookFromPdf } from "./bundle";
import { copySelection, eraseAt, pasteClip, recolorSelection, rotateSelection, scribbleTargets } from "./edit";
import { penFactor } from "./ink";
import { newNotebook, newPage, PAGE_WIDTH, visiblePages, type Point, type Stroke } from "./model";
import { duplicatePage, insertPage, insertPageAt, movePage, pageLike } from "./pages";
import { writePdf } from "./pdfwrite";
import { DEFAULTS, withDefaults } from "./settings";
import { joinNotebooks, splitNotebook } from "./storage";
import { inkKey, normalize, pdfKey, searchNotebook, type IndexEntry } from "./search";

const pt = (x: number, y: number): Point => ({ x, y, p: 0.5 });
const stroke = (id: string, points: Point[], tool: Stroke["tool"] = "pen"): Stroke => ({ id, tool, color: "#000", width: 2, points });
let n = 0;
const ids = () => `id${++n}`;

describe("eraser", () => {
  const line = () => stroke("a", [pt(0, 0), pt(100, 0)]);

  it("removes whole strokes", () => {
    expect(eraseAt([line(), stroke("b", [pt(0, 50), pt(100, 50)])], pt(50, 0), 5, "stroke", ids)?.map((s) => s.id)).toEqual(["b"]);
  });

  it("returns undefined when nothing is hit", () => {
    expect(eraseAt([line()], pt(50, 40), 5, "stroke", ids)).toBeUndefined();
  });

  it("cuts the touched part out and keeps both ends", () => {
    const out = eraseAt([line()], pt(50, 0), 10, "partial", ids)!;
    expect(out).toHaveLength(2);
    expect(Math.max(...out[0].points.map((p) => p.x))).toBeLessThan(40);
    expect(Math.min(...out[1].points.map((p) => p.x))).toBeGreaterThan(60);
    expect(out[0].points[0]).toMatchObject({ x: 0, y: 0 });
    expect(out[1].points[out[1].points.length - 1]).toMatchObject({ x: 100, y: 0 });
  });

  it("only erases highlighter strokes in highlighter mode", () => {
    const out = eraseAt([line(), stroke("h", [pt(0, 0), pt(100, 0)], "highlighter")], pt(50, 0), 5, "highlighter", ids)!;
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });
});

describe("selection", () => {
  it("rotates strokes and images around the origin", () => {
    const page = newPage("blank");
    page.strokes = [stroke("s", [pt(10, 0)])];
    page.images = [{ id: "i", x: -5, y: 5, width: 10, height: 10, attachment: "x" }];
    const selection = { strokes: new Set(["s"]), texts: new Set<string>(), images: new Set(["i"]) };
    rotateSelection(page, selection, { x: 0, y: 0 }, Math.PI / 2, () => 0);
    expect(page.strokes[0].points[0].x).toBeCloseTo(0);
    expect(page.strokes[0].points[0].y).toBeCloseTo(10);
    // Image centre (0, 10) turns to (-10, 0).
    expect(page.images[0].x + 5).toBeCloseTo(-10);
    expect(page.images[0].y + 5).toBeCloseTo(0);
    expect(page.images[0].rotation).toBeCloseTo(Math.PI / 2);
  });

  it("copies, pastes with new ids and recolours", () => {
    const page = newPage("blank");
    page.strokes = [stroke("s", [pt(1, 1)])];
    page.texts = [{ id: "t", x: 0, y: 0, width: 10, text: "a", fontSize: 10, color: "#000" }];
    const selection = { strokes: new Set(["s"]), texts: new Set(["t"]), images: new Set<string>() };
    const clip = copySelection(page, selection);
    const pasted = pasteClip(page, clip, 30, 30, ids);
    expect(page.strokes).toHaveLength(2);
    expect(page.strokes[1].points[0]).toMatchObject({ x: 31, y: 31 });
    expect(pasted.strokes.has("s")).toBe(false);
    expect(page.texts).toHaveLength(2);
    recolorSelection(page, pasted, "#f00");
    expect(page.strokes.map((s) => s.color)).toEqual(["#000", "#f00"]);
    expect(page.texts.map((t) => t.color)).toEqual(["#000", "#f00"]);
    // The clip stays independent of later edits.
    expect(clip.strokes[0].points[0]).toMatchObject({ x: 1, y: 1 });
  });
});

describe("pages", () => {
  it("new pages copy paper and size but not content or PDF", () => {
    const like = { ...newPage("grid"), width: 1872, height: 1404, background: { attachment: "a", page: 0 } };
    like.strokes.push(stroke("s", [pt(0, 0)]));
    const page = pageLike(like);
    expect(page).toMatchObject({ template: "grid", width: 1872, height: 1404, strokes: [] });
    expect(page.background).toBeUndefined();
  });

  it("inserts, duplicates and moves among visible pages, skipping tombstones", () => {
    const nb = newNotebook("x");
    const [a] = nb.pages;
    const dead = { ...newPage("blank"), deleted: true };
    nb.pages.push(dead);
    const b = newPage("blank");
    expect(insertPage(nb, b, a)).toBe(1);
    const c = newPage("blank");
    insertPageAt(nb, c, 0);
    expect(visiblePages(nb)).toEqual([c, a, b]);
    const copy = duplicatePage(nb, a);
    expect(visiblePages(nb)).toEqual([c, a, copy, b]);
    expect(copy.id).not.toBe(a.id);
    movePage(nb, 0, 3);
    expect(visiblePages(nb)).toEqual([a, copy, b, c]);
    movePage(nb, 3, 0);
    expect(visiblePages(nb)).toEqual([c, a, copy, b]);
    expect(nb.pages).toContain(dead);
  });
});

describe("pdf writer", () => {
  it("writes a parseable structure with one image per page", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const bytes = writePdf([
      { jpeg, pixelWidth: 2, pixelHeight: 3, width: 595.28, height: 841.89 },
      { jpeg, pixelWidth: 3, pixelHeight: 2, width: 841.89, height: 595.28 },
    ]);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(2);
    // Every xref offset points at the start of its object.
    const xref = Number(text.match(/startxref\n(\d+)/)![1]);
    const entries = text.slice(xref).split("\n").slice(3, 3 + 8);
    entries.forEach((entry, i) => expect(text.slice(Number(entry.slice(0, 10)))).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });
});

describe("import bundle", () => {
  const goodnotes = zipSync({ "index.events.pb": new Uint8Array([1]) });
  const pdf = new TextEncoder().encode("%PDF-1.4 test");

  it("recognises single Goodnotes and PDF files by content", () => {
    expect(expandImport("Physik.goodnotes", goodnotes)).toMatchObject([{ kind: "goodnotes", title: "Physik", folder: "" }]);
    expect(expandImport("blatt.pdf", pdf)).toMatchObject([{ kind: "pdf", title: "blatt" }]);
    expect(expandImport("notes.txt", new TextEncoder().encode("hello"))).toEqual([]);
  });

  it("unpacks archives with folders and drops a single wrapping folder", () => {
    const zip = zipSync({
      "Export/Uni/Physik/Mechanik.goodnotes": goodnotes,
      "Export/Uni/Mathe.goodnotes": goodnotes,
      "Export/Blatt.pdf": pdf,
      "Export/.DS_Store": new Uint8Array([0]),
      "__MACOSX/Export/._Blatt.pdf": pdf,
    });
    const items = expandImport("Export.zip", zip).map(({ kind, title, folder }) => ({ kind, title, folder }));
    expect(items).toEqual([
      { kind: "goodnotes", title: "Mechanik", folder: "Uni/Physik" },
      { kind: "goodnotes", title: "Mathe", folder: "Uni" },
      { kind: "pdf", title: "Blatt", folder: "" },
    ]);
    expect(joinFolder("Schule", "Uni/Physik")).toBe("Schule/Uni/Physik");
    expect(joinFolder("", "")).toBeUndefined();
  });

  it("builds a notebook with one PDF-backed page per PDF page", () => {
    const nb = notebookFromPdf("Blatt", "att", [
      { width: 595, height: 842 },
      { width: 842, height: 595 },
    ]);
    expect(nb.pages.map((p) => p.background)).toEqual([
      { attachment: "att", page: 0 },
      { attachment: "att", page: 1 },
    ]);
    expect(nb.pages[1].width).toBe(PAGE_WIDTH);
    expect(nb.pages[1].height).toBeCloseTo((PAGE_WIDTH * 595) / 842);
  });
});

describe("settings", () => {
  it("keeps stored values and fills in new ones", () => {
    const s = withDefaults({ scroll: "horizontal", presets: { pen: { color: 2 } } } as never);
    expect(s.scroll).toBe("horizontal");
    expect(s.presets.pen.color).toBe(2);
    expect(s.presets.pen.colors).toEqual(DEFAULTS.presets.pen.colors);
    expect(s.tapUndo).toBe(true);
    expect(withDefaults(undefined)).toEqual(DEFAULTS);
  });
});

describe("scribble to erase", () => {
  const word = stroke("w", Array.from({ length: 20 }, (_, i) => pt(100 + i * 5, 100 + (i % 2) * 6)));
  const other = stroke("o", [pt(400, 100), pt(450, 100)]);
  const zigzag = Array.from({ length: 16 }, (_, i) => pt(i % 2 ? 200 : 95, 96 + i * 0.8));

  it("erases the ink under a zig-zag", () => {
    expect(scribbleTargets(zigzag, [word, other])).toEqual(["w"]);
  });

  it("ignores ordinary writing and scribbles over empty paper", () => {
    const writing = Array.from({ length: 30 }, (_, i) => pt(100 + i * 4, 100 + Math.sin(i) * 10));
    expect(scribbleTargets(writing, [word])).toBeUndefined();
    expect(scribbleTargets(zigzag.map((q) => ({ ...q, y: q.y + 300 })), [word])).toBeUndefined();
  });
});

describe("pen types", () => {
  it("ball pen ignores pressure, brush reacts strongly", () => {
    expect(penFactor("ball", 0.1)).toBe(penFactor("ball", 1));
    expect(penFactor("brush", 1) / penFactor("brush", 0.1)).toBeGreaterThan(penFactor("fountain", 1) / penFactor("fountain", 0.1));
  });
});

describe("backup", () => {
  it("round-trips notebooks and attachments and merges without losing newer edits", async () => {
    const nb = newNotebook("Physik", 100);
    nb.pages[0].background = { attachment: "pdf1", page: 0 };
    nb.pages[0].strokes = [stroke("old", [pt(1, 1)])];
    const store = new Map([["pdf1", new Uint8Array([37, 80, 68, 70])]]);
    const zip = await createBackup([nb], async (id) => store.get(id));
    expect(isBackup(zip)).toBe(true);
    expect(isBackup(zipSync({ "a.goodnotes": new Uint8Array([1]) }))).toBe(false);

    // Into an empty app: everything comes back.
    const fresh = restoreBackup(zip, []);
    expect(fresh.added).toBe(1);
    expect(fresh.notebooks[0].pages[0].strokes[0].id).toBe("old");
    expect([...fresh.attachments.get("pdf1")!]).toEqual([37, 80, 68, 70]);

    // Into an app where the page was edited later: the edit survives, a missing page returns.
    const live = structuredClone(nb);
    live.pages[0].strokes = [stroke("new", [pt(2, 2)])];
    live.pages[0].updatedAt = 200;
    const extra = newPage("blank", 150);
    const withExtra = { ...structuredClone(nb), pages: [...nb.pages, extra], updatedAt: 150 };
    const merged = restoreBackup(await createBackup([withExtra], async (id) => store.get(id)), [live]);
    expect(merged.updated).toBe(1);
    expect(merged.notebooks[0].pages[0].strokes[0].id).toBe("new");
    expect(merged.notebooks[0].pages.map((p) => p.id)).toContain(extra.id);
    expect(restoreBackup(zip, [live]).updated).toBe(0);
  });
});

describe("storage records", () => {
  it("splits notebooks into pages and joins them back in order", () => {
    const nb = newNotebook("x");
    nb.pages.push(newPage("grid"), newPage("blank"));
    const { meta, pages } = splitNotebook(nb);
    expect(meta.pages).toEqual([]);
    expect(pages).toHaveLength(3);
    const shuffled = [pages[2], pages[0], pages[1]].map(([, v]) => v);
    expect(joinNotebooks([meta], shuffled)).toEqual([nb]);
    // Old records with inline pages still load.
    expect(joinNotebooks([nb], [])).toEqual([nb]);
  });
});

describe("search", () => {
  it("finds typed text, PDF text and handwriting, ignoring case and accents", () => {
    const nb = newNotebook("x");
    const [p1] = nb.pages;
    p1.texts = [{ id: "t", x: 10, y: 20, width: 300, text: "Größe der Kraft", fontSize: 20, color: "#000" }];
    const p2 = { ...newPage("blank"), background: { attachment: "a", page: 3 } };
    const p3 = newPage("lined");
    nb.pages.push(p2, { ...newPage("blank"), deleted: true }, p3);
    const index = new Map<string, IndexEntry>([
      [pdfKey(p2)!, { key: pdfKey(p2)!, at: 0, runs: [{ text: "Newtonsche ", x: 1, y: 2, w: 3, h: 4 }, { text: "Gesetze", x: 5, y: 2, w: 3, h: 4 }] }],
      [inkKey(p3), { key: inkKey(p3), at: p3.updatedAt, runs: [{ text: "Impulserhaltung", x: 7, y: 8, w: 9, h: 10 }] }],
    ]);
    expect(searchNotebook(nb, "GROSSE", index).map((h) => h.index)).toEqual([0]);
    expect(searchNotebook(nb, "grosse", index).map((h) => h.index)).toEqual([0]);
    expect(searchNotebook(nb, "größe", index).map((h) => h.index)).toEqual([0]);
    expect(searchNotebook(nb, "kräft", index).map((h) => h.index)).toEqual([0]);
    // Across PDF text fragments.
    const pdf = searchNotebook(nb, "newtonsche gesetze", index);
    expect(pdf.map((h) => h.index)).toEqual([1]);
    expect(pdf[0].boxes.length).toBeGreaterThan(0);
    // Deleted pages do not count towards the page number.
    const ink = searchNotebook(nb, "impuls", index);
    expect(ink.map((h) => h.index)).toEqual([2]);
    expect(ink[0].boxes[0]).toMatchObject({ x: 7, y: 8 });
    expect(ink[0].snippet).toBe("Impulserhaltung");
    expect(normalize("Ärger  über")).toBe("arger uber");
  });
});
