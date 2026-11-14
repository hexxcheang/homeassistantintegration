# Maxsen Home 3D View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "3D" layer in the Maxsen Home panel that draws the level as a dark neon dollhouse from the home package's rooms layer, with every device at its planned spot, live state, the same taps as 2D, room entry with room tiles, the Maxsen logo in the header, and an installer-chosen opening view.

**Architecture:** The main bundle (`maxsen-home.js`) turns a level into a plain-data `ThreeModel` and the entity states into `ThreeStates` (pure modules, tested without a browser). A second, self-contained bundle (`maxsen-3d.js`: three.js plus our renderer, no Lit, no imports from the main bundle) draws that data and reports taps. It is loaded on demand the first time the 3D layer is shown. `floorplan-view.ts` stays the owner of level and layer state and routes 3D taps into its existing tap, hold and picker code.

**Tech Stack:** TypeScript 7, Lit 3.3.3, three 0.187.0 (MIT), Vite 8 (two lib builds), Vitest + happy-dom, Python 3.13 + pytest-homeassistant-custom-component.

**Spec:** `docs/superpowers/specs/2026-11-07-maxsen-3d-view-design.md`

## Global Constraints

- Nothing a customer sees names a third party: no library names, account prompts, shops or paid tiers in any visible text.
- No network at run time beyond Home Assistant itself: no CDN, no web fonts; three.js is bundled.
- The committed build is byte-reproducible: exactly two files in `custom_components/maxsen/frontend/`, `maxsen-home.js` and `maxsen-3d.js`, fixed names, no hashes. CI's `git diff --exit-code custom_components/maxsen/frontend` after `npm run build` must stay clean.
- `maxsen-home.js` must not contain three.js (no `WebGLRenderer` string in it) and `maxsen-3d.js` must not import `maxsen-home.js` or define a custom element. The chunk keeps three's MIT licence banner.
- Dependencies are pinned to exact versions: `three` `0.187.0`, `@types/three` `0.187.0` (dev).
- Render on demand: a frame is drawn only on camera movement, an animation, a resize, or a state change that alters what is shown. Never a continuous loop. Device pixel ratio capped at 1.5. No shadows. At most one directional light plus ambient.
- The 2D layers, link mode and the dashboard card behave exactly as today whenever the layer is not 3D. Linking stays 2D: the 3D option is not offered in link mode.
- A level without a usable rooms layer, a browser without WebGL, and a level whose two plans do not share a background key never show the 3D option.
- Schema version of the home package stays 1; a valid package passes through the server byte-for-byte as today.
- Installer-only settings keep today's rule: administrator and installer mode (`_installer_only`).
- Plain language in all copy; no dashes used as sentence punctuation in UI text.
- Customer data (the Dairy Farm PDF, photo, home files and crops of them) is never committed.
- Before every commit that touches `frontend/src`: `cd frontend && npx tsc --noEmit && npm test && npm run build`, and commit the rebuilt files. Python: `.venv/bin/pytest -q`.

## Decisions made while planning *(Claude's calls; the owner can override)*

1. **No ceilings are drawn.** The house is open-topped like a dollhouse; ceiling devices float at ceiling height. "Entering a room" lowers that room's walls and fades the other rooms.
2. **Two separate bundles, not a code-split.** A code-split chunk would import shared code back from `./maxsen-home.js` without the `?v=` query, loading the panel code a second time. The 3D bundle is therefore self-contained and is loaded from a URL that carries the main bundle's query string.
3. **A malformed rooms layer never blocks a home.** The server drops `rooms` and `furniture` from that level with a logged warning and the home opens in 2D; the frontend applies the same check before offering 3D.
4. **A level with one plan and a rooms layer** offers that plan's layer and 3D.
5. **Sensors:** a sensor whose product, variant or label matches `/door|window|contact/i` is a door sensor (2.0 m on the nearest wall); every other sensor is on the ceiling.
6. **Categories the spec does not list** (gateways, network devices, misc smart home): 1.5 m on the nearest wall, like cameras.
7. **The logo is one dark wordmark**; the light version for the dark look is the same image through a CSS filter.
8. **Android back** leaves an entered room only in the full panel (not the dashboard card), through one pushed history entry.

## Review Focus

1. The 3D bundle fails to load (offline, stale file after an update) or the WebGL context is lost while in use: the view returns to the 2D layer with the notice "3D is not available on this screen right now." and never shows a blank stage. (Task 7)
2. A rooms layer that is malformed or huge (non-finite numbers, a polygon with two points, zero scale, 5,000 walls): no 3D for that level, 2D unaffected, the home still loads. (Tasks 1, 2)
3. A device farther than 0.4 m from any wall, outside every room, or placed by both plans at different spots: it is drawn free-standing at its category height, using the smart-home plan's position, and is never dropped. (Task 4)
4. A light with no colour attributes, brightness 0, unavailable, or unlinked: a defined warm default, a visible minimum glow, and the same status as the 2D plan shows. (Tasks 2, 4)
5. Changing the background setting on a home that has an opening view (and the reverse), and a store saved before either setting existed: neither setting erases the other; an old store opens in 2D on the soft background. (Task 1)

