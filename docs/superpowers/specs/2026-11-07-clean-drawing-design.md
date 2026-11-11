# Maxsen Planner: Clean drawing from site photos — Design

Date: 2026-11-07
Status: Approved 2026-11-11 (owner: "go build the clean drawing now")
Repos: `hexxcheang/maxsen-planner` (the work), `hexxcheang/homeassistantintegration` (consumes the
result). Feeds: `2026-11-07-maxsen-3d-view-design.md` (needs the rooms layer defined here).

## Why

Most plans Maxsen marks up are photos of the developer's floor plan taken on site: grey, grainy,
handwriting over them (see "17 Dairy Farm 01-04"). On the wall panel and in the customer's PDF they
look rough, and nothing in them is data: no walls, no rooms, no scale. The owner wants every home to
end up with a **realistic, nice** clean plan: the real walls (angled walls, odd corners, bay windows
included), doors with their swings, windows, the fixtures the plan shows (toilets, basins, baths,
kitchen counters, wardrobes), room names, in a Maxsen style. The same data gives Home Assistant the
rooms and walls its 3D view needs.

The planner already does half of this for Magic Plan: Claude's vision reads the photo into rooms
(as boxes), doors and windows, and staff check it in the Rooms step. This project upgrades that
reading from boxes to real outlines and turns the checked result into a drawing and data.

## Users

- **Maxsen staff** in the planner: run the reading, correct what's off, approve. A minute or two per
  home, not a redraw.
- **Customers** see the result on the PDF, the wall panel (2D and 3D) and phones.
- **Installers** work on the clean plan in Installer mode as today.

## Goals

1. **Read the photo into real outlines.** The vision reading returns, per room, its true outline as
   a polygon (not a box), plus doors (hinge end, latch end, which room the leaf swings into), windows
   (two ends on the wall), **fixtures** (type and footprint) and the scale. Rooms get their name and
   type as today.
2. **Carpentry and furniture are part of the plan** (owner, 2026-11-07). The reading also picks
   up what the plan draws; staff add, move, turn and resize the rest from a built-in library with
   standard Singapore sizes. Two kinds:
   - **Carpentry (built-ins):** wardrobe, kitchen base and wall cabinets, island, TV console and
     feature wall, study table, vanity, shoe cabinet, bay-window seat, bedhead panel, storage
     platform bed, bomb-shelter shelving.
   - **Loose furniture and appliances:** bed (single/queen/king), bedside tables, sofa (2/3-seat,
     L-shape), coffee table, dining table with chairs, fridge, washer/dryer, dining pendant spot.
   Each item has a type, position, rotation, width, depth and height (defaults from the library),
   and the room it is in. Furniture is drawn on the clean plan as plan symbols, carried to Home
   Assistant for the 3D view, and used by Magic Plan in place of the bed, sofa and TV it guesses
   today, so lights follow the real layout.
3. **Staff correct it in seconds.** The outlines are laid over the photo. Staff drag any corner,
   add or delete a corner, split or merge rooms, add a missed door or window, rename a room. A dragged
   corner **snaps to the nearest wall line in the photo**, so corrections land exactly on the wall.
   The existing room list and presets (Singapore flat types) still seed the room names.
4. **A clean drawing in Maxsen style**, generated from the checked outlines: walls with thickness
   (outer walls thicker), door leaves with swing arcs, windows as glazed wall sections, fixture
   symbols, room names, optional dimensions. It becomes the **background of both plans of the level**
   (Smart Home and Lighting) in place of the photo, so the editor, the PDF export and Home Assistant
   all show it. The photo stays available as a faint **underlay toggle** in the editor for checking.
5. **Devices stay put.** The clean drawing is rendered in the photo's own frame (same width, height
   and crop), so every marker, strip and curtain already placed keeps its coordinates. Re-running
   the reading or editing outlines never moves a device.
6. **The home package carries the data**: the optional `rooms` layer per level, exactly as the 3D
   design fixes it (`scale`, `wallHeight`, `rooms[]` with `polygon`, `walls[]`, `openings[]`), plus
   `furniture[]` (`{ id, type, roomId, x, y, rotation, width, depth, height, builtIn }` in plan
   units and metres), in plan units, plus the clean drawing as the level's background image.
