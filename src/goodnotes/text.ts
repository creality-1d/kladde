// Text elements of the Goodnotes 6 archive: RTF paragraphs of the page text
// flow (kind 12) and free text boxes (kind 21).
import { appleLz4, fields, pick, type Field } from "./wire";

const cp1252 = new TextDecoder("windows-1252");

export interface RtfParagraph {
  text: string;
  /** Font size in points (RTF \fs is in half-points). */
  fontSize: number;
  bold: boolean;
}

/** Extracts plain text and the leading run's size and weight from Cocoa RTF. */
export function rtfToParagraph(rtf: string): RtfParagraph {
  let depth = 0;
  let skipDepth = -1;
  let text = "";
  let fontSize = 12;
  let bold = false;
  let sawText = false;
  // \ucN: number of fallback characters that follow each \uN escape.
  let fallback = 1;
  let skipChars = 0;
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i];
    if (c === "{") {
      depth++;
      // Destination groups (font and colour tables, \*\expandedcolortbl …) hold no
      // text; \listtext repeats the list marker that the paragraph already contains.
      if (skipDepth < 0 && /^\{\\(\*|fonttbl|colortbl|stylesheet|info|listtext)/.test(rtf.slice(i, i + 12))) skipDepth = depth;
      continue;
    }
    if (c === "}") {
      if (depth === skipDepth) skipDepth = -1;
      depth--;
      continue;
    }
    if (c === "\\") {
      const next = rtf[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        if (skipDepth < 0) text += next;
        i++;
      } else if (next === "\n") {
        if (skipDepth < 0) text += "\n";
        i++;
      } else if (next === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16);
        i += 3;
        if (skipChars > 0) skipChars--;
        else if (skipDepth < 0) text += cp1252.decode(new Uint8Array([code]));
      } else {
        const m = /^\\([a-z]+)(-?\d+)? ?/.exec(rtf.slice(i));
        if (!m) continue;
        i += m[0].length - 1;
        if (skipDepth >= 0) continue;
        const [, word, arg] = m;
        if (word === "par" || word === "line") text += "\n";
        else if (word === "tab") text += "\t";
        else if (word === "uc" && arg) fallback = Number(arg);
        else if (word === "u" && arg) {
          text += String.fromCharCode(Number(arg) < 0 ? Number(arg) + 65536 : Number(arg));
          skipChars = fallback;
        }
        else if (!sawText && word === "fs" && arg) fontSize = Number(arg) / 2;
        else if (!sawText && word === "b") bold = arg !== "0";
      }
      continue;
    }
    if (skipDepth >= 0 || c === "\n" || c === "\r") continue;
    if (skipChars > 0) {
      skipChars--;
      continue;
    }
    text += c;
    sawText = true;
  }
  return { text: text.replace(/\n+$/, ""), fontSize, bold };
}

/** A list-CRDT position: a path of (digit, site) pairs compared lexicographically. */
export type Position = [bigint, number][];

function signed64(value: number | undefined): bigint {
  // Varints arrive as doubles; 2^64 − 1 encodes −1.
  if (value === undefined) return 0n;
  return value >= 2 ** 63 ? BigInt(Math.round(value - 2 ** 64)) : BigInt(value);
}

export function position(body: Field[]): Position {
  return body
    .filter((x) => x.f === 13 && x.wt === 2)
    .flatMap((x) => fields(x.v as Uint8Array))
    .filter((x) => x.f === 1 && x.wt === 2)
    .map((x) => fields(x.v as Uint8Array))
    .map((p) => [signed64(pick.number(p, 1)), pick.number(p, 2) ?? 0]);
}

export function comparePositions(a: Position, b: Position): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i][0] !== b[i][0]) return a[i][0] < b[i][0] ? -1 : 1;
    if (a[i][1] !== b[i][1]) return a[i][1] - b[i][1];
  }
  return a.length - b.length;
}

export interface FreeText {
  x: number;
  y: number;
  width: number;
  text: string;
  fontSize: number;
  color: string;
}

function hex(rgba: Field[]): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(1, pick.number(rgba, n) ?? 0)) * 255).toString(16).padStart(2, "0");
  return `#${c(1)}${c(2)}${c(3)}`;
}

/** Kind 21: a positioned text box whose runs are LZ4-compressed protobuf. */
export function freeText(body: Field[]): FreeText | undefined {
  const origin = pick.message(pick.message(body, 20) ?? [], 1);
  const content = pick.message(body, 32);
  const blob = content && pick.bytes(pick.message(content, 1) ?? [], 2);
  if (!origin || !blob) return undefined;
  const runs = fields(appleLz4(blob))
    .filter((x) => x.f === 1 && x.wt === 2)
    .map((x) => fields(x.v as Uint8Array));
  const box = pick.message(content, 2);
  const style = pick.message(pick.message(content, 5) ?? [], 1);
  // Run attributes: field 3 colour (RGBA floats), field 40 size; −404 means "inherit".
  const attributes = pick.message(runs[0] ?? [], 2) ?? [];
  const runSize = pick.number(attributes, 40);
  const styleSize = style && pick.number(style, 40);
  const rgba = pick.message(attributes, 3);
  return {
    x: pick.number(origin, 1) ?? 0,
    y: pick.number(origin, 2) ?? 0,
    width: (box && pick.number(box, 1)) ?? 400,
    text: runs.map((run) => pick.string(run, 1) ?? "").join(""),
    fontSize: runSize && runSize > 0 ? runSize : styleSize && styleSize > 0 ? styleSize : 24,
    color: rgba ? hex(rgba) : "#000000",
  };
}
