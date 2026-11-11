# Clean Drawing from Site Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Maxsen Planner, turn a site photo of a floor plan into a checked, realistic clean drawing (real wall outlines, doors, windows, fixtures, carpentry and furniture) that replaces the photo as the plan background and travels to Home Assistant with room, wall and furniture data.

**Architecture:** The existing Magic Plan room layout (`RoomLayout`, boxes) is extended, not replaced: rooms gain an optional polygon outline, and the layout gains doors, partitions and placed items. Pure domain modules derive walls and render an SVG; the web app's Rooms step becomes a polygon "Outlines" editor with an Approve action that rasterises the SVG to a PNG and sets it as the background of both plans of the level. The home package builder adds an optional `rooms` and `furniture` layer per level.

**Tech Stack:** TypeScript, pnpm monorepo (`packages/domain`, `apps/web` React + Konva, `apps/server` Hono + Anthropic SDK), Vitest, Playwright e2e. Home Assistant repo: Python, pytest.

**Spec:** `docs/superpowers/specs/2026-11-07-clean-drawing-design.md` (this repo). The consumer's contract is in `docs/superpowers/specs/2026-11-07-maxsen-3d-view-design.md`, section *Input*.

**Repos and branches:** Tasks 1–12 are in `/home/user/maxsen-planner` on a new branch `claude/clean-drawing` cut from `origin/main`. Task 11's second half and Task 13 touch `/home/user/homeassistantintegration` on `claude/inspiring-brahmagupta-vu09jj`.

## Global Constraints

