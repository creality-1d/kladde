# Goodnotes 6 archive format (`.goodnotes`)

This describes what Inknotes reads from Goodnotes 6 exports. It was derived only
from exported archives of the user's own documents, to make them importable
(interoperability). No Goodnotes code is used or reproduced.

Observed: three archives exported in November 2026, schema versions 24 and 35.
Everything below is an observation or an inference from those samples; fields
not listed are unknown.

## Why the apps were not useful

- Android `com.goodnotes.android.app` 2.0.12 is a Trusted Web Activity that opens
  `https://web.goodnotes.com/` (androidbrowserhelper classes, `asset_statements`).
- Windows `GoodnotesWindows` 2.4.5.0 is a .NET 8 WinUI shell around WebView2 that
  loads `https://web.goodnotes.com` (string literals via `rea inspect-managed-members`);
  its on-demand resources are OpenVINO models.

The editor, file format code and sync logic are served by Goodnotes' web app,
so the archive format was analysed directly.

## Container

A ZIP archive:

| Entry                   | Content                                                  |
| ----------------------- | -------------------------------------------------------- |
| `schema.pb`             | protobuf `{1: schema version}`                           |
| `index.events.pb`       | document event stream (below)                            |
| `index.notes.pb`        | `{1: id, 2: "notes/<id>"}` per notes stream              |
| `index.attachments.pb`  | `{1: attachment id, 2: archive path}`; path may differ from id |
| `index.search.pb`       | handwriting-recognition index (not read)                 |
| `notes/<uuid>`          | element stream of one page                               |
| `attachments/<uuid>`    | PDFs (backgrounds, paper templates, imported documents)  |
| `thumbnail.jpg`         | first page preview                                       |

All `.pb` files and streams are sequences of varint-length-prefixed protobuf
messages. Many values are CRDT registers `{1: counter, 2: hash}`; message
headers carry `14: 5381` (djb2 seed) and `16: schema version`.

## Event stream records

Each record is `{1: id, <kind>: body}`. Kinds used by the importer:

| Kind | Meaning        | Fields                                                                   |
| ---- | -------------- | ------------------------------------------------------------------------ |
| 30   | document       | 1 id, 2.1 title                                                          |
| 2    | paper          | 2 paper id, 4 PDF attachment id, 5 PDF page (1-based), 8 size `{1: w, 2: h}`, 9 template name |
| 54   | page entry     | 2 entry id, 3.1 paper id, 4.1 fractional index (sort as strings)        |
| 3    | paper change   | 2 entry id, 3.1 new paper id                                             |
| 6    | attachment     | 1 id, 5 byte size                                                        |

A page's notes stream is `notes/<entry id + 1>` (UUID read as a 128-bit
integer); this held for every sample. A4 paper is 1091.3 × 1543.5 units.

## Notes stream elements

Revision headers (with field 16) alternate with elements; the importer keeps the
last element per id.

**Kind 7 – ink.** 2: LZ4 payload, 4: colour `{1 r, 2 g, 3 b, 4 a}` floats (missing
components are 0), 6: translation `{1 dx, 2 dy}`, 9: recognised shape
`{1: repeated {1 x, 2 y}, 5.2 shape kind, 15 width}`, 14: 1 = erased (geometry is
cleared). Alpha below 1 is a highlighter.

The payload is Apple `compression_lz4` (`bv41` / `bv4-` blocks, `bv4$` end). The
inflated record starts with `tpl\0`, a u32 size and a type signature, observed
always as `vuA(v)A(S(uu))A(S(uuuu))vA(f)`:

| Part            | Meaning                                         |
| --------------- | ----------------------------------------------- |
| `v`             | u16 layout version (2)                          |
| `u`             | f32 stroke width                                |
| `A(v)`          | u32 count, u16 per-point flags                  |
| `A(S(uu))`      | start point(s) `(x, y)`                         |
| `A(S(uuuu))`    | quadratic segments `(cx, cy, x, y)`             |
| `v`, `A(f)`     | u16 and an optional float list (empty in samples) |

**Kind 12 – page text paragraph.** 3: Cocoa RTF, 13: list-CRDT position (path of
`{1: digit (int64), 2: site}`), compared lexicographically. Paragraphs flow from
the top of the page; RTF `\fs` half-points equal page units. The importer
approximates the flow insets (left 117, right 44, top 50 units) from thumbnails.

**Kind 21 – text box.** 20.1 origin `{1 x, 2 y}`, 32.2 size `{1 w, 2 h}`,
32.5.1.40 default size, 32.1.2 LZ4 payload of runs `{1: text, 2: attributes}`,
attributes 3 colour and 40 size (−404 = inherit).

## Known gaps

- Mixed formatting inside one paragraph or text box (only the first run's style is used).
- Exact text metrics: line breaks can differ slightly from Goodnotes.
- Images, stickers, links, audio recordings and other element kinds were not
  present in the samples and are reported as `unsupportedElements`.
- Pressure data (`A(f)`) was empty in all samples; strokes import with constant width.