---

## File structure

| File | Responsibility |
|---|---|
| `custom_components/maxsen/store.py`, `websocket.py`, `package.py` | `opening_view`, merged display settings, rooms-layer check |
| `frontend/src/types.ts` | `Layer` gains `'3d'`; `DisplaySettings.opening_view`; `HomeRooms.wallHeight?`, `mounts?` |
| `frontend/src/rooms-layer.ts` | `usableRooms(level)`: the frontend's rooms-layer check |
| `frontend/src/light-colour.ts` | entity state → colour and level |
| `frontend/src/three-scene.ts` | pure: level → `ThreeModel`; links + states → `ThreeStates` |
| `frontend/src/three-api.ts` | types shared with the 3D bundle; `loadThree`, `setThreeLoader`, `hasWebGL` |
| `frontend/src/three/` (`index.ts`, `build.ts`, `camera.ts`, `labels.ts`, `glow.ts`) | the 3D bundle: meshes, camera, input, render on demand |
| `frontend/src/three-view.ts` | `<maxsen-3d-view>`: loads the bundle, feeds it, relays events |
| `frontend/src/tile.ts`, `room-tiles.ts` | shared tile; `<maxsen-room-tiles>` |
| `frontend/src/logo.ts` | the Maxsen wordmark as a data URI |
| `frontend/vite.three.config.ts` | second lib build |
| `tests/fixtures/home-v1-3d.json` | sample home with rooms, furniture and every device kind |

---

### Task 1: Server: opening view and the rooms-layer check

**Files:**
- Modify: `custom_components/maxsen/store.py` (`_empty`, `async_load`, `async_set_display`), `websocket.py:245-264` (`ws_display_set`), `package.py` (`parse_package`)
- Test: `tests/test_websocket.py`, `tests/test_package.py`

**Interfaces:**
- Produces: `maxsen/home` returns `display: {"background": "soft"|"original", "opening_view": "2d"|"3d"}`; `maxsen/display/set` accepts optional `background` and optional `opening_view` and needs at least one; `parse_package` returns the package with any malformed rooms layer removed.

- [ ] **Step 1: Failing tests** in `tests/test_websocket.py`:
  - `test_home_shows_2d_opening_view_for_a_store_saved_before_the_setting`: a stored `display` of `{"background": "original"}` reads back as `{"background": "original", "opening_view": "2d"}`.
  - `test_display_set_opening_view_keeps_the_background`: set `background: "original"`, then `opening_view: "3d"`; result is `{"background": "original", "opening_view": "3d"}`; then set `background: "soft"`; `opening_view` is still `"3d"`.
  - `test_display_set_opening_view_needs_installer_mode`, `test_display_set_rejects_unknown_opening_views` (`"4d"` → `invalid_format`), `test_display_set_needs_something_to_set` (neither key → `invalid_format`).
- [ ] **Step 2: Failing tests** in `tests/test_package.py`, each starting from `home_rooms_package`:
  - `test_valid_rooms_layer_is_kept_unchanged` (already covered by the pass-through test; keep both).
  - Parametrised `test_malformed_rooms_layer_is_dropped_and_the_home_still_parses` over: `scale` 0, `scale` `"x"`, a polygon with 2 points, a wall `from` of `[1]`, a coordinate of `1e400` (parsed as infinity) and of NaN, an opening `type` of `"hatch"`, `rooms` not a dict, 201 rooms, 2,001 walls, 1,001 openings, furniture `rotation` 45, furniture `width` −1, 1,001 furniture items. Expect: that level has neither `rooms` nor `furniture`, everything else equals the input, and a warning naming the level is logged (`caplog`).
- [ ] **Step 3: Run** `.venv/bin/pytest -q tests/test_websocket.py tests/test_package.py`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement.**
  - `store.py`: default `"display": {"background": "soft", "opening_view": "2d"}`; `async_load` merges the stored `display` over the default display; `async_set_display(self, patch: dict[str, str])` merges `patch` into the current display.
  - `websocket.py`: schema `vol.Optional("background"): vol.In(["soft", "original"])`, `vol.Optional("opening_view"): vol.In(["2d", "3d"])`; when neither is present send `invalid_format` with "Nothing to change"; pass only the given keys to `async_set_display`.
  - `package.py`: `_rooms_layer_ok(level: dict) -> bool` and a call in `parse_package` after `_validate_structure` that pops `rooms` and `furniture` from a failing level and logs `"Level %s: the rooms layer is not usable, so the 3D view is off for it"`. Rules: `rooms` is a dict; `scale` a finite number > 0; `wallHeight` absent or finite in (0, 10]; `rooms.rooms`, `walls`, `openings` are lists of at most 200 / 2,000 / 1,000 items; every id and name a string; every polygon has ≥ 3 points; every point is two finite numbers; wall `thickness` finite in (0, 2]; opening `type` in `door|window`, `sill` and `height` absent or finite ≥ 0; `mounts` absent or a dict; `furniture` absent or a list of at most 1,000 dicts with string `id` and `type`, finite `x`, `y`, `rotation` in `0|90|180|270`, finite `width`, `depth`, `height` > 0. A level with `furniture` but no `rooms` keeps its `furniture` only if the furniture rules pass.
