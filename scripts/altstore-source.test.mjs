import { describe, expect, it } from "vitest";
import { buildSource } from "./altstore-source.mjs";

const meta = (version, build) => ({
  info: {
    CFBundleIdentifier: "io.github.creality1d.kladde",
    CFBundleDisplayName: "Kladde",
    CFBundleShortVersionString: version,
    CFBundleVersion: build,
    MinimumOSVersion: "16.4",
    NSCameraUsageDescription: "Fotos aufnehmen",
    CFBundleName: "App",
  },
  size: 1234,
  sha256: "ab".repeat(32),
});
const urls = { iconURL: "https://x/icon.png", sourceURL: "https://x/altstore.json" };

describe("AltStore source", () => {
  it("describes the built app with its exact version, build and permissions", () => {
    const source = buildSource({ meta: meta("0.1.0", "9"), downloadURL: "https://x/a.ipa", date: "2026-11-13", notes: "Erste Version", ...urls });
    const app = source.apps[0];
    expect(app).toMatchObject({ name: "Kladde", bundleIdentifier: "io.github.creality1d.kladde", appPermissions: { entitlements: [], privacy: { NSCameraUsageDescription: "Fotos aufnehmen" } } });
    expect(app.versions).toEqual([
      { version: "0.1.0", buildVersion: "9", date: "2026-11-13", localizedDescription: "Erste Version", downloadURL: "https://x/a.ipa", size: 1234, sha256: "ab".repeat(32), minOSVersion: "16.4" },
    ]);
  });

  it("keeps earlier versions newest first and replaces a rebuilt one", () => {
    const first = buildSource({ meta: meta("0.1.0", "9"), downloadURL: "https://x/1.ipa", date: "2026-11-13", ...urls });
    const second = buildSource({ meta: meta("0.2.0", "12"), downloadURL: "https://x/2.ipa", date: "2026-11-20", previous: first, ...urls });
    expect(second.apps[0].versions.map((v) => v.version)).toEqual(["0.2.0", "0.1.0"]);
    const rebuilt = buildSource({ meta: meta("0.2.0", "12"), downloadURL: "https://x/2b.ipa", date: "2026-11-21", previous: second, ...urls });
    expect(rebuilt.apps[0].versions.map((v) => v.downloadURL)).toEqual(["https://x/2b.ipa", "https://x/1.ipa"]);
  });

  it("refuses an app without a version", () => {
    const broken = meta("0.1.0", "9");
    delete broken.info.CFBundleVersion;
    expect(() => buildSource({ meta: broken, downloadURL: "https://x/a.ipa", date: "2026-11-13", ...urls })).toThrow("CFBundleVersion");
  });
});
