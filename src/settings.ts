// Per-device preferences. They stay on the device and are not synced, like the
// tool and gesture settings of most note apps.
import type { EraserMode } from "./edit";
import type { PenType } from "./model";

export type PresetTool = "pen" | "highlighter" | "shape" | "text";

export interface ToolPreset {
  colors: [string, string, string];
  widths: [number, number, number];
  color: number;
  width: number;
}

export interface Settings {
  presets: Record<PresetTool, ToolPreset>;
  eraser: { mode: EraserMode; sizes: [number, number, number]; size: number };
  penType: PenType;
  /** Scribbling over ink with the pen erases it. */
  scribbleErase: boolean;
  /** Magnification of the zoom window relative to the page width. */
  zoomWindow: number;
  /** "auto": fingers draw until a stylus is used. "pen": only a stylus draws. "finger": fingers always draw. */
  penOnly: "auto" | "pen" | "finger";
  scroll: "vertical" | "horizontal";
  tapUndo: boolean;
  holdToShape: boolean;
  /** Apple Pencil double tap; "system" follows the iPad setting. */
  doubleTap: "system" | "eraser" | "previous" | "none";
  welcomeSeen: boolean;
  /** When the last full backup was made (ms), 0 for never. */
  lastBackup: number;
  /** Ids of notebooks open as tabs, in order. */
  tabs: string[];
  /** Last opening time per notebook id, for "Zuletzt". */
  opened: Record<string, number>;
  /** Folders created without a notebook in them yet. */
  folders: string[];
}

export const DEFAULTS: Settings = {
  presets: {
    pen: { colors: ["#1d2733", "#1f5fbf", "#c0392b"], widths: [2, 3, 6], color: 0, width: 1 },
    highlighter: { colors: ["#ffd43b", "#8ce99a", "#ff8fab"], widths: [3, 5, 8], color: 0, width: 1 },
    shape: { colors: ["#1d2733", "#1f5fbf", "#c0392b"], widths: [2, 3, 6], color: 0, width: 1 },
    text: { colors: ["#1d2733", "#1f5fbf", "#c0392b"], widths: [2, 3, 5], color: 0, width: 1 },
  },
  eraser: { mode: "stroke", sizes: [10, 20, 40], size: 1 },
  penType: "fountain",
  scribbleErase: true,
  zoomWindow: 2.5,
  penOnly: "auto",
  scroll: "vertical",
  tapUndo: true,
  holdToShape: true,
  doubleTap: "system",
  welcomeSeen: false,
  lastBackup: 0,
  tabs: [],
  opened: {},
  folders: [],
};

const KEY = "kladde.settings";

/** Fills in missing keys so settings from older versions keep working. */
export function withDefaults(raw: Partial<Settings> | undefined): Settings {
  const s = structuredClone(DEFAULTS);
  if (!raw || typeof raw !== "object") return s;
  for (const key of Object.keys(s) as (keyof Settings)[]) {
    if (raw[key] === undefined) continue;
    if (key === "presets") {
      for (const tool of Object.keys(s.presets) as PresetTool[]) Object.assign(s.presets[tool], raw.presets?.[tool]);
    } else if (key === "eraser") Object.assign(s.eraser, raw.eraser);
    else (s as unknown as Record<string, unknown>)[key] = raw[key];
  }
  return s;
}

export function loadSettings(): Settings {
  try {
    return withDefaults(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return withDefaults(undefined);
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Without storage the settings last until the app closes.
  }
}