- Planner `AGENTS.md`: never push to `main`; never touch `apps/server/src/jiaxin/`; run Prettier only on files you change; no secrets; before finishing a task run `pnpm check` (typecheck, lint, unit tests); `pnpm build` and `pnpm e2e` before the branch is handed over.
- Coordinates in a layout are **fractions (0–1) of the drawing's width and height**, as today. Plan units are `x * 1000`, `y * 1000 / aspect` (`aspect` = background width / height).
- Outlines follow the **inside faces** of walls. The package gets **wall-centreline** polygons and a `walls[]` list (spec, decision 1).
- Wall thickness: outer 0.2 m, inner 0.1 m. Wall height default 2.6 m. When the drawing has no scale (`drawingWidthMetres` returns null), assume the drawing is 12 m wide.
- The vision reading uses the existing `/api/magic-plan/analyse` route, the existing Anthropic client and model `claude-opus-5-5`; nothing but the plan image (and the planner's notes, as today) is sent.
- Approving a drawing never changes any element's coordinates. Running Magic Plan never changes a background.
- The clean drawing is offered only when the level's Smart Home and Lighting plans share a background key; message otherwise: "Give both plans the same drawing in Setup first".
- Home package `schemaVersion` stays 1; every new field is optional.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_012p4UixNb3hUrzF8wGhShzc`. No model names elsewhere. Do not open pull requests.

## Review Focus

1. **A corner dragged across the room (self-intersecting outline) or an outline with fewer than 3 points.** The editor refuses the move (the corner springs back); geometry and renderer never throw on such input and skip that room.
2. **A level whose two plans have different background keys.** Approve is disabled with the Setup message; nothing is written to either plan.
3. **No scale** (floor area 0 or no rooms outlined). The drawing still renders, with walls at the 12 m-wide fallback.
4. **A legacy project** with only `plan.magicLayout` boxes (no outlines, tapped doors). It opens with 4-point (or L-shaped) polygons, and Magic Plan's result for it is unchanged.
5. **Approving twice** (after editing outlines). The photo is kept: `clean.photoFileId` still points at the photo, never at the previous clean drawing; *Back to the photo* restores the photo.

Each has a named test in the task that owns the code (Tasks 1, 3, 4, 7, 8, 10).

---

### Task 1: Layout model with polygon outlines

**Files:**
- Create: `packages/domain/src/magic/outline.ts`, `packages/domain/src/magic/outline.test.ts`
- Modify: `packages/domain/src/magic/room-layout.ts` (types, `drawingWidthMetres`, `analysisFromLayout`), `packages/domain/src/home-package/build.ts` (export `backgroundKey`), `packages/domain/src/index.ts` (exports)

**Interfaces — Produces:**
```ts
// room-layout.ts
export interface Pt { x: number; y: number }                 // fractions of the drawing
export interface DrawnDoor { id: string; hinge: Pt; latch: Pt; swingsInto: string | null } // room ids
export interface DrawnPartition { id: string; from: Pt; to: Pt; thickness?: number }       // metres
// DrawnRoom gains:  outline?: Pt[]   // inside faces, in order, not closed
// RoomLayout gains: doors?: DrawnDoor[]; partitions?: DrawnPartition[]; items?: PlacedItem[] (Task 2)

// outline.ts
export function outlineOf(room: DrawnRoom): Pt[];            // room.outline, else the union of its box and parts as one rectilinear polygon; [] when not drawn
export function withOutline(room: DrawnRoom, outline: Pt[]): DrawnRoom; // sets outline and derives x,y,w,h (largest inscribed axis-aligned rectangle) and parts (rectangles covering the rest)
export function isSimplePolygon(pts: Pt[]): boolean;         // >= 3 points, no self-intersection, area > 0
export function polygonArea(pts: Pt[]): number;              // in fraction² (positive)
export function pointInPolygon(p: Pt, pts: Pt[]): boolean;
// build.ts
export function backgroundKey(bg: PlanBackground): string;   // `${sourcePageId}|${rotation}|${crop.x},${crop.y},${crop.w},${crop.h}`
```
`drawingWidthMetres` and `floorOf` use `polygonArea(outlineOf(r))` when a room has an outline. `analysisFromLayout` uses `layout.doors` (hinge, latch, swingsInto, sides from the rooms whose outlines the door touches) when present, else today's tapped doors.

- [ ] **Step 1: Write the failing tests** in `outline.test.ts`:
  - `outlineOf` of a plain box returns its 4 corners clockwise from top-left.
  - `outlineOf` of a box `{0.1,0.1,0.4,0.2}` with part `{0.1,0.3,0.2,0.2}` returns the 6-corner L.
  - `withOutline(room, L)` for that L gives `x,y,w,h` = the larger rectangle and `partBoxes(room)` covering the rest: total area equals `polygonArea(L)` within 1e-6.
  - `withOutline` on a splayed quadrilateral `[(0.1,0.1),(0.5,0.1),(0.45,0.4),(0.1,0.4)]`: the box lies inside the polygon and box + parts cover at least 90 % of its area.
  - `isSimplePolygon` is false for 2 points, for a bow-tie, and for zero area. *(Review Focus 1)*
  - `drawingWidthMetres` for a layout whose only room is the L (93 m² preset, one listed room) matches the value computed from the L's area.
  - Legacy: `analysisFromLayout` of a layout with no `outline`/`doors` deep-equals a snapshot taken before this change (generate the snapshot from `main` first). *(Review Focus 4)*
- [ ] **Step 2: Run** `pnpm --filter @maxsen/domain exec vitest run src/magic/outline.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** `withOutline`: rasterise the polygon on a 96×96 grid over its bounding box, take the largest all-inside rectangle (histogram method), then greedily add up to 4 more rectangles from the uncovered cells, dropping any under 2 % of the polygon; for a rectilinear polygon snap rectangle edges to the polygon's own coordinates so the cover is exact.
- [ ] **Step 4: Run** `pnpm --filter @maxsen/domain test`. Expected: PASS, including all existing magic tests.
- [ ] **Step 5: Commit** `feat(domain): room outlines as polygons alongside boxes`.

### Task 2: Fixture, carpentry and furniture library

**Files:**
- Create: `packages/domain/src/magic/items.ts`, `packages/domain/src/magic/items.test.ts`
- Modify: `packages/domain/src/magic/room-layout.ts` (`items?: PlacedItem[]`), `packages/domain/src/index.ts`

**Interfaces — Produces:**
```ts
export type ItemKind = 'fixture' | 'carpentry' | 'furniture';
export const ITEM_TYPES = [
  // fixtures
  'wc', 'basin', 'bath', 'shower', 'sink', 'hob',
  // carpentry
  'wardrobe', 'kitchen-base', 'kitchen-wall', 'island', 'tv-console', 'feature-wall', 'study-table',
  'vanity', 'shoe-cabinet', 'bay-seat', 'bedhead', 'platform-bed', 'shelter-shelving',
  // furniture and appliances
  'bed-single', 'bed-queen', 'bed-king', 'bedside', 'sofa-2', 'sofa-3', 'sofa-l', 'coffee-table',
  'dining-4', 'dining-6', 'fridge', 'washer', 'custom',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export interface ItemSpec { label: string; kind: ItemKind; width: number; depth: number; height: number; againstWall: boolean } // metres
export const ITEM_LIBRARY: Record<ItemType, ItemSpec>;
export interface PlacedItem {
  id: string; type: ItemType;
  x: number; y: number;        // centre, fractions of the drawing
  rotation: number;            // degrees clockwise; 0 = front faces down the drawing
  width: number; depth: number; height: number; // metres
  roomId: string | null; name?: string;         // name only for 'custom'
}
export function newItem(type: ItemType, at: Pt, roomId: string | null): PlacedItem; // library sizes
export function itemSymbol(type: ItemType, width: number, depth: number): string;
// SVG fragment in the item's own frame: origin at its centre, x across its width, y its depth, 1 unit = 1 m; stroke/fill left to the caller via currentColor
```
Sizes (m, width × depth × height): wc 0.4×0.7×0.8; basin 0.6×0.45×0.85; bath 0.7×1.7×0.55; shower 0.9×0.9×2.0; sink 0.8×0.5×0.9; hob 0.75×0.5×0.9; wardrobe 1.8×0.6×2.4; kitchen-base 2.4×0.6×0.9; kitchen-wall 2.4×0.35×0.7; island 1.8×0.9×0.9; tv-console 1.8×0.4×0.45; feature-wall 2.4×0.1×2.4; study-table 1.2×0.6×0.75; vanity 0.9×0.45×0.75; shoe-cabinet 0.9×0.35×1.1; bay-seat 1.5×0.5×0.45; bedhead 1.6×0.08×1.1; platform-bed 1.6×2.05×0.4; shelter-shelving 1.2×0.4×1.8; bed-single 0.95×1.95×0.5; bed-queen 1.55×2.05×0.5; bed-king 1.85×2.05×0.5; bedside 0.45×0.4×0.5; sofa-2 1.6×0.9×0.8; sofa-3 2.2×0.9×0.8; sofa-l 2.6×1.6×0.8; coffee-table 1.0×0.6×0.4; dining-4 1.2×0.8×0.75; dining-6 1.6×0.9×0.75; fridge 0.7×0.7×1.8; washer 0.6×0.6×0.85; custom 1.0×0.6×0.75.

- [ ] **Step 1: Write the failing tests:** every `ITEM_TYPES` entry has a library spec with positive sizes and a non-empty label; `newItem('bed-queen', …)` has the sizes above and rotation 0; `itemSymbol` for every type returns a non-empty string containing no `<script` and no absolute colours other than `currentColor`/`none`; the wardrobe symbol contains two diagonal lines; `bed-*` symbols contain two pillow rectangles for queen/king and one for single; `dining-6` has 6 chair shapes.
- [ ] **Step 2: Run** `pnpm --filter @maxsen/domain exec vitest run src/magic/items.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the library and symbols (plan-view line symbols).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): fixture, carpentry and furniture library`.

### Task 3: Wall geometry

**Files:**
- Create: `packages/domain/src/drawing/walls.ts`, `packages/domain/src/drawing/walls.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces — Consumes:** Task 1's `outlineOf`, `isSimplePolygon`, `drawingWidthMetres`.
**Produces:**
```ts
export const OUTER_WALL_M = 0.2, INNER_WALL_M = 0.1, WALL_HEIGHT_M = 2.6, FALLBACK_WIDTH_M = 12;
export interface M { x: number; y: number }                  // metres from the drawing's top-left
export interface WallSeg { from: M; to: M; thickness: number; exterior: boolean }
export interface Opening { type: 'door' | 'window'; from: M; to: M; hinge?: M; swingInto?: M /* a point on the swing side */ }
export interface WallModel {
  widthM: number; heightM: number;                           // the drawing's size in metres
  rooms: { id: string; name: string; type: RoomType; inside: M[]; centre: M[]; areaM2: number }[];
  walls: WallSeg[];                                          // every wall once, on its centreline
  openings: Opening[];                                       // snapped onto the nearest wall centreline
  partitions: WallSeg[];
}
export function buildWallModel(layout: RoomLayout, aspect: number): WallModel;
```
Rules: rooms with an invalid outline are skipped. For each room edge, find the stretches that **face** another room's edge (parallel within 5°, 0.02–0.45 m apart, overlapping): those stretches are interior walls, emitted once (by the earlier room in `layout.rooms`), on the mid line, thickness = the gap; the rest of the edge is exterior, emitted on the line `OUTER_WALL_M / 2` outside, thickness `OUTER_WALL_M`. A room's `centre` polygon is its `inside` polygon with each edge moved outward by half the thickness of the wall on most of its length, corners re-intersected. Doors from `layout.doors` (else from tapped `room.door`, 0.9 m wide, centred on the nearest edge, swinging into that room); windows from `layout.windows`.

- [ ] **Step 1: Write the failing tests:**
  - Two 4×3 m rooms side by side, inside faces 0.1 m apart (layout built in fractions of a 12 m-wide drawing): exactly one interior wall between them with thickness 0.1 on the mid line; 6 exterior segments of thickness 0.2 (the shared side is not exterior); both `centre` polygons have an edge on the mid line (within 1e-6); `areaM2` of each is 12.
  - A long room facing two short rooms: two interior walls, each as long as its short room; the long room's uncovered stretch is exterior.
  - A splayed wall (edge at 30°) facing a parallel edge 0.1 m away is found as interior.
  - A door given as hinge/latch 0.03 m off the wall line snaps onto the centreline; a tapped legacy door becomes a 0.9 m opening on the nearest edge. *(Review Focus 4)*
  - A room with a bow-tie outline is skipped and nothing throws. *(Review Focus 1)*
  - A layout with `floorAreaM2: 0` gives `widthM === 12`. *(Review Focus 3)*
- [ ] **Step 2: Run** `pnpm --filter @maxsen/domain exec vitest run src/drawing/walls.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `buildWallModel`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): wall model from room outlines`.

### Task 4: Clean drawing renderer

**Files:**
- Create: `packages/domain/src/drawing/clean-svg.ts`, `packages/domain/src/drawing/clean-svg.test.ts`, `packages/domain/src/drawing/style.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces — Consumes:** `buildWallModel`, `ITEM_LIBRARY`, `itemSymbol`.
**Produces:**
```ts
export interface CleanStyle { wall: string; floor: string; line: string; glass: string; text: string; muted: string; font: string }
export const CLEAN_STYLE: CleanStyle; // wall #2b2b2b, floor #f4f2ee, line #555555, glass #6aa6c8, text #1f1d1a, muted #777777, font "Helvetica, Arial, sans-serif"
export interface CleanOptions { width: number; height: number; showAreas?: boolean /* default true */; showDimensions?: boolean /* default false */; title?: string }
export function renderCleanDrawing(layout: RoomLayout, opts: CleanOptions): string; // a complete <svg> of exactly width × height px
```
Drawing order: white page; each wall segment as a filled quadrilateral (`wall`); room floors (`floor`) over the inside polygons; partitions; openings (door: a gap in the wall the colour of the floor, the leaf as a line from the hinge and a quarter arc on the swing side; window: a white gap with two wall-coloured lines and a `glass` line); items (`itemSymbol`, translated, rotated, scaled by px per metre, stroke `line`, white fill); room name centred in the room's largest rectangle with the area (`12.0 m²`) under it when `showAreas`; optional `title` bottom-right in `muted`. Text is escaped.