7. **Magic Plan keeps working.** It plans from boxes today; it receives each polygon's main
   rectangle and extra parts derived automatically, so its rules need no change in this project.

## Non-goals

- Furniture outside the library (a custom piece is placed as a generic box with a name).
- Quoting or selling carpentry: the furniture is for the drawing, the 3D and lighting placement,
  not a renovation quote.
- Tracing walls by computer vision alone (see *Approaches*).
- Curved walls as true curves: they become short straight segments, which is fine for a plan.
- The 3D view itself (separate design).
- Changing how devices are placed (Magic Plan) or priced.

## Anti-goals

- A clean drawing that silently differs from the real plan. Staff must see outline and photo together
  before approving; nothing is published without that step.
- Moving or losing any placed device when the drawing is generated or regenerated.
- Making staff redraw a home from scratch when the reading is poor: correction must always be
  cheaper than redrawing.
- Sending anything new to the vision model beyond what Magic Plan already sends (the plan image).

## Constraints

- Planner rules (`AGENTS.md`): never push to `main`, use PRs, don't touch `apps/server/src/jiaxin/`,
  Prettier only on changed files, no secrets.
- The vision reading uses the planner's existing Anthropic client and model (`claude-opus-5-5`) and
  the existing `/api/magic-plan/analyse` route, extended; same cost controls and status checks.
- The planner's drawings are 1000 plan units wide, height in proportion; element coordinates are in
  those units. The clean drawing must be rendered at the photo's pixel size and aspect.
- Singapore homes: HDB and condo; mostly straight walls, some splays and bays.

## How it works

### Reading (vision)

The analysis schema (`packages/domain/src/magic/analysis.ts`) gains outlines and fixtures:

- `rooms[].outline: [{x, y}, …]` as fractions of the image, following the **inside faces** of the
  walls, corners in order. The box (`x, y, w, h`) stays, computed from the outline, for Magic Plan.
- `fixtures[]: { id, type, roomId, outline | (box + rotation) }` for sanitary and kitchen fixtures
  drawn on the plan (`wc`, `basin`, `bath`, `shower`, `sink`, `hob`), and `furniture[]` with the
  same shape for carpentry and furniture the plan shows, typed from the library list above; only
  what is drawn. Staff add the rest in the editor.
- Doors and windows as today (hinge/latch, swing side; window ends), plus `walls[]` for partitions
  that are not room edges (a half wall, a kitchen peninsula) and `thickness` hints where the plan
  shows them.
- `imageWidthMetres` as today; the floor area entered by staff refines the scale.

The prompt asks for inside-face outlines with every corner, and says that a wall shared by two rooms
appears in both outlines a wall-thickness apart. The server validates, repairs small slips as today,
and rejects a reading with no usable rooms.

### Correction (planner editor)

The Rooms step becomes an **Outlines step**: the photo underneath, each room a translucent polygon
with handles. Tools: drag corner, add corner (tap an edge), delete corner, draw a new room, delete a
room, merge two rooms, door tool (tap hinge then latch), window tool (drag along a wall), fixture
tool (pick type, drag a box), **furniture tool** (pick a library item: it drops at its standard size,
then drag to move, handles to turn and resize, snap to walls and to other furniture edges), rename. Snap: a dragged corner within 12 px of a dark line in the photo
snaps to it (local line search in the image; a toggle turns it off). Orthogonal snap at 0°/90° within
3° unless Shift is held. Undo/redo. A "Compare" slider fades between photo and clean drawing before
approval.

### Clean drawing (renderer)

A pure function in `packages/domain` from the checked analysis to SVG, rendered to a PNG (and kept as
SVG) at the photo's size: walls built by offsetting each room outline outwards by half the wall
thickness and merging (outer walls 0.2 m, inner 0.1 m, from the scale); openings cut through the
wall; door leaf and quarter arc on the swing side; windows as three thin lines; fixture and furniture symbols
from a built-in set (plan-view symbols: bed with pillows, sofa, dining table with chairs, wardrobe
with the diagonal cross, kitchen cabinets with the worktop line, and so on); room name centred, with the floor area under it; light grey fill per room; a
Maxsen style sheet (colours, line weights, fonts) shared with the PDF export. Dimension lines are
optional (off by default).

