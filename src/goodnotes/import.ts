// Importer for Goodnotes 6 `.goodnotes` archives (schema 24 and 35 observed).
// Derived from the archive contents only; see docs/goodnotes-format.md.
import { unzipSync } from "fflate";
import { newId, PAGE_WIDTH, type Notebook, type Page, type Point, type Stroke, type TextBox } from "../model";
import { comparePositions, freeText, position, rtfToParagraph, type Position, type RtfParagraph } from "./text";
import { appleLz4, fields, messages, pick, type Field } from "./wire";

const STROKE_SIGNATURE = "vuA(v)A(S(uu))A(S(uuuu))vA(f)";
const CURVE_SAMPLES = 4;

export interface ImportReport {
  pages: number;
  strokes: number;
  /** Strokes that Goodnotes stored as recognised shapes (lines, polygons). */
  shapes: number;
  /** Erased elements kept by Goodnotes as tombstones; they are not imported. */
  erased: number;
  /** Text boxes and page-flow paragraphs. */
  texts: number;
  unsupportedElements: Record<string, number>;
  warnings: string[];
}

interface PaperRecord {
  id: string;
  pdf?: string;
  /** 1-based page of the PDF attachment (field 5). */
  pdfPage?: number;
  width: number;
  height: number;
}

interface StrokeGeometry {
  width: number;
  start: [number, number];
  curves: [number, number, number, number][];
}

/** Decodes the "tpl" stroke payload: a self-describing little-endian record. */
function decodeStroke(raw: Uint8Array): StrokeGeometry {
  const sigEnd = raw.indexOf(0, 8);
  const signature = new TextDecoder().decode(raw.subarray(8, sigEnd));
  if (signature !== STROKE_SIGNATURE) throw new Error(`unknown stroke layout ${signature}`);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let o = sigEnd + 1;
  const u16 = () => ((o += 2), dv.getUint16(o - 2, true));
  const u32 = () => ((o += 4), dv.getUint32(o - 4, true));
  const f32 = () => ((o += 4), dv.getFloat32(o - 4, true));
  u16(); // layout version
  const width = f32();
  const flagCount = u32();
  o += flagCount * 2; // per-point flags
  const starts: [number, number][] = [];
  for (let n = u32(); n > 0; n--) starts.push([f32(), f32()]);
  const curves: [number, number, number, number][] = [];
  for (let n = u32(); n > 0; n--) curves.push([f32(), f32(), f32(), f32()]);
  if (starts.length === 0) throw new Error("freehand stroke without start point");
  return { width, start: starts[0], curves };
}