- [ ] **Step 1: Write the failing tests:**
  - The two-room layout from Task 3 renders an `<svg` with `width="1000" height="750"`, two floor polygons, one element per wall, both room names, and "12.0 m²" twice.
  - A door produces one `<path` containing an arc (`A `) and a window one element with the `glass` colour.
  - A placed `bed-queen` at rotation 90 appears inside a `<g transform=` containing `rotate(90`.
  - A room named `<b>&"x"` is escaped (`&lt;b&gt;&amp;`). No `<script`, no `href`, no `on…=` attributes anywhere.
  - A layout with no drawn rooms returns a valid empty page; a bow-tie room is skipped without throwing. *(Review Focus 1)*
  - With `floorAreaM2: 0` the output still has walls (non-zero-area wall shapes). *(Review Focus 3)*
  - `showDimensions: true` adds each room's width and depth in metres ("4.00 m") along two of its edges; off by default.
- [ ] **Step 2: Run** `pnpm --filter @maxsen/domain exec vitest run src/drawing/clean-svg.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `renderCleanDrawing`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): render the clean drawing as SVG`.

### Task 5: Vision reading with outlines, doors and items

**Files:**
- Modify: `packages/domain/src/magic/analysis.ts`, `packages/domain/src/magic/room-layout.ts` (`layoutFromAnalysis`, `analysisFromLayout`), `apps/server/src/magic/analyse.ts`, `apps/server/src/magic/app.test.ts`
- Test: `packages/domain/src/magic/room-layout.test.ts` (existing or new), `apps/server/src/magic/analyse.test.ts` (create)