### Where it goes

- The rendered drawing is saved as a planner file and set as the background of **both** plans of the
  level with the photo's crop and rotation, keeping `width`/`height`, so coordinates are unchanged.
  The photo file is kept and referenced as `underlay` on the plans.
- The home package builder adds `level.rooms` (polygons, walls, openings converted to plan units;
  `scale` in metres per unit; `wallHeight` default 2.6) and `level.furniture` and embeds the clean drawing as the level's
  image. Home Assistant's "Refresh from planner" then shows the clean plan with every device where it
  was; the 3D option appears for that level.
- The PDF export uses the clean background automatically (it draws whatever the plan's background
  is).

### Compatibility

- Projects without an outline keep their photo; nothing changes for them.
- Magic Plan reads `rooms[].x/y/w/h` and `parts`, derived from the outline (largest inscribed
  rectangle plus the remaining parts); its tests get fixtures with outlines to prove the derivation.
- The home package schema version stays 1; `rooms` and `underlay` are optional.

## Decisions from the builder check *(Claude's calls; the owner can override)*

1. **One geometry for the package: wall centrelines.** The vision reading and the editor work with
   inside-face outlines (what a person sees on the photo). The planner's package builder turns them
   into what Home Assistant gets: `rooms[].polygon` on the **wall centrelines**, so neighbouring
   rooms really share edges, and `walls[]` listing **every** wall segment with its thickness (outer
   0.2 m, inner 0.1 m, or the plan's hint). The 3D draws slabs from the polygons and walls from
   `walls[]`; it never derives walls itself. (The 3D design is updated to say so.) Reconciling
   neighbours (edges within a wall thickness of each other become one shared edge) is a builder
   step in the planner with its own tests. The photo is **not** carried to Home Assistant: no
   `underlay` in the package.
2. **Only when both plans of a level share a background.** The clean drawing is offered for a level
   only when its Smart Home and Lighting plans have the same background key (same page, crop and
   rotation). Otherwise the planner says "Give both plans the same drawing in Setup first" and
   offers the shortcut that exists there. Outlines are stored once per level, tied to that
   background key. This matches the 3D design's decision 1 and Home Assistant's existing guard.
3. **"Approve drawing" is its own action.** The outline editor is shared: it is step 1 of Magic
   Plan as today, and it has an **Approve drawing** button that generates and sets the clean
   background. Running Magic Plan never changes a background. Existing projects' box layouts become
   4-point polygons (extra parts merged in) and can be corrected and approved without a new vision
   reading; the "find rooms for me" path and the built-in samples work the same way. The old box
   editor is replaced, not kept.
4. **Changing the page, crop or rotation after approval is blocked; "Back to the photo" is
   supported.** A plan with a clean drawing marks its background as derived from the photo. Setup
   greys out crop and rotation for it with "Go back to the photo first". *Back to the photo*
   restores the photo as the background, keeps outlines and devices (same frame), and the next
   "Refresh from planner" in Home Assistant drops the rooms layer, so the 3D option disappears for
   that level until the drawing is approved again.

## Approaches considered

1. **Vision reads real outlines, staff correct with snap-to-line.** Chosen. Builds on the reading
   and the Rooms step that exist; a person checks every plan; fixtures give the realistic look.
2. **Computer-vision wall tracing** (edge detection, line fitting). Precise on clean scans, fails on
   grainy site photos, handwriting and furniture lines; big effort to harden. A small piece survives
   as the snap-to-line helper.
3. **Keep boxes, draw them nicely.** Cheapest, not realistic: splayed walls and bays become boxes.
   Rejected by the owner ("realistic and nice").

## Left to the builder

- The snap-to-line search (window size, line scoring), the polygon editor's hit areas on touch.
- The fixture symbol set's drawings and the exact style tokens, within "Maxsen style": calm, thin
  dark lines on white, light grey room fills, the planner's existing fonts.
- The largest-rectangle derivation for Magic Plan, and how Magic Plan's bed/sofa/TV rules read the
  placed furniture (a placed item wins over the guess; the guess fills in when nothing is placed).
- The furniture library's exact list and default sizes (start from the list in goal 2 and common
  Singapore sizes), and the symbol drawings.
- Prompt wording for the vision reading.
