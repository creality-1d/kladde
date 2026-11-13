import { describe, expect, it } from "vitest";
import { mergeNotebook, newNotebook, newPage, type Notebook } from "./model";
import { mergeBack, syncNotebooks, type RemoteStore } from "./sync";

const clone = (nb: Notebook): Notebook => structuredClone(nb);

class MemoryRemote implements RemoteStore {
  files = new Map<string, string>();
  blobs = new Map<string, Uint8Array>();
  async getBinary(name: string) {
    return this.blobs.get(name)!;
  }
  async putBinary(name: string, body: Uint8Array) {
    this.blobs.set(name, body);
  }
  async ensureFolder() {}
  async list() {
    return [...this.files.keys(), ...this.blobs.keys()];
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

  it("copies PDF attachments to devices that lack them", async () => {
    const remote = new MemoryRemote();
    const nb = newNotebook("PDF", 1);
    nb.pages[0].background = { attachment: "pdf-1", page: 0 };
    const tablet = new Map([["pdf-1", new Uint8Array([37, 80, 68, 70])]]);
    const laptop = new Map<string, Uint8Array>();
    const store = (m: Map<string, Uint8Array>) => ({ get: async (id: string) => m.get(id), put: async (id: string, b: Uint8Array) => m.set(id, b) });
    await syncNotebooks([nb], remote, store(tablet));
    await syncNotebooks([], remote, store(laptop));
    expect([...(laptop.get("pdf-1") ?? [])]).toEqual([37, 80, 68, 70]);
  });
});

describe("mergeBack", () => {
  it("keeps edits and notebooks made while a sync ran", async () => {
    const remote = new MemoryRemote();
    const other = newNotebook("Remote", 1);
    remote.files.set(`${other.id}.kladde.json`, JSON.stringify(other));
    const nb = newNotebook("Live", 1);
    const live = [nb];
    const running = syncNotebooks(structuredClone(live), remote);
    // Meanwhile: a stroke on the live page and a new notebook.
    nb.pages[0].strokes.push({ id: "s", tool: "pen", color: "#000", width: 2, points: [] });
    nb.pages[0].updatedAt = nb.updatedAt = 5;
    const created = newNotebook("Neu", 6);
    live.push(created);
    const merged = mergeBack(live, await running);
    expect(merged.map((x) => x.title).sort()).toEqual(["Live", "Neu", "Remote"]);
    expect(merged.find((x) => x.id === nb.id)!.pages[0].strokes).toHaveLength(1);
  });
});
