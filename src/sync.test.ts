import { describe, expect, it } from "vitest";
import { mergeNotebook, newNotebook, newPage, type Notebook } from "./model";
import { syncNotebooks, type RemoteStore } from "./sync";

const clone = (nb: Notebook): Notebook => structuredClone(nb);

class MemoryRemote implements RemoteStore {
  files = new Map<string, string>();
  async ensureFolder() {}
  async list() {
    return [...this.files.keys()];
  }
  async get(name: string) {
    return this.files.get(name)!;
  }
  async put(name: string, body: string) {
    this.files.set(name, body);
  }
}

describe("mergeNotebook", () => {
  it("keeps edits made to different pages on two devices", () => {
    const base = newNotebook("A", 1);
    base.pages.push(newPage("grid", 1));
    const tablet = clone(base);
    const laptop = clone(base);
    tablet.pages[0].strokes.push({ id: "s1", tool: "pen", color: "#000", width: 2, points: [] });
    tablet.pages[0].updatedAt = 5;
    laptop.pages[1].strokes.push({ id: "s2", tool: "pen", color: "#000", width: 2, points: [] });
    laptop.pages[1].updatedAt = 6;

    const merged = mergeNotebook(tablet, laptop);
    expect(merged.pages.map((p) => p.strokes.map((s) => s.id))).toEqual([["s1"], ["s2"]]);
  });

  it("propagates page deletions as tombstones", () => {
    const base = newNotebook("A", 1);
    const other = clone(base);
    other.pages[0].deleted = true;
    other.pages[0].updatedAt = 9;
    expect(mergeNotebook(base, other).pages[0].deleted).toBe(true);
  });
});

describe("syncNotebooks", () => {
  it("converges two devices through the remote folder", async () => {
    const remote = new MemoryRemote();
    const a = newNotebook("Uni", 1);
    const b = newNotebook("Privat", 2);
    await syncNotebooks([a], remote);
    const onB = await syncNotebooks([b], remote);
    const onA = await syncNotebooks([a], remote);
    expect(onB.map((nb) => nb.title).sort()).toEqual(["Privat", "Uni"]);
    expect(onA.map((nb) => nb.title).sort()).toEqual(["Privat", "Uni"]);
    expect(remote.files.size).toBe(2);
  });
});