**Interfaces — Produces:** `floorAnalysisSchema` gains optional fields:
```ts
rooms[].outline?: Pt[]                       // 3–40 points, fractions
partitions?: { id: string; from: Pt; to: Pt }[]
items?: { id: string; type: ItemType; roomId: string | null; x: number; y: number; width: number; depth: number; rotation: number }[]
// x, y: centre as fractions; width, depth: fractions of the image WIDTH; rotation in degrees clockwise
```
`layoutFromAnalysis` copies outlines (`withOutline`), turns every analysis door into a `DrawnDoor` (and keeps the tapped `door` point as the midpoint, as today), partitions, and items (sizes in metres = fraction × `imageWidthMetres`, or the library size when the scale is null). `analysisFromLayout` carries outlines and items back (used by Task 12). The server's `wireSchema` and `INSTRUCTIONS` ask for: each room's **outline along the inside faces of its walls, every corner in order, neighbouring rooms a wall-thickness apart**; partitions that are not room edges; and **only fixtures, built-in carpentry and furniture actually drawn on the plan**, typed from `ITEM_TYPES` (use `custom` when unsure). `normaliseAnalysis` clamps points, drops an outline that is not a simple polygon (the room keeps its box), drops items with non-positive size, and computes each room's box from its outline when the outline is kept.

- [ ] **Step 1: Write the failing tests:**
  - `normaliseAnalysis` keeps a valid outline and sets the box to its bounding inscribed rectangle (`withOutline`); drops a bow-tie outline but keeps the room; drops an item with `width: 0`; rejects a reading with no rooms (`AnalysisError`), as today.
  - `layoutFromAnalysis` → `analysisFromLayout` round-trips outlines, door hinge/latch/swing and items (within 1e-9).
  - The analyser sends exactly one image block and one text block (fake client asserting the request), model `claude-opus-5-5`. *(spec anti-goal: nothing new is sent)*
  - `INSTRUCTIONS` contains "inside faces" and every `ITEM_TYPES` value.
