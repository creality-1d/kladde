import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importGoodnotes, notesIdFor } from "./import";
import { comparePositions, rtfToParagraph, type Position } from "./text";
import { appleLz4, fields, messages } from "./wire";

describe("wire format", () => {
  it("decodes varint, fixed32 and length-delimited fields", () => {
    // field 1 varint 300, field 2 float 1.5, field 3 bytes "hi"
    const bytes = new Uint8Array([0x08, 0xac, 0x02, 0x15, 0x00, 0x00, 0xc0, 0x3f, 0x1a, 0x02, 0x68, 0x69]);
    const fs = fields(bytes);
    expect(fs.map((f) => f.f)).toEqual([1, 2, 3]);
    expect(fs[0].v).toBe(300);
    expect(fs[1].v).toBe(1.5);
    expect(new TextDecoder().decode(fs[2].v as Uint8Array)).toBe("hi");
  });

  it("splits varint-length-delimited message streams", () => {
    expect(messages(new Uint8Array([2, 8, 1, 1, 9])).map((m) => [...m])).toEqual([[8, 1], [9]]);
  });

  it("inflates Apple LZ4 frames with compressed and raw blocks", () => {
    // Token 0x31: 3 literals "abc", then a match at offset 3 of length 1 + 4 → "abcabcab".
    const lz4 = [0x31, 0x61, 0x62, 0x63, 0x03, 0x00];
    const frame = new Uint8Array([
      ...new TextEncoder().encode("bv41"), 8, 0, 0, 0, lz4.length, 0, 0, 0, ...lz4,
      ...new TextEncoder().encode("bv4-"), 2, 0, 0, 0, 0x78, 0x79,
      ...new TextEncoder().encode("bv4$"),
    ]);
    expect(new TextDecoder().decode(appleLz4(frame))).toBe("abcabcabxy");
  });
});

describe("identifiers and ordering", () => {
  it("derives the notes stream id as entry uuid + 1", () => {
    expect(notesIdFor("920FB2DA-1E28-4E73-856F-18A69974B8E2")).toBe("920FB2DA-1E28-4E73-856F-18A69974B8E3");
    expect(notesIdFor("00000000-0000-0000-0000-0000000000FF")).toBe("00000000-0000-0000-0000-000000000100");
  });

  it("orders list positions lexicographically by digit then site", () => {
    const p = (...xs: [number, number][]): Position => xs.map(([d, s]) => [BigInt(d), s]);
    const sorted = [p([2, 1]), p([1, 5], [0, 1]), p([1, 5]), p([-1, 0])].sort(comparePositions);
    expect(sorted).toEqual([p([-1, 0]), p([1, 5]), p([1, 5], [0, 1]), p([2, 1])]);
  });
});

describe("RTF paragraphs", () => {
  it("extracts text, size and weight from Cocoa RTF", () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl\f0\fswiss Helvetica;}{\colortbl;\red0\green0\blue0;}
\pard\f0\b\fs48 \'dcbersetzung \uc0\u968  Text\
}`;
    expect(rtfToParagraph(rtf)).toEqual({ text: "Übersetzung ψ Text", fontSize: 24, bold: true });
  });

  it("drops the duplicated list marker of \\listtext", () => {
    const rtf = String.raw`{\rtf1\ansi \ls1\ilvl0\fs36 {\listtext	\'95	}\'95	Punkt\
}`;
    expect(rtfToParagraph(rtf).text).toBe("•\tPunkt");
  });
});

// Real archives are not part of the repository. Point GOODNOTES_SAMPLES (e.g. test-samples) at a
// folder of .goodnotes files to run the importer against them.
const samples = process.env.GOODNOTES_SAMPLES;
describe.skipIf(!samples || !existsSync(samples))("sample archives", () => {
  const files = samples ? readdirSync(samples).filter((f) => f.endsWith(".goodnotes")) : [];
  it.each(files)("imports %s without warnings", (file) => {
    const { notebook, report } = importGoodnotes(new Uint8Array(readFileSync(join(samples!, file))));
    expect(report.warnings).toEqual([]);
    expect(report.unsupportedElements).toEqual({});
    expect(notebook.pages.length).toBeGreaterThan(0);
  });
});