- [ ] **Step 5: Run** `.venv/bin/pytest -q`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: opening view setting and a check on the rooms layer`.

### Task 2: Frontend foundations

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/view-geometry.ts`, `frontend/src/api.ts:126`, `frontend/preview/fake-hass.ts:873-881`, `frontend/src/link-mode.ts` (`_toggleOriginal` call site only), `frontend/test/view-helpers.ts` (`homeResponse` default display)
- Create: `frontend/src/rooms-layer.ts`, `frontend/src/light-colour.ts`
- Test: `frontend/test/view-geometry.test.ts`, `rooms-layer.test.ts`, `light-colour.test.ts`, `api.test.ts`, `fake-hass.test.ts`

**Interfaces:**
- Produces:
  - `type Layer = 'all' | 'smart-home' | 'lighting' | '3d'`
  - `type OpeningView = '2d' | '3d'`; `interface DisplaySettings { background: DisplayBackground; opening_view?: OpeningView }`
  - `HomeRooms.wallHeight?: number`; `HomeRooms.mounts?: Record<string, { height?: number; wall?: [[number, number], [number, number]] }>`
  - `layerOptions(plans: HomePlan[], threeD = false): Layer[]`
  - `usableRooms(level: HomeLevel): HomeRooms | undefined`
  - `lightColour(states: readonly HassState[]): { color: string; level: number }` (`HassState` = the entity-state shape already in `HassLike`)
  - `setDisplay(hass, entryId, patch: Partial<DisplaySettings>): Promise<{ display: DisplaySettings }>`

