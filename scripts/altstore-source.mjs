// Builds the AltStore source (altstore.json) for an Kladde release. See docs/altstore.md.
//
//   node scripts/altstore-source.mjs --meta release/Kladde-0.1.0-unsigned.ipa.json \
//     --download-url https://…/Kladde-0.1.0-unsigned.ipa --icon-url https://…/icon.png \
//     --source-url https://…/altstore.json [--previous old-altstore.json] [--notes notes.txt] \
//     [--date 2026-11-13] --out release/altstore.json
//
// The --meta file is written by scripts/build-ipa.sh from the built app's Info.plist,
// so version, build number and bundle id always match the .ipa.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE_ID = "io.github.creality1d.kladde.source";
const TINT = "#2a6fdb";
const DESCRIPTION =
  "Handschriftliche Notizen mit Apple Pencil, synchronisiert über die eigene Nextcloud. " +
  "Öffnet Goodnotes-6-Dateien (.goodnotes), damit bestehende Notizen mitkommen. " +
  "Liniert, kariert, gepunktet, PDF-Hintergründe, Lasso, Formen, Textfelder, Bilder und Export als PDF.";

/**
 * @param {object} input
 * @param {{ info: Record<string, unknown>, size: number, sha256: string }} input.meta
 * @param {string} input.downloadURL
 * @param {string} input.iconURL
 * @param {string} input.sourceURL
 * @param {string} input.date ISO date of the release
 * @param {string} [input.notes] what changed in this version
 * @param {any} [input.previous] the currently published source, whose versions are kept
 */
export function buildSource({ meta, downloadURL, iconURL, sourceURL, date, notes, previous }) {
  const info = meta.info;
  const field = (key) => {
    const value = info[key];
    if (typeof value !== "string" || !value) throw new Error(`Info.plist hat kein ${key}`);
    return value;
  };
  const bundleIdentifier = field("CFBundleIdentifier");
  const version = {
    version: field("CFBundleShortVersionString"),
    buildVersion: field("CFBundleVersion"),
    date,
    localizedDescription: notes?.trim() || `Kladde ${field("CFBundleShortVersionString")}`,
    downloadURL,
    size: meta.size,
    sha256: meta.sha256,
    minOSVersion: field("MinimumOSVersion"),
  };
  const previousApp = previous?.apps?.find((app) => app.bundleIdentifier === bundleIdentifier);
  // Newest first; a rebuilt release replaces its own entry.
  const older = (previousApp?.versions ?? []).filter((v) => !(v.version === version.version && v.buildVersion === version.buildVersion));
  const privacy = Object.fromEntries(Object.entries(info).filter(([key, value]) => /^NS\w+UsageDescription$/.test(key) && typeof value === "string"));
  return {
    name: "Kladde",
    identifier: SOURCE_ID,
    sourceURL,
    subtitle: "Handschriftliche Notizen mit Nextcloud-Sync",
    description: DESCRIPTION,
    iconURL,
    tintColor: TINT,
    apps: [
      {
        name: field("CFBundleDisplayName"),
        bundleIdentifier,
        developerName: "Kladde",
        subtitle: "Notizen mit Apple Pencil und Nextcloud",
        localizedDescription: DESCRIPTION,
        iconURL,
        tintColor: TINT,
        category: "productivity",
        screenshots: previousApp?.screenshots ?? [],
        versions: [version, ...older],
        appPermissions: { entitlements: [], privacy },
      },
    ],
    news: previous?.news ?? [],
  };
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) throw new Error(`Unerwartetes Argument: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  for (const key of ["meta", "download-url", "icon-url", "source-url", "out"]) {
    if (!args[key]) throw new Error(`--${key} fehlt`);
  }
  // Omit --previous only for the first release; a broken file fails instead of dropping history.
  const previous = args.previous ? JSON.parse(readFileSync(args.previous, "utf8")) : undefined;
  const source = buildSource({
    meta: JSON.parse(readFileSync(args.meta, "utf8")),
    downloadURL: args["download-url"],
    iconURL: args["icon-url"],
    sourceURL: args["source-url"],
    date: args.date ?? new Date().toISOString().slice(0, 10),
    notes: args.notes ? readFileSync(args.notes, "utf8") : undefined,
    previous,
  });
  writeFileSync(args.out, `${JSON.stringify(source, null, 2)}\n`);
  console.log(`${args.out}: ${source.apps[0].versions.length} Version(en), neueste ${source.apps[0].versions[0].version} (${source.apps[0].versions[0].buildVersion})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