function samplePoints(g: StrokeGeometry, dx: number, dy: number, scale: number): Point[] {
  const points: Point[] = [];
  let [x0, y0] = g.start;
  const push = (x: number, y: number) => points.push({ x: (x + dx) * scale, y: (y + dy) * scale, p: 0.5 });
  push(x0, y0);
  for (const [cx, cy, x1, y1] of g.curves) {
    for (let i = 1; i <= CURVE_SAMPLES; i++) {
      const t = i / CURVE_SAMPLES;
      const u = 1 - t;
      push(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
    }
    x0 = x1;
    y0 = y1;
  }
  return points;
}

/**
 * Decodes one ink element (kind 7). Freehand strokes carry an LZ4 "tpl" curve
 * payload; recognised shapes carry an empty curve and a point list in field 9.
 * Field 6 is a translation applied after the element was moved.
 */
function decodeInkElement(body: Field[], scale: number, report: ImportReport): Stroke | undefined {
  // Field 14 = 1 marks an erased element; erasing also clears its geometry.
  if (pick.number(body, 14) === 1) {
    report.erased++;
    return undefined;
  }
  const blob = pick.bytes(body, 2);
  if (!blob || blob.length === 0) return undefined;
  const offset = pick.message(body, 6) ?? [];
  const dx = pick.number(offset, 1) ?? 0;
  const dy = pick.number(offset, 2) ?? 0;
  const color = rgba(pick.message(body, 4));
  const highlighter = color.alpha < 0.99;
  const shape = pick.message(body, 9);
  let width: number;
  let points: Point[];
  if (shape && shape.length > 0) {
    const vertices = pick.message(shape, 1) ?? [];
    points = vertices
      .filter((v) => v.f === 1 && v.wt === 2)
      .map((v) => fields(v.v as Uint8Array))
      .map((xy) => ({ x: ((pick.number(xy, 1) ?? 0) + dx) * scale, y: ((pick.number(xy, 2) ?? 0) + dy) * scale, p: 0.5 }));
    width = pick.number(shape, 15) ?? 1.5;
    report.shapes++;
  } else {
    const geometry = decodeStroke(appleLz4(blob));
    points = samplePoints(geometry, dx, dy, scale);
    width = geometry.width;
  }
  if (points.length === 0) return undefined;
  return {
    id: newId(),
    tool: highlighter ? "highlighter" : "pen",
    color: color.hex,
    width: (highlighter ? width / 4 : width) * scale,
    points,
  };
}

function rgba(color: Field[] | undefined): { hex: string; alpha: number } {
  const c = (n: number) => (color && pick.number(color, n)) ?? 0;
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return { hex: `#${to(c(1))}${to(c(2))}${to(c(3))}`, alpha: color ? c(4) : 1 };
}

/** The payload of a stream entry: the first length-delimited field after the id. */
function payload(message: Uint8Array): { kind: number; body: Field[]; header: Field[] } | undefined {
  const top = fields(message);
  const entry = top.find((x) => x.wt === 2 && x.f !== 1);
  if (!entry || entry.wt !== 2) return undefined;
  try {
    return { kind: entry.f, body: fields(entry.v), header: top };
  } catch {
    return undefined;
  }
}

export interface ImportOptions {
  fallbackTitle?: string;
}

/** The notes stream of a page entry is named by the entry UUID plus one (observed in every sample). */
export function notesIdFor(entryId: string): string {
  const hex = entryId.replace(/-/g, "");
  const next = (BigInt(`0x${hex}`) + 1n) & ((1n << 128n) - 1n);
  const h = next.toString(16).toUpperCase().padStart(32, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface PageEntry {
  id: string;
  /** Fractional index; entries sort by plain string order. */
  index: string;
  paper?: string;
}

export function importGoodnotes(bytes: Uint8Array, options: ImportOptions = {}): { notebook: Notebook; attachments: Map<string, Uint8Array>; report: ImportReport } {
  const files = unzipSync(bytes);
  const report: ImportReport = { pages: 0, strokes: 0, shapes: 0, erased: 0, texts: 0, unsupportedElements: {}, warnings: [] };
  const events = files["index.events.pb"];
  if (!events) throw new Error("not a Goodnotes 6 archive: index.events.pb is missing");

  let title = options.fallbackTitle ?? "Import";
  // Papers (kind 2) carry size and background; page entries (kind 54) carry
  // order and the paper in use, which kind 3 later replaces.
  const papers = new Map<string, PaperRecord>();
  const entries = new Map<string, PageEntry>();

  for (const message of messages(events)) {
    const entry = payload(message);
    if (!entry) continue;
    const { kind, body } = entry;
    if (kind === 30) {
      title = pick.string(pick.message(body, 2) ?? [], 1) ?? title;
    } else if (kind === 2) {
      const id = pick.string(body, 2);
      const size = pick.message(body, 8);
      if (!id || !size) continue;
      const previous = papers.get(id);
      papers.set(id, {
        id,
        pdf: pick.string(body, 4) ?? previous?.pdf,
        pdfPage: pick.number(body, 5) ?? previous?.pdfPage,
        width: pick.number(size, 1) ?? previous?.width ?? 1091,
        height: pick.number(size, 2) ?? previous?.height ?? 1543,
      });
    } else if (kind === 54 || kind === 3) {
      const id = pick.string(body, 2);
      if (!id) continue;
      const previous = entries.get(id);
      entries.set(id, {
        id,
        index: pick.string(pick.message(body, 4) ?? [], 1) ?? previous?.index ?? "",
        paper: pick.string(pick.message(body, 3) ?? [], 1) ?? previous?.paper,
      });
    }
  }

  // index.attachments.pb maps attachment ids to archive paths; they can differ.
  const attachmentPaths = new Map<string, string>();
  for (const message of messages(files["index.attachments.pb"] ?? new Uint8Array())) {
    const record = fields(message);
    const id = pick.string(record, 1);
    const path = pick.string(record, 2);
    if (id && path) attachmentPaths.set(id, path);
  }

  const ordered = [...entries.values()].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  const notesFiles = Object.keys(files).filter((path) => path.startsWith("notes/"));
  const now = Date.now();
  const attachments = new Map<string, Uint8Array>();

  const resultPages: Page[] = ordered.map((entry) => {
    const paper = entry.paper ? papers.get(entry.paper) : undefined;
    if (!paper) report.warnings.push(`page ${entry.id}: paper ${entry.paper ?? "?"} not found; using A4`);
    const width = paper?.width ?? 1091.3;
    const height = paper?.height ?? 1543.5;
    const scale = PAGE_WIDTH / width;
    let path = `notes/${notesIdFor(entry.id)}`;
    if (!files[path] && ordered.length === 1 && notesFiles.length === 1) path = notesFiles[0];
    const { strokes, texts, paragraphs } = files[path] ? decodeNotes(path, files[path], scale, report) : EMPTY_NOTES;
    report.strokes += strokes.length;
    report.texts += texts.length + paragraphs.length;
    const pdf = paper?.pdf ? files[attachmentPaths.get(paper.pdf) ?? `attachments/${paper.pdf}`] : undefined;
    if (pdf && paper?.pdf) attachments.set(paper.pdf, pdf);
    return {
      id: newId(),
      template: "blank",
      strokes,
      updatedAt: now,
      width: PAGE_WIDTH,
      height: height * scale,
      background: pdf && paper?.pdf ? { attachment: paper.pdf, page: Math.max(0, (paper.pdfPage ?? 1) - 1) } : undefined,
      texts,
      flow: paragraphs.length
        ? {
            x: FLOW_INSET.left * scale,
            y: FLOW_INSET.top * scale,
            width: (width - FLOW_INSET.left - FLOW_INSET.right) * scale,
            paragraphs: paragraphs.map((p) => ({ ...p, fontSize: p.fontSize * scale })),
          }
        : undefined,
    };
  });
  report.pages = resultPages.length;
  return { notebook: { id: newId(), title, pages: resultPages, updatedAt: now }, attachments, report };
}

interface DecodedNotes {
  strokes: Stroke[];
  texts: TextBox[];
  paragraphs: RtfParagraph[];
}
const EMPTY_NOTES: DecodedNotes = { strokes: [], texts: [], paragraphs: [] };

/**
 * Page text flow insets in Goodnotes units. Measured from the thumbnails of the
 * samples (text starts right of the paper's margin rule); approximate.
 */
const FLOW_INSET = { left: 117, right: 44, top: 50 };

function decodeNotes(path: string, data: Uint8Array, scale: number, report: ImportReport): DecodedNotes {
  // Each element is preceded by a revision header (schema version in field 16);
  // the last revision of an element id wins.
  const strokes = new Map<string, Stroke | undefined>();
  const texts = new Map<string, TextBox>();
  const paragraphs = new Map<string, { at: Position; paragraph: RtfParagraph }>();
  for (const message of messages(data)) {
    const entry = payload(message);
    if (!entry || pick.number(entry.header, 16) !== undefined) continue;
    const { kind, body } = entry;
    const id = pick.string(body, 1);
    if (!id) continue;
    try {
      if (kind === 7) {
        strokes.set(id, decodeInkElement(body, scale, report));
      } else if (kind === 12) {
        const rtf = pick.string(body, 3);
        if (rtf) paragraphs.set(id, { at: position(body), paragraph: rtfToParagraph(rtf) });
      } else if (kind === 21) {
        const box = freeText(body);
        if (box)
          texts.set(id, {
            id: newId(),
            x: box.x * scale,
            y: box.y * scale,
            width: box.width * scale,
            text: box.text,
            fontSize: box.fontSize * scale,
            color: box.color,
          });
      } else {
        report.unsupportedElements[`kind${kind}`] = (report.unsupportedElements[`kind${kind}`] ?? 0) + 1;
      }
    } catch (error) {
      report.warnings.push(`${path}: element ${id}: ${(error as Error).message}`);
    }
  }
  return {
    strokes: [...strokes.values()].filter((stroke): stroke is Stroke => stroke !== undefined),
    texts: [...texts.values()],
    paragraphs: [...paragraphs.values()].sort((a, b) => comparePositions(a.at, b.at)).map((p) => p.paragraph),
  };
}