- [ ] **Step 1: Failing tests.**
  - `layerOptions`: two plans sharing a key, `threeD` true → `['all', 'smart-home', 'lighting', '3d']`; keys differ, `threeD` true → `['smart-home', 'lighting']`; one lighting plan, `threeD` true → `['lighting', '3d']`; one plan, `threeD` false → `[]` (today's test stays); two plans, default argument → today's results.
  - `usableRooms`: the `home-v1-rooms.json` level → its `rooms`; a level without `rooms` → `undefined`; each malformed case from Task 1 Step 2 that concerns `rooms` → `undefined`.
  - `lightColour`: `rgb_color [255, 0, 0]`, brightness 255 → `{ color: '#ff0000', level: 1 }`; `color_temp_kelvin` 2700 → a colour with red > blue; 6500 → blue ≥ red × 0.9; no colour attributes → `'#ffb22e'`; brightness 1 → level 0.35; brightness missing → level 1; several on lights → the level-weighted mix; no states → `{ color: '#ffb22e', level: 1 }`.
  - `setDisplay`: sends only the keys in the patch. Fake hass: `maxsen/display/set` with `opening_view` merges like the server and refuses outside installer mode.
- [ ] **Step 2: Run** `npm test`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the signatures above. `usableRooms` applies the Task 1 rules (same limits). `lightColour` maps brightness 1…255 linearly onto 0.35…1. Update the one `setDisplay` caller to pass `{ background }`.
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test && npm run build`. Expected: PASS; only `maxsen-home.js` changes.
- [ ] **Step 5: Commit** `feat: 3D layer option, rooms-layer check and light colour helpers`.

### Task 3: The house model (rooms, walls, openings, furniture)

**Files:**
- Create: `frontend/src/three-api.ts` (types only in this task), `frontend/src/three-scene.ts`, `tests/fixtures/home-v1-3d.json`
- Modify: `tests/fixtures/README.md`, `tests/conftest.py` (fixture `home_3d_package`), `tests/test_package.py` (it parses unchanged)
- Test: `frontend/test/three-scene.test.ts`

**Interfaces:**
- Produces (in `three-api.ts`; metres; x = plan x × scale, z = plan y × scale, y up):

```ts
export type V2 = [number, number];
export type V3 = [number, number, number];
export interface WallPiece { from: V2; to: V2; thickness: number; y0: number; y1: number; kind: 'wall' | 'glass' }
export interface Box3 { centre: V3; size: V3; turn: number /* degrees about y */; part: 'body' | 'screen' }
export interface FurnitureBlock { id: string; type: string; roomId: string | null; boxes: Box3[] }
export interface ThreeRoom { id: string; name: string; polygon: V2[]; centre: V2 }
export interface ThreeModel {
  key: string;                 // level id + plan revisions; a new key means rebuild
  wallHeight: number;          // default 2.6
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  rooms: ThreeRoom[]; walls: WallPiece[]; furniture: FurnitureBlock[]; devices: ThreeDevice[];
}
```
  and `buildThreeModel(level: HomeLevel): ThreeModel | undefined` in `three-scene.ts` (`devices` is `[]` until Task 4; `ThreeDevice` is declared there).

- [ ] **Step 1: Write the fixture** `home-v1-3d.json`: copy `home-v1.json`, keep its first level's two plans and all their items, and add to that level a hand-fitted rooms layer (at least four rooms sharing edges, one door per room, two windows, `scale` so the drawing is about 12 m wide) and eight furniture items (bed, wardrobe, sofa, tv, dining-table, kitchen-counter, wc, desk). Add any device kinds the level lacks so it has at least: 6 downlights, 1 LED strip, 2 curtains, 2 switches, 1 control panel, 1 motion sensor, 1 door sensor, 1 aircon, 1 ceiling fan. Note its provenance in `tests/fixtures/README.md`.
- [ ] **Step 2: Failing tests** (`three-scene.test.ts`), on a small inline level and on the fixture:
  - a level without usable rooms → `undefined`;
  - room polygons and `bounds` are in metres (plan × `scale`); `centre` lies inside its polygon for an L-shaped room;
  - a wall with no opening → one `wall` piece `y0 0, y1 wallHeight`;
  - a wall with a door (height 2.1) → pieces left and right of the gap at full height plus a lintel `y0 2.1, y1 wallHeight` over the gap; nothing below 2.1 inside the gap;
  - a wall with a window (sill 0.9, height 1.2) → wall below the sill, a `glass` piece `0.9…2.1`, wall above;
  - an opening that lies on no wall (farther than half the thickness + 0.05 m from every wall line) changes nothing;
  - two openings on one wall are both cut; an opening running past a wall's end is clipped to the wall;
  - `wallHeight` absent → 2.6;
  - furniture: a wardrobe → one `body` box of its width × height × depth, centred at its spot, `turn` = its rotation; a bed → a low body plus a raised head box on its back side; a sofa → seat plus back; a table or desk → a top plus four legs; a tv → a console plus a `screen` box; an unknown type → one body box of its size;
  - `key` changes when a plan's `revision` changes.
- [ ] **Step 3: Run** `npm test -- three-scene`. Expected: FAIL.
- [ ] **Step 4: Implement** `buildThreeModel`. The back of a piece is the side `rotation` names (0 top of the plan, 90 right, 180 bottom, 270 left), as in the planner's package builder.
- [ ] **Step 5: Run** `npx tsc --noEmit && npm test && npm run build && .venv/bin/pytest -q` (from the repo root for pytest). Expected: PASS.
- [ ] **Step 6: Commit** `feat: house model for the 3D view`.

### Task 4: Devices in the model, and their live state

**Files:**
- Modify: `frontend/src/three-api.ts`, `frontend/src/three-scene.ts`
- Test: `frontend/test/three-scene.test.ts`

**Interfaces:**
- Consumes: `buildThreeModel`, `visualState` (`visual-state.ts:94`), `linkEntityIds` (`operate.ts`), `lightColour`.
- Produces:

```ts
export type DeviceShape = 'disc' | 'strip' | 'curtain' | 'badge' | 'pill';
export interface ThreeDevice {
  elementId: string; categoryId: CategoryId; roomId: string | null; shape: DeviceShape;
  at: V3;                      // centre; for strip and curtain, the middle of the run
  points?: V3[];               // strip path, or the two ends of a curtain
  normal?: V2;                 // unit vector out of the wall, towards the marker's side
  color: string;               // the element's 2D colour
  badge?: { text: string; color: string };
}
export interface DeviceState { status: VisualStatus; color: string; level: number; text?: string; position?: number }
export interface ThreeStates {
  devices: Record<string, DeviceState>;
  rooms: Record<string, { color: string; level: number }>;   // only rooms with a light on
}
export function threeStates(model: ThreeModel, home: HomeResponse, hass: HassLike): ThreeStates;
```

- [ ] **Step 1: Failing tests.**
  - Placement, by category (heights in metres, `H` = wall height): downlights, surface, spot, pendant, track (point), magnetic track, misc lighting, ceiling fans and non-door sensors → `disc` (lights and fans) or `pill` (sensors) at `y = H`; LED strips → `strip` with every point at `y = H − 0.3`; track paths → `strip` at `y = H`; smart switches and control panels → `badge` at `y = 1.2`; aircon → `pill` at 2.1; door sensors → `pill` at 2.0; cameras, locks, gateways, network devices, misc smart home → `badge` at 1.5; curtains → `curtain` with two `points` on the wall, `y` spanning 0…`H`.
  - Wall mounting: a switch 0.2 m from a wall lands on that wall's face on the marker's side (centreline + normal × (thickness / 2 + 0.02)), with `normal` pointing at the marker; a switch 0.2 m from a wall between two rooms stays in the marker's room (`roomId` of the marker, not the neighbour); a switch 0.5 m from every wall stays at its planned x/z at 1.2 with no `normal`.
  - `mounts[elementId].height` overrides the height; `mounts[elementId].wall` overrides the wall.
  - `roomId` is the room whose polygon contains the marker; outside every room → `null`, and the device is still present.
  - An element drawn in both plans appears once, at the smart-home plan's spot. The model has one device per drawn element of the level.
  - `threeStates`: an unlinked element → `status 'unlinked'`, level 0; a light on with `rgb_color` → its colour and level; off → `status 'off'`, level 0; unavailable → as `visualState` says; a cover at `current_position` 30 → `position 30`; an aircon → `text` as in 2D; a room with two lights on → `rooms[id]` is their level-weighted mix; a room with none on is absent from `rooms`. Calling it twice with the same inputs gives deep-equal results.
- [ ] **Step 2: Run** `npm test -- three-scene`. Expected: FAIL.
- [ ] **Step 3: Implement.** Nearest wall = smallest distance from the marker to a `walls[]` segment (in metres), limit 0.4 m, measured to the wall's centreline minus half its thickness.
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: devices and live state in the 3D house model`.

### Task 5: The 3D bundle: drawing the house, on demand

**Files:**
- Create: `frontend/vite.three.config.ts`, `frontend/src/three/index.ts`, `build.ts`, `labels.ts`, `glow.ts`, `THIRD_PARTY_NOTICES.md` (repo root)
- Modify: `frontend/package.json` (`three`, `@types/three`, `"build": "vite build && vite build --config vite.three.config.ts"`), `frontend/src/three-api.ts` (loader), `tests/test_init.py`
- Test: `frontend/test/three-build.test.ts`, `three-mount.test.ts`, `three-api.test.ts`, `bundle.test.ts`

**Interfaces:**
- Produces (in `three-api.ts`):

```ts
export interface ThreeHit { elementIds: string[]; roomId: string | null; x: number; y: number }  // x, y in host px
export interface ThreeCallbacks {
  onTap(hit: ThreeHit): void; onHold(hit: ThreeHit): void;
  onFailed(reason: 'context-lost' | 'error'): void; onFirstFrame?(): void;
}
export interface ThreeHandle {
  setModel(model: ThreeModel): void;
  setStates(states: ThreeStates): void;
  enterRoom(roomId: string | null): void;   // null = whole house
  resetView(): void;
  resize(width: number, height: number): void;
  dispose(): void;
  readonly frames: number;                   // frames drawn so far
}
export interface ThreeMountOptions { createRenderer?: (canvas: HTMLCanvasElement) => RendererLike; pixelRatio?: number }
export interface ThreeModule { mount(host: HTMLElement, model: ThreeModel, states: ThreeStates, cb: ThreeCallbacks, opts?: ThreeMountOptions): ThreeHandle }
export function loadThree(): Promise<ThreeModule>;
export function setThreeLoader(loader: (() => Promise<ThreeModule>) | undefined): void;
export function hasWebGL(): boolean;                 // cached; false when no canvas context
export function setWebGLForTests(value: boolean | undefined): void;
```
  `RendererLike` is the part of `WebGLRenderer` the bundle uses (`render`, `setSize`, `setPixelRatio`, `dispose`, `domElement`).
- `src/three/index.ts` exports `mount` and nothing from Lit. `build.ts` exports `buildHouse(model): { root: Object3D; update(states): boolean; pickables: Object3D[]; dispose(): void }`, where `update` returns whether anything visible changed.

- [ ] **Step 1: Failing tests.**
  - `three-api.test.ts`: `loadThree` with no loader set imports the URL `maxsen-3d.js` beside `import.meta.url`, carrying the same query string (test the pure helper `chunkUrl('http://h/maxsen_static/maxsen-home.js?v=0.1.0')` → `'http://h/maxsen_static/maxsen-3d.js?v=0.1.0'`); a second call returns the same promise; a failed load is not cached; `hasWebGL()` is false under happy-dom and follows `setWebGLForTests`.
  - `three-build.test.ts` (fixture model): one floor mesh per room; wall pieces all present and `glass` pieces use a different material from `wall` pieces; all downlight discs are one `InstancedMesh` whose count is the number of `disc` devices; every `ThreeDevice` has a pickable carrying its `elementId` in `userData`; every room floor is pickable with `userData.roomId`; `update` with a light on sets that disc's instance colour to the state colour and shows its floor pool, and returns `true`; the same states again → `false`; a room in `states.rooms` gets its wash colour, a room not in it has none; a curtain at `position` 30 is narrower than at 100; an `unlinked` device is drawn dim; `dispose` disposes every geometry and material it created (spies).
  - `three-mount.test.ts` (fake renderer through `createRenderer`, `requestAnimationFrame` driven by fake timers): after `mount` and one animation frame, `frames` is 1 and `onFirstFrame` ran once; ten more animation frames with no input leave `frames` at 1; `setStates` with equal states draws nothing; with a changed state draws exactly one frame; several changes before the next animation frame draw one frame; `resize` draws one frame; pixel ratio passed to the renderer is `min(devicePixelRatio, 1.5)`; a `webglcontextlost` event on the canvas calls `onFailed('context-lost')`; a renderer that throws on creation calls `onFailed('error')` and `mount` still returns a handle whose methods do nothing; `dispose` removes the canvas and stops any pending frame.
  - `bundle.test.ts` (reads the built files, skipped when they are absent): `maxsen-home.js` does not contain `WebGLRenderer`; `maxsen-3d.js` contains no `customElements.define`, no `maxsen-home.js`, and does contain the three.js licence line.
  - `tests/test_init.py`: `GET /maxsen_static/maxsen-3d.js` returns 200.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `vite.three.config.ts`: lib build, entry `src/three/index.ts`, format `es`, file name `maxsen-3d.js`, same `outDir`, `emptyOutDir: false`, minified, legal comments kept. The main config keeps `emptyOutDir: true` and runs first.
  - Look (spec, "The look"): background `#070b16`; floors dark slabs with a faint per-room tint; walls translucent dark blocks with thin cyan (`#5fe3ff`) edge lines; glass lighter and more transparent; furniture dark translucent bodies with dimmer edge lines, `screen` parts slightly emissive; room names as sprite labels above each room centre; device badges in their 2D colours with the same SW / CP text; sensor and aircon pills with their text; glow as additive planes using one radial `DataTexture` (no post-processing).
  - Labels draw on a 2D canvas; when a 2D context is not available (tests) the label is skipped without error. Label textures are rebuilt only when their text changes.
  - `mount` appends one canvas (`role="img"`) to the host, sizes it to the host, and draws through one `invalidate()` that schedules at most one animation frame.
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test && npm run build && git status --short ../custom_components/maxsen/frontend`. Expected: PASS; two built files. Run `npm run build` a second time and confirm `git diff --stat` shows no further change (reproducible).
- [ ] **Step 5: Commit** `feat: 3D bundle that draws the house on demand`.

### Task 6: Camera, touch and picking

**Files:**
- Create: `frontend/src/three/camera.ts`, `frontend/src/three/input.ts`
- Modify: `frontend/src/three/index.ts`, `build.ts`
- Test: `frontend/test/three-camera.test.ts`, `three-input.test.ts`

**Interfaces:**
- Consumes: `buildHouse(...).pickables`, `ThreeCallbacks`, `ThreeHandle.enterRoom` / `resetView`.
- Produces: `camera.ts` exports pure `interface Orbit { target: V3; turn: number; tilt: number; distance: number }`, `openingOrbit(bounds, aspect): Orbit` (tilt 35°, turn 30°, framed to the rooms), `roomOrbit(room, wallHeight, aspect): Orbit`, `orbitBy(o, dTurn, dTilt): Orbit` (tilt clamped to 15°…80°), `zoomBy(o, factor, limits): Orbit`, `mix(a, b, t): Orbit`, `ease(t)`.

- [ ] **Step 1: Failing tests.**
  - Camera maths: the opening orbit sees all four corners of `bounds` inside the frame for aspect 1.6 and for 0.46 (phone); tilt never leaves 15°…80° under any `orbitBy`; `zoomBy` stops at 0.4× and 2.5× of the opening distance; `mix` at 0 and 1 returns the ends and takes the short way round in `turn`.
  - Input (fake renderer; pointer events on the canvas): a one-finger drag of 40 px turns the camera and draws frames, and calls neither `onTap` nor `onHold`; a press and release within 8 px and 500 ms calls `onTap` once with the ids under the point, best first, and host-px coordinates; a tap where two devices are within 22 px returns both ids; a tap on bare floor returns `elementIds: []` and that room's id; a tap on nothing returns `roomId: null`; a 500 ms still press calls `onHold` and no tap follows; two-finger pinch zooms and never taps; a wheel event zooms; a double tap on empty space (within 300 ms) resets to the opening orbit; arrow keys turn and `+` / `-` zoom when the canvas has focus.
  - `enterRoom(id)` animates over about 400 ms (frames drawn only while it runs, then none), ends at `roomOrbit`, lowers that room's wall pieces to 1.0 m and fades the other rooms' floors and furniture; `enterRoom(null)` and `resetView()` restore them; taps during the animation are ignored; `enterRoom` with an unknown id does nothing.
- [ ] **Step 2: Run** `npm test -- three-camera three-input`. Expected: FAIL.
- [ ] **Step 3: Implement.** Picking: raycast against `pickables`; devices within 22 px of the tap on screen (project each device's `at`) are candidates, ordered by screen distance, a direct ray hit first. Use the same constants as 2D (`LONG_PRESS_MS` 500, `MOVE_TOLERANCE` 8, `DOUBLE_TAP_MS` 300, `HIT_RADIUS_PX` 22), passed in through `ThreeMountOptions` defaults rather than imported from `floorplan-view.ts`.
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: camera, touch and picking for the 3D view`.

### Task 7: The 3D layer in the panel

**Files:**
- Create: `frontend/src/three-view.ts`
- Modify: `frontend/src/floorplan-view.ts` (`LAYER_LABELS` :62, `_visible` :358, `_reveal` :259, `_onHome` :272, `_onTap` / `_onHold` routing, `render` 991-1063, styles), `frontend/src/index.ts`
- Test: `frontend/test/three-view.test.ts`, `frontend/test/floorplan-view.test.ts`

**Interfaces:**
- Consumes: `loadThree`, `setThreeLoader`, `hasWebGL`, `setWebGLForTests`, `buildThreeModel`, `threeStates`, `usableRooms`, `layerOptions(plans, threeD)`.
- Produces:
  - `<maxsen-3d-view>` with properties `hass`, `home`, `level: HomeLevel`, `room: string | null`; method `resetView()`; events `maxsen-3d-tap` and `maxsen-3d-hold` (`detail: ThreeHit`), `maxsen-3d-failed` (`detail: { reason }`).
  - `floorplan-view` fires `maxsen-layer-changed` (`detail: { layer: Layer }`, bubbles, composed) whenever the shown layer changes, including the first render, and `maxsen-room-changed` (`detail: { roomId: string | null; name?: string; elementIds: string[] }`, bubbles, composed); it gains a public `leaveRoom()`.

- [ ] **Step 1: Failing tests.** A fake `ThreeModule` (records `mount` arguments, lets the test call the callbacks) is set through `setThreeLoader`; WebGL is switched on through `setWebGLForTests(true)`.
  - Toggle: with WebGL and the 3D fixture the toggle reads All, Smart Home, Lighting, 3D; without WebGL, on `home-v1.json`, or in `mode="link"` there is no 3D button and every existing test passes unchanged.
  - Choosing 3D mounts the view in the stage in place of the drawing, fires `maxsen-layer-changed` with `'3d'`, and loads the bundle once; switching back to All disposes the handle and shows the SVG again.
  - Opening view: `display.opening_view: '3d'` opens on 3D when it is offered and on All when it is not; `'2d'` or absent opens on All.
  - A state change in `hass` calls `handle.setStates` with new states and does not call `setModel`; a new plan `revision` or another level calls `setModel`; changing to a level without rooms falls back to that level's first 2D layer.
  - A `maxsen-3d-tap` with one element toggles it through the same path as a 2D tap (same `callService` call); with two elements the overlap picker opens at the tap point and choosing one operates it; `maxsen-3d-hold` opens details (`hass-more-info`) as 2D does; a tap with no element and a room id fires `maxsen-room-changed` for that room with the ids of the devices whose `roomId` it is, and calls `handle.enterRoom(id)`; `leaveRoom()` fires it with `roomId: null` and calls `enterRoom(null)`.
  - The fit button reads "Whole house" in 3D and calls `resetView()`.
  - Failure: the loader rejecting, `onFailed('error')` and `onFailed('context-lost')` each switch the layer to the first 2D option, show the notice "3D is not available on this screen right now.", and hide the 3D button until the home is loaded again. While the bundle loads the stage shows "Opening the 3D view…".
  - `_reveal(elementId)` from 3D switches to All as today.
- [ ] **Step 2: Run** `npm test`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** `three-view.ts` is a Lit element in the main bundle: it builds the model and states, mounts through `loadThree()`, observes its own size and calls `resize`, and disposes on disconnect. `floorplan-view.ts` decides `threeD = mode === 'use' && hasWebGL() && !!usableRooms(level) && !this._threeFailed`.
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: 3D layer in the Home panel`.

### Task 8: Entering a room: room tiles

**Files:**
- Create: `frontend/src/tile.ts`, `frontend/src/room-tiles.ts`
- Modify: `frontend/src/quick-panel.ts` (use `tile.ts`; no visible change), `frontend/src/maxsen-home-panel.ts:313-332` (quick-panel slot), `frontend/src/index.ts`
- Test: `frontend/test/room-tiles.test.ts`, `frontend/test/panel.test.ts`, `frontend/test/quick-panel.test.ts` (unchanged and passing)

**Interfaces:**
- Consumes: `maxsen-room-changed`, `floorplan-view.leaveRoom()`, `visualState`, `linkEntityIds`, `toggleEntities`.
- Produces: `tile.ts` exports `interface Tile { key: string; name: string; state: string; on: boolean; disabled: boolean }`, `renderTile(tile: Tile, onPress: () => void): TemplateResult`, `tileStyles: CSSResult`; `<maxsen-room-tiles>` with properties `hass`, `home`, `roomName: string`, `elementIds: string[]` and event `maxsen-room-back`.

- [ ] **Step 1: Failing tests.**
  - `room-tiles`: heading is the room's name with a "Back" button that fires `maxsen-room-back`; one tile per element in `elementIds`, named by the element's label (or product name), with the 2D state text and on/off look; pressing a light's tile toggles it; a tile for a device that cannot be switched (sensor) opens details; an unlinked element's tile is disabled and reads "Not linked"; no devices → "No devices in this room yet."
  - Panel: on `maxsen-room-changed` with a room the quick-panel slot shows `<maxsen-room-tiles>` instead of the quick panel (the Installer button stays reachable in its slot); `maxsen-room-back` and `roomId: null` bring the quick panel back; in the full panel entering a room pushes one history entry and a `popstate` calls `leaveRoom()`; leaving through Back in the tiles removes that entry (`history.back()` once) so the next Android back does not fire twice; the embedded card pushes no history entry.
  - Quick panel: every existing test passes; tiles render through `renderTile`.
- [ ] **Step 2: Run** `npm test`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: room tiles when a room is entered in 3D`.

### Task 9: Dark look, the Maxsen logo and the installer's opening-view switch

**Files:**
- Create: `frontend/src/logo.ts`
- Modify: `frontend/src/maxsen-home-panel.ts` (`render` 343-354, styles 356-458), `frontend/src/link-mode.ts` (`_renderTools` 1392-, beside the original-background switch), `frontend/src/maxsen-floorplan-card.ts` only if a test needs it
- Test: `frontend/test/panel.test.ts`, `frontend/test/link-mode.test.ts`

**Interfaces:**
- Consumes: `maxsen-layer-changed`, `setDisplay(hass, entryId, { opening_view })`.
- Produces: `logo.ts` exports `MAXSEN_LOGO: string` (a PNG data URI, 56 px high, made from the planner's `apps/web/public/sample/maxsen-logo.png`, under 12 KB); the panel reflects a `neon` attribute while the shown layer is `'3d'` and it is not embedded.

- [ ] **Step 1: Failing tests.**
  - Panel: the header shows `<img class="logo" alt="Maxsen">` left of the home's title in every layer; the embedded card has no header and no logo (existing test stays).
  - On `maxsen-layer-changed` `'3d'` the panel has the `neon` attribute; on any other layer it does not; the embedded card never has it. With `neon`, the computed values of `--card-background-color`, `--primary-text-color`, `--secondary-text-color`, `--divider-color`, `--secondary-background-color` and `--app-header-background-color` on the host are the dark set, whatever the outer theme set them to (test under a light and a dark set of outer variables); the logo has the class that inverts it.
  - Link mode tools: a switch "Open in 3D" shows only when some level has a usable rooms layer; it is on when `display.opening_view === '3d'`; pressing it calls `maxsen/display/set` with only `opening_view`; a refusal shows the same message style as the background switch.
- [ ] **Step 2: Run** `npm test`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** Dark set: `--card-background-color: #0d1424`, `--secondary-background-color: #070b16`, `--primary-text-color: #e8f1ff`, `--secondary-text-color: #93a4bf`, `--divider-color: #1e2a44`, `--app-header-background-color: #0a1020`, `--app-header-text-color: #e8f1ff`, `--primary-color: #5fe3ff`, `--text-primary-color: #06101c`, `--disabled-color: #4a5670`, set on `:host([neon])` so the quick panel, room tiles and view inherit them. Generate the logo once with a throwaway script (not committed) and paste the data URI.
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: dark look in 3D, Maxsen logo, opening view switch`.

### Task 10: Preview app and a real-browser check

**Files:**
- Modify: `frontend/preview/main.ts` (sample home becomes `home-v1-3d.json`; `setThreeLoader(() => import('../src/three/index'))`), `frontend/preview/fake-hass.ts` (lights get `brightness`, some get `rgb_color` or `color_temp_kelvin`; `light.turn_on` accepts them), `frontend/preview/validate-package.ts` (drops an unusable rooms layer with the Task 2 check, keeps the home), `README.md` ("See it on your Mac": a 3D paragraph)
- Create: `frontend/preview/check-3d.mjs` (a Playwright script, run by hand, not in CI)
- Test: `frontend/test/fake-hass.test.ts`

- [ ] **Step 1: Failing tests** in `fake-hass.test.ts`: lights carry `brightness`; `light.turn_on` with `rgb_color` stores it; a home file with a broken rooms layer opens with 2D only.
- [ ] **Step 2: Implement**, then `npx tsc --noEmit && npm test && npm run build`. Expected: PASS.
- [ ] **Step 3: Write and run `check-3d.mjs`** against `npm run preview` (Chromium, `--trace off`), at 1280×800 and 390×844: open the 3D layer; record the time from choosing 3D to the first frame; confirm the frame counter (`handle.frames`, exposed on the element for the check) does not move over 3 idle seconds; tap a downlight and confirm its entity toggled and the frame count rose; drag and confirm the picture changed; tap a floor and confirm room tiles appear and Back returns; switch the page to a dark and a light outer theme. Save screenshots to the session scratchpad. Expected: all assertions pass. Fix what fails in the task that owns it.
- [ ] **Step 4: Commit** `feat: 3D sample home in the preview app`.

### Task 11: Dairy Farm in real Home Assistant

**Files:** none committed except `README.md` (a short "3D view" section under the panel description: how to turn it on, what it needs, that linking stays 2D).

- [ ] **Step 1:** Start the test Home Assistant (session scratchpad `ha-system-test`, `scripts/restart-ha.sh`), install this branch's integration, and refresh the Dairy Farm home from the planner branch's home file that carries the rooms layer (session scratchpad `dairy-clean/dairy-farm-clean-home.json`; never committed).
- [ ] **Step 2:** In installer mode switch "Open in 3D" on; reload; confirm the panel opens in 3D, the whole panel is dark, the logo shows, all linked demo devices sit in the right rooms, a light tap changes the real entity and the room washes in its colour, entering a room shows its tiles, Back returns, and the dashboard card shows only its house dark. Screenshots at 1280×800 and 390×844.
- [ ] **Step 3:** Measure in Chromium: time to first frame, frames drawn over 10 idle seconds (expected 0), tap-to-frame time (expected under 100 ms), size of `maxsen-3d.js`. Write the numbers, the screenshots and anything that looked wrong into a report in the session scratchpad. The Android wall-panel check stays with the owner.
- [ ] **Step 4:** Run `.venv/bin/pytest -q && cd frontend && npx tsc --noEmit && npm test && npm run build && git diff --exit-code ../custom_components/maxsen/frontend`. Expected: PASS and clean. Commit `docs: the 3D view` and push.