- [ ] **Step 2: Run** `pnpm --filter @maxsen/domain test && pnpm --filter @maxsen/server exec vitest run src/magic`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the drawing reading returns outlines, partitions and drawn furniture`.

### Task 6: Snap a corner to a wall line in the photo

**Files:**
- Create: `packages/domain/src/magic/vision/snap.ts`, `packages/domain/src/magic/vision/snap.test.ts`
- Modify: `packages/domain/src/magic/vision/index.ts`

**Interfaces — Produces:**
```ts
export function lineSnapper(img: GrayImage): (p: Pt, radiusPx?: number) => Pt | null;
// p in fractions; returns the nearest point on a dark line's inner edge within radiusPx (default 12) of p, preferring line crossings/corners; null when there is none
```
- [ ] **Step 1: Write the failing tests** on synthetic `GrayImage`s (white 200×200 with 4-px dark lines): a point 6 px from a vertical line snaps onto the line's edge nearest the point (x within 1 px, y unchanged); a point near a corner where two lines meet snaps to the inside corner (both within 1.5 px); a point 30 px from any line returns null; speckle noise (isolated dark pixels) is ignored.
- [ ] **Step 2: Run** `pnpm --filter @maxsen/domain exec vitest run src/magic/vision/snap.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `darkMask` and `open` from `image.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): snap a point to the wall line under it`.

### Task 7: Store: layouts per level, clean backgrounds, the Setup lock

**Files:**
- Modify: `packages/domain/src/types.ts` (`Level.layout`, `PlanBackground.clean`), `apps/web/src/lib/data/sample-store.ts`, `apps/web/src/features/planner/magic/room-layouts.ts` (`startingLayout`), `apps/web/src/features/setup/CropRotatePanel.tsx`, `apps/web/src/features/setup/PlanAssignmentCard.tsx`
- Test: `apps/web/src/lib/data/__tests__/clean-drawing-store.test.ts` (create), `apps/web/src/features/setup/__tests__/` (lock test)

**Interfaces — Produces:**
```ts
// types.ts
interface Level { /* … */ layout?: { backgroundKey: string; layout: RoomLayout } }
interface PlanBackground { /* … */ clean?: { photoFileId: string; photoWidth: number; photoHeight: number; approvedAt: string } }
// store actions
setLevelLayout(levelId: string, backgroundKey: string, layout: RoomLayout): void;
approveCleanDrawing(levelId: string, file: { fileId: string; width: number; height: number }): { ok: true } | { ok: false; reason: 'different-backgrounds' | 'no-plans' };
backToPhoto(levelId: string): void;
// room-layouts.ts
export function levelBackgroundKey(plans: Partial<Record<PlanType, Plan>>): string | null; // null when the plans' keys differ or there is no plan
export function startingLayout(level: Level, plan: Plan): RoomLayout; // level.layout when its key matches the plan's; else plan.magicLayout (legacy); else the sample analysis; else the 4-room preset
```
`approveCleanDrawing` sets, on **every** plan of the level, `background.fileId/width/height` to the new file and `background.clean = { photoFileId, photoWidth, photoHeight, approvedAt }`, where the photo (and its size) is the one already in `clean` if the plan is clean, else the current `fileId`, `width`, `height`; it changes nothing in `document` and leaves `sourcePageId`, `rotation`, `crop` alone. `backToPhoto` restores `fileId`, `width`, `height` from `clean` and deletes `clean`. `setMagicLayout` stays for old callers but the dialog now calls `setLevelLayout`. In Setup, a plan with `background.clean` shows crop and rotate disabled with the text "Go back to the photo first" and a **Back to the photo** button; `assignPlan` on such a level first clears `level.layout` only if the new background key differs.

- [ ] **Step 1: Write the failing tests:**
  - `approveCleanDrawing` on a level with two plans sharing a key sets both `fileId`s, keeps every element of both documents deep-equal, and records the photo. *(spec goal 5)*
  - Approving again with another file keeps `clean.photoFileId` pointing at the original photo; `backToPhoto` then restores it and removes `clean`. *(Review Focus 5)*
  - Different keys → `{ ok: false, reason: 'different-backgrounds' }` and neither plan changes. *(Review Focus 2)*
  - `startingLayout` prefers `level.layout` when the key matches, ignores it when the key differs, and falls back to `plan.magicLayout`. *(Review Focus 4)*
  - Setup: with a clean plan, the rotate and crop controls are disabled, the lock text shows, and **Back to the photo** calls `backToPhoto`.
