import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { expandImport, joinFolder, notebookFromPdf } from "./bundle";
import { copySelection, eraseAt, pasteClip, recolorSelection, rotateSelection } from "./edit";
import { newNotebook, newPage, PAGE_WIDTH, visiblePages, type Point, type Stroke } from "./model";
import { duplicatePage, insertPage, insertPageAt, movePage, pageLike } from "./pages";
import { writePdf } from "./pdfwrite";
import { DEFAULTS, withDefaults } from "./settings";

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