- [ ] **Step 2: Run** `pnpm --filter @maxsen/web exec vitest run src/lib/data/__tests__/clean-drawing-store.test.ts src/features/setup`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): layouts per level, clean backgrounds and the Setup lock`.

### Task 8: The Outlines step (polygon editor)

**Files:**
- Create: `apps/web/src/features/planner/magic/OutlinesStep.tsx`, `apps/web/src/features/planner/magic/outline-edit.ts` (pure editing operations), `apps/web/src/features/planner/magic/__tests__/outline-edit.test.ts`, `apps/web/src/features/planner/magic/__tests__/OutlinesStep.test.tsx`
- Modify: `apps/web/src/features/planner/magic/MagicPlanDialog.tsx` (use `OutlinesStep`, `setLevelLayout`, `startingLayout(level, plan)`), `apps/web/src/features/planner/magic/room-layouts.ts` (`snapperFor(imageUrl)`), `apps/web/e2e/magic.spec.ts`
- Delete: `apps/web/src/features/planner/magic/RoomsStep.tsx` once nothing imports it

**Interfaces — Consumes:** Tasks 1, 6, 7. **Produces:**
```ts
// outline-edit.ts (all pure; each returns the layout unchanged when the result would be invalid)
export function moveCorner(layout: RoomLayout, roomId: string, index: number, to: Pt): RoomLayout;
export function addCorner(layout: RoomLayout, roomId: string, afterIndex: number, at: Pt): RoomLayout;
export function deleteCorner(layout: RoomLayout, roomId: string, index: number): RoomLayout; // never below 3
export function setRoomOutline(layout: RoomLayout, roomId: string, outline: Pt[]): RoomLayout;
export function mergeRooms(layout: RoomLayout, keepId: string, otherId: string): RoomLayout; // only when they share or nearly share an edge
export function splitRoom(layout: RoomLayout, roomId: string, a: Pt, b: Pt): RoomLayout;      // cuts along a–b (two points on its outline); the new room is "<name> 2", type kept
export function addDoor(layout: RoomLayout, hinge: Pt, latch: Pt): RoomLayout;               // swingsInto = the room the midpoint is nearest inside
export function flipDoor(layout: RoomLayout, doorId: string): RoomLayout;                     // other swing side; again: swap hinge and latch
export function orthoSnap(prev: Pt, p: Pt, next: Pt, aspect: number): Pt;                    // within 3° of horizontal/vertical to a neighbour → exactly so
export function history<T>(initial: T): { value: T; set(v: T): void; undo(): void; redo(): void; canUndo: boolean; canRedo: boolean };
// OutlinesStep props: the same as RoomsStep's Props plus  snap?: (p: Pt) => Pt | null
```
Behaviour: the photo underneath (the photo even when the plan is clean: `background.clean?.photoFileId ?? fileId`); each drawn room a translucent polygon with corner handles (hit area 22 px on touch, 12 px with a mouse). Kept from today: the home-type and room list with presets, tap-a-room to outline it from the drawing (the found room's boxes become a polygon through `outlineOf`), "Skip: find rooms for me", "Suggest with Claude", window marking with an X. New: drag a corner (snaps to the photo line within 12 px via `snap`, then `orthoSnap`; Shift or the **Snap** toggle off disables both), tap an edge to add a corner, select a corner and press Delete (or the bin button) to remove it, **Merge** two selected rooms, **Split** a room (tap two points on its outline), **Door** tool (tap hinge, then latch; tap an existing door to flip it), Undo/Redo buttons and Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z. A move that would make the outline self-intersect springs back. Every change calls `onChange` with a valid layout.

- [ ] **Step 1: Write the failing tests:**
  - `outline-edit.test.ts`: `moveCorner` moves one corner and re-derives the box; a move that crosses the opposite edge returns the same layout object *(Review Focus 1)*; `deleteCorner` on a triangle is a no-op; `addCorner` inserts after the index; `mergeRooms` of two touching boxes gives one 4-point outline (or 6/8 for an L) and removes the other room, moving its door; `splitRoom` of a 4×3 box across its middle gives two 4-point rooms whose areas sum to the original; `addDoor` picks the room it swings into; `flipDoor` twice swaps hinge and latch; `orthoSnap` straightens a 2° edge and leaves a 10° edge; `history` undoes and redoes.
  - `OutlinesStep.test.tsx`: a legacy layout (boxes) renders one polygon per drawn room with 4 handles *(Review Focus 4)*; dragging a handle calls `onChange` with the moved corner; with `snap` returning a point the corner lands there; the Undo button restores the previous layout.
  - Update `apps/web/e2e/magic.spec.ts`: the existing three flows still pass with the new step (a tap outlines a room; skip finds every room; the sample drawing plans), plus one new flow: drag a corner of the living room and see the plan step still reachable.
- [ ] **Step 2: Run** `pnpm --filter @maxsen/web exec vitest run src/features/planner/magic`. Expected: FAIL.
- [ ] **Step 3: Implement** `outline-edit.ts`, then `OutlinesStep.tsx`, then switch the dialog and delete `RoomsStep.tsx`.
- [ ] **Step 4: Run** `pnpm check && pnpm build && pnpm e2e -- magic.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): outline rooms as polygons with snap, doors and undo`.

### Task 9: Fixtures, carpentry and furniture in the Outlines step

**Files:**
- Create: `apps/web/src/features/planner/magic/ItemsPanel.tsx`, `apps/web/src/features/planner/magic/item-edit.ts`, `apps/web/src/features/planner/magic/__tests__/item-edit.test.ts`
- Modify: `apps/web/src/features/planner/magic/OutlinesStep.tsx`

**Interfaces — Produces:**
```ts
export function placeItem(layout: RoomLayout, type: ItemType, at: Pt): RoomLayout;      // newItem; roomId from pointInPolygon
export function moveItem(layout: RoomLayout, id: string, to: Pt, aspect: number): RoomLayout; // snaps its back to a wall edge of its room within 0.15 m and turns to face into the room when the type is againstWall; snaps edges to other items within 0.05 m
export function rotateItem(layout: RoomLayout, id: string, degrees: number): RoomLayout;      // snapped to 15°
export function resizeItem(layout: RoomLayout, id: string, size: { width?: number; depth?: number }): RoomLayout; // 0.2–6 m
export function removeItem(layout: RoomLayout, id: string): RoomLayout;
```
UI: a **Furniture** mode beside rooms/doors/windows with the library grouped as Fixtures, Carpentry, Furniture (label and size shown); tap a library item, then tap the drawing to drop it; drag to move; a rotate handle and side handles to resize; a width × depth read-out; Delete removes; `custom` asks for a name. Items read by Claude appear the same way. Items are drawn with `itemSymbol` over the photo.

- [ ] **Step 1: Write the failing tests** for `item-edit.ts`: `placeItem` inside a room sets `roomId` and library sizes; `moveItem` of a wardrobe within 0.15 m of a wall puts its back on the wall and rotates it to face the room (0/90/180/270 for an axis-aligned room); a sofa (not `againstWall`) only snaps when within 0.15 m too but does not rotate; `rotateItem(…, 37)` gives 30 or 45 (nearest 15°); `resizeItem` clamps to 0.2–6 m; `removeItem` removes. Component test: choosing "Wardrobe" and tapping the drawing adds one item and calls `onChange`.
- [ ] **Step 2: Run** `pnpm --filter @maxsen/web exec vitest run src/features/planner/magic`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): place fixtures, carpentry and furniture on the outline`.

### Task 10: Compare, approve, and the photo underlay

**Files:**
- Create: `apps/web/src/features/planner/magic/CleanPreview.tsx`, `apps/web/src/features/planner/magic/approve.ts`, `apps/web/src/features/planner/magic/__tests__/approve.test.ts`
- Modify: `apps/web/src/lib/images.ts` (`svgToPng`), `apps/web/src/features/planner/magic/MagicPlanDialog.tsx`, `apps/web/src/features/planner/PlannerScreen.tsx` and `canvas/PlanStage.tsx` (underlay toggle), `apps/web/e2e/magic.spec.ts`

**Interfaces — Consumes:** `renderCleanDrawing`, `levelBackgroundKey`, `approveCleanDrawing`, `putFile`. **Produces:**
```ts
// images.ts
export function svgToPng(svg: string, width: number, height: number): Promise<Blob>;
// approve.ts
export function cleanSize(photo: { width: number; height: number }): { width: number; height: number };
// same aspect as the photo; long edge = clamp(photo long edge, 2000, 3000), rounded
export async function approveDrawing(args: { level: Level; plans: Partial<Record<PlanType, Plan>>; layout: RoomLayout; title: string;
  put: (blob: Blob) => Promise<string>; toPng: typeof svgToPng; actions: Pick<Actions, 'approveCleanDrawing' | 'setLevelLayout'> }):
  Promise<{ ok: true } | { ok: false; message: string }>;
```
UI: in the Outlines step footer, **Preview drawing** opens `CleanPreview`: the clean drawing over the photo with a **Compare** slider (0 = photo, 100 = drawing) and **Approve drawing**. When `levelBackgroundKey(plans)` is null, Approve is disabled with "Give both plans the same drawing in Setup first" and a link to Setup. Approving saves the layout, renders at `cleanSize`, stores the PNG, calls `approveCleanDrawing`, and shows "Drawing approved. Both plans now use it." Running Magic Plan (the Plan step) is unchanged and never approves. In the planner toolbar, a **Photo** toggle appears when the plan is clean and shows the photo at 35 % opacity over the clean drawing.

- [ ] **Step 1: Write the failing tests:**
  - `cleanSize({1424, 1899})` → `{1500, 2000}` (long edge raised to 2000, aspect kept within 1 px); `cleanSize({4000, 3000})` → `{3000, 2250}`.
  - `approveDrawing` with matching keys: calls `toPng` with the SVG of the layout at `cleanSize`, `put` once, `setLevelLayout`, then `approveCleanDrawing(level.id, { fileId, width, height })`; returns ok.
  - With different keys: returns the Setup message, calls neither `put` nor any action. *(Review Focus 2)*
  - e2e (new flow in `magic.spec.ts`): open Magic Plan on the uploaded drawing, find rooms, Preview drawing, move the Compare slider, Approve; the planner canvas background `src` changes; every element's position on both plans is unchanged; the Photo toggle shows the photo; reopening the dialog and approving again then **Back to the photo** in Setup restores the first image. *(Review Focus 5, spec goal 5)*
- [ ] **Step 2: Run** `pnpm --filter @maxsen/web exec vitest run src/features/planner/magic/__tests__/approve.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `svgToPng`: an `Image` from a `data:image/svg+xml` URL drawn to a canvas, `toBlob('image/png')`.
- [ ] **Step 4: Run** `pnpm check && pnpm build && pnpm e2e -- magic.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): preview, compare and approve the clean drawing`.

### Task 11: Rooms and furniture in the home package

**Files:**
- Modify (planner): `packages/domain/src/home-package/types.ts`, `packages/domain/src/home-package/build.ts`, `packages/domain/src/home-package/build.test.ts`
- Modify (HA repo): `tests/test_package.py`, `tests/fixtures/` (add `home-v1-rooms.json`), `frontend/src/types.ts`

**Interfaces — Produces:**
```ts
export interface HomeRooms {
  scale: number;                 // metres per plan unit
  wallHeight: number;            // 2.6
  rooms: { id: string; name: string; polygon: [number, number][] }[];           // plan units, wall centrelines
  walls: { from: [number, number]; to: [number, number]; thickness: number }[]; // plan units; thickness in metres
  openings: { type: 'door' | 'window'; from: [number, number]; to: [number, number]; sill?: number; height?: number }[];
}
export interface HomeFurniture { id: string; type: ItemType; roomId: string | null; x: number; y: number; rotation: number; width: number; depth: number; height: number; builtIn: boolean; name?: string }
// HomeLevel gains:  rooms?: HomeRooms;  furniture?: HomeFurniture[]
```
A level gets `rooms` and `furniture` only when it has `level.layout`, the layout's key equals the key of **every** exported plan of the level, and every such plan has `background.clean`. Plan units from metres: `x_m * 1000 / widthM`. Doors: `sill 0, height 2.1`; windows: `sill 0.9, height 1.2`. `builtIn` is true for item kinds `fixture` and `carpentry`. Partitions are appended to `walls`.

- [ ] **Step 1: Write the failing tests** (planner `build.test.ts`): a project with an approved level exports `rooms` (two rooms sharing an edge on the centreline, `scale` = 12/1000 for the 12 m fixture, walls and one door opening in plan units) and `furniture` with `builtIn` set; the same project after `clean` is removed from one plan exports neither; a level whose layout key differs from its plans' exports neither; `schemaVersion` is still 1 and an old project's package is byte-identical to before.
- [ ] **Step 2: Run** `pnpm --filter @maxsen/domain exec vitest run src/home-package`. Expected: FAIL.
- [ ] **Step 3: Implement** in `build.ts`.
- [ ] **Step 4: Run** `pnpm check`. Expected: PASS. Commit `feat(domain): rooms and furniture in the home package`.
- [ ] **Step 5 (HA repo):** generate `tests/fixtures/home-v1-rooms.json` from the planner's `buildHomePackage` (same way `home-v1.json` was made), add a pytest that a package with `rooms` and `furniture` validates, is stored, and comes back unchanged from `maxsen/home`; add the optional fields to `frontend/src/types.ts`. Run `.venv/bin/pytest -q` and `cd frontend && npm test && npm run typecheck`. Expected: PASS. Commit `test: home packages with rooms and furniture load unchanged`.

### Task 12: Magic Plan follows the placed furniture

**Files:**
- Modify: `packages/domain/src/magic/magic-plan.ts`
- Test: `packages/domain/src/magic/magic-plan.furniture.test.ts` (create)

**Interfaces — Consumes:** `FloorAnalysis.items` (Task 5). A placed item wins over the guess; the guess fills in when nothing is placed.

- [ ] **Step 1: Write the failing tests:**
  - A bedroom where today's guess puts the bed on the north wall, with a `bed-queen` placed against the east wall: the bedhead strip is on the east wall and no downlight lies over the bed's rectangle (plus 0.2 m).
  - A living room with a `tv-console` on the wall the guess would not choose: the TV-wall strip follows the console's wall, and the track sits behind the placed `sofa-3`.
  - A `wardrobe` in a bedroom: the wardrobe downlight is 0.3–0.4 m in front of its doors.
  - With no items, the result deep-equals today's (snapshot from `main`). *(Review Focus 4)*
- [ ] **Step 2: Run** `pnpm --filter @maxsen/domain exec vitest run src/magic/magic-plan.furniture.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:** in `bedFor`, the living-room TV/sofa frame and the wardrobe light, read the room's placed items first (the wall is the room edge nearest the item's back).
- [ ] **Step 4: Run** `pnpm --filter @maxsen/domain test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): Magic Plan uses the bed, sofa, TV console and wardrobe that were placed`.

### Task 13: Dairy Farm end to end

**Files:** none in the repos (outputs go to the session scratchpad); `README.md` of the HA repo gets two lines.

- [ ] **Step 1:** Run the planner locally against the test data folder with the Dairy Farm project (`proj_dairyFarm01`); in the browser, open Magic Plan on Level 1, load an analysis for the photo (the vision reading if `ANTHROPIC_API_KEY` is set; otherwise a hand-checked analysis file posted through a test analyser), correct two corners, place a bed, a wardrobe, a sofa and a kitchen run, Preview, Approve.
- [ ] **Step 2:** Confirm every one of the 109 elements has the same coordinates as before; export the home file; screenshot the planner (photo vs clean drawing) and the clean plan in the Maxsen Home preview app with the devices on it; export the floor-plan PDF and confirm its pages show the clean drawing.
- [ ] **Step 3:** In the HA repo README, under "See it on your Mac", note that a home file from a level with an approved drawing shows the clean plan. Commit `docs: clean drawings in the preview app`.
- [ ] **Step 4:** Run the whole planner suite: `pnpm check && pnpm build && pnpm e2e`. Expected: PASS. Push both branches.
