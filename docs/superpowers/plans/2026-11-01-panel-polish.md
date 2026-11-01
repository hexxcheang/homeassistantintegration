# Wall Panel Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Maxsen Home floor plan screen dependable and readable on real wall panels. That means surviving HA restarts with no duplicate subscriptions, soft backgrounds, opening fitted to the rooms, an All/Smart Home/Lighting toggle, and a picker for overlapping devices.

**Architecture:**
- **Restart behaviour:** fixes in `maxsen-home-panel.ts` and `api.ts`.
- **Display setting:** a new per-home value in the store (`display.background`), returned by `maxsen/home` and set through a new installer-only `maxsen/display/set` command.
- **Drawing changes:** soft background, fitted view, layer toggle and picker, all in `floorplan-view.ts`, plus small helper modules with unit tests.

**Tech Stack:** Python 3.13 / HA 2026.2.3 (`.venv/bin/pytest`), TypeScript + Lit 3 + Vitest/happy-dom (`cd frontend && npm test`, `npm run typecheck`, `npm run build`).

**Spec:** `docs/superpowers/specs/2026-11-01-panel-polish-design.md`

## Global Constraints

- Display setting values: `background` is `"soft"` (default) or `"original"`. Any logged-in user can read it; changing it needs an admin **and** `installer_mode`, enforced in the websocket handler. Unauthorised calls get error code `not_allowed`.
- Fitted view: the box around all drawn scene items on the level, plus an **8%** margin on each side, clamped to the drawing.
- Layer toggle labels, exactly: `All`, `Smart Home`, `Lighting`.
- `All` is the default when the level's plans share a background. With different backgrounds only `Smart Home | Lighting` is shown (unchanged behaviour).
- The "Whole drawing" button label is exactly `Whole drawing`.
- Restart retry uses the existing backoff of 2/5/10/30 s and keeps the home that is already on screen while retrying.
- Subscriptions use home-assistant-js-websocket's `{ resubscribe: false }`. On reconnect, the old unsubscribe handle is dropped without being called.
- Staff free text is rendered only through Lit bindings (no `innerHTML` or `unsafe*`).
- The preview app's fake (`frontend/preview/fake-hass.ts`) mirrors every server change.
- The bundle `custom_components/maxsen/frontend/maxsen-home.js` is rebuilt and committed in every task that touches `frontend/src`. It must be reproducible with a clean `npm ci && npm run build`.
- Commit messages end with the session's two attribution lines. Push after each task.

## Review Focus

1. **HA restarts and the entry is listed but still `setup_in_progress`.** The panel must keep the current home on screen and retry, never show "not set up yet". *(Task 1 test)*
2. **Several reconnects in a row (Wi-Fi blips).** There must be exactly one live `maxsen/subscribe` afterwards, and no `unsubscribe_events` sent with a stale id. *(Task 1 test)*
3. **A level whose scene has no items yet** (nothing placed). The fitted view must fall back to the whole drawing, never a zero-size view box. *(Task 3 test)*
4. **A tap exactly between two touching switch markers.** The picker must list both. A tap on one isolated marker must act directly with no picker. *(Task 4 test)*
5. **A non-admin wall panel user, or an admin with installer mode off, calls `maxsen/display/set`.** The call is refused with `not_allowed`, and the setting is unchanged. *(Task 2 test)*

---

### Task 1: Panel survives restarts and keeps one subscription

**Files:**
- Modify: `frontend/src/api.ts`: `findEntryId`, `subscribe`
- Modify: `frontend/src/maxsen-home-panel.ts`: `_start`, `_onReconnect`, `_resubscribe`
- Modify: `frontend/src/hass-util.ts` (the `HassLike` connection type, if needed)
- Modify: `frontend/preview/fake-hass.ts` so its connection fires `ready` and resubscribes the way home-assistant-js-websocket does
- Test: `frontend/test/maxsen-home-panel.test.ts`, `frontend/test/api.test.ts`

**Interfaces:**
- Produces:
  - `findEntry(hass: HassLike): Promise<{ entryId: string; state: string } | undefined>`. Returns the first `maxsen` entry with its `state`, and replaces the loaded-only lookup.
  - `subscribe(hass, entryId, cb)` passes `{ resubscribe: false }` as the third argument to `subscribeMessage`.

- [ ] **Step 1: Write failing tests**
  - `stays on the home and retries while the entry is still loading after a reconnect`: the first `config_entries/get` returns state `setup_in_progress`, the second returns `loaded`. After the first reconnect the home stays rendered and "not set up yet" never appears. After the 2 s retry the subscription is live.
  - `shows "not set up yet" only when no maxsen entry exists on a fresh start`
  - `leaves one subscription after three reconnects`: the fake connection resubscribes like home-assistant-js-websocket unless `resubscribe:false` is passed. After three `ready` events, exactly one active `maxsen/subscribe` exists, and no unsubscribe was sent for a previous connection's id.
  - `api.subscribe passes { resubscribe: false }`
- [ ] **Step 2: Run** `cd frontend && npx vitest run test/maxsen-home-panel.test.ts test/api.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes above:
  - An entry that is listed but not loaded during a reconnect or retry run counts as retry-later.
  - On a fresh first start, no entry at all shows "not set up yet".
  - Update the preview fake to match.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`. Expected: PASS, and the bundle rebuilds.
- [ ] **Step 5: Commit** `fix(frontend): wall panel survives HA restarts with one live subscription`, then push.

### Task 2: Display setting (server and preview)

**Files:**
- Modify: `custom_components/maxsen/store.py`:
  - data gains `"display": {"background": "soft"}` (missing on old stores means the default)
  - `async_set_display(display: dict) -> None` goes through `_async_write`, then announces `home`
- Modify: `custom_components/maxsen/websocket.py`:
  - `maxsen/home` result gains `"display": {"background": "soft"|"original"}`
  - new command `maxsen/display/set` with `{entry_id, background: "soft"|"original"}`, gated by `_installer_only`, returning `{"display": {...}}`
- Modify: `frontend/src/types.ts` (`HomeResponse.display`), `frontend/src/api.ts` (`setDisplay(hass, entryId, background)`), `frontend/preview/fake-hass.ts` (same command, same gating)
- Test: `tests/test_websocket.py`, `frontend/test/fake-hass.test.ts`

**Interfaces:**
- Produces:
  - `HomeResponse.display: { background: 'soft' | 'original' }`
  - `setDisplay(hass: HassLike, entryId: string, background: 'soft'|'original'): Promise<{display: {...}}>`

- [ ] **Step 1: Write failing tests**
  - `maxsen/home` returns `display.background == "soft"` for a store saved before this change.
  - An admin with installer mode sets `"original"`. The value persists across a store reload, and a subscriber receives `{"event": "home"}`.
  - **Review Focus 5:** a non-admin gets `not_allowed`; an admin with installer mode off gets `not_allowed`; the value is unchanged.
  - `background: "dark"` gets `invalid_format`.
  - The fake gives the same results for the same calls.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_websocket.py -q` and `cd frontend && npx vitest run test/fake-hass.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the store field, both commands, the types, the API wrapper and the fake.
- [ ] **Step 4: Run** `.venv/bin/pytest -q && cd frontend && npm test && npm run typecheck && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: per-home background display setting`, then push.

### Task 3: Soft background, fitted view, layer toggle

**Files:**
- Create: `frontend/src/view-geometry.ts` with:
  - `contentBox(items: SceneItem[], width: number, height: number, margin = 0.08): {x,y,w,h}`
  - `layerOptions(plans: HomePlan[]): Array<'all'|'smart-home'|'lighting'>`
- Modify: `frontend/src/floorplan-view.ts`:
  - background filter when `home.display.background === 'soft'`
  - starts on the fitted box per level
  - double-tap returns to the fitted box
  - `Whole drawing` button
  - layer control
- Modify: `frontend/src/link-mode.ts`: an "Original background" switch in the installer toolbar that calls `setDisplay` and shows the server's error message if refused
- Test: `frontend/test/view-geometry.test.ts`, `frontend/test/floorplan-view.test.ts`, `frontend/test/link-mode.test.ts`

**Interfaces:**
- Consumes: Task 2 `HomeResponse.display`, `setDisplay`.
- Produces: `contentBox` and `layerOptions` as above.
  - `layerOptions` returns `['all','smart-home','lighting']` when both plan types exist and their `background.key` values are equal.
  - It returns `['smart-home','lighting']` when both exist with different keys, and `[]` when only one plan exists.

- [ ] **Step 1: Write failing tests**
  - `contentBox` around items spanning x 200–400 and y 300–500 on a 1000×1400 drawing equals `{x:184, y:284, w:232, h:232}` (8% of 200 is 16 on each side), and is clamped at 0 and the drawing size.
  - **Review Focus 3:** with no items, `contentBox` returns `{x:0, y:0, w:1000, h:1400}`.
  - `layerOptions` covers all three cases.
  - The view:
    - opens with `viewBox` equal to the fitted box
    - `Whole drawing` switches to the full drawing
    - double-tap returns to the fitted box
    - the background `<image>` gets the soft class when `display.background` is `soft` and not when it is `original`
    - the `All | Smart Home | Lighting` control shows only the chosen layer's items
  - Link mode: toggling "Original background" calls `setDisplay(..., 'original')`, and a refusal shows the server message.
- [ ] **Step 2: Run** `cd frontend && npx vitest run test/view-geometry.test.ts test/floorplan-view.test.ts test/link-mode.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Soft filter: CSS on the background image, `filter: grayscale(1) contrast(0.55) brightness(1.25); opacity: 0.6`. Treat these values as the builder's starting point; tune them by eye in the preview with the fixture.
  - Keep the zoom/pan clamps (1×–6×) relative to the current base view.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`. Expected: PASS. Take Playwright screenshots of the preview (soft and original, fitted and whole drawing) into the SDD workspace.
- [ ] **Step 5: Commit** `feat(frontend): soft backgrounds, fit to rooms, layer toggle`, then push.

### Task 4: Cluster picker

**Files:**
- Create: `frontend/src/hit-test.ts` with `elementsAt(point: {x,y}, items: Array<{elementId, x, y, hitRadius}>): string[]`. Coordinates are in screen pixels; the result is ordered nearest first.
- Modify: `frontend/src/floorplan-view.ts`:
  - pointer handling resolves the tap point against every interactive item's hit area (markers: centre plus `hitRadius`; paths: nearest-point distance against the hit stroke half-width)
  - one hit acts directly
  - more than one hit opens `<div class="picker" role="dialog">`, which lists each hit (label or productName, plus live `visualState` text) and closes on choose, outside tap or Escape
  - in link mode, choosing an entry emits `maxsen-element-tap` for that element
- Test: `frontend/test/hit-test.test.ts`, `frontend/test/floorplan-view.test.ts`

**Interfaces:**
- Produces: `elementsAt` as above. `distanceToPath(point, points: Pt[]): number` is exported from the same module.

- [ ] **Step 1: Write failing tests**
  - `elementsAt` returns `['a','b']` for a point midway between markers `a`(100,100) and `b`(130,100) with hitRadius 22.
  - It returns `['a']` for a point at (80,100).
  - `distanceToPath` gives the perpendicular distance to a segment, and endpoint distance beyond its ends.
  - View, **Review Focus 4:**
    - a tap between two touching switch markers opens the picker listing both, and choosing one toggles only that one
    - a tap on an isolated marker toggles directly with no picker
    - hold on a cluster opens the picker, and choosing opens more-info
    - in link mode, choosing emits `maxsen-element-tap` with that id
    - Escape closes the picker
- [ ] **Step 2: Run** `cd frontend && npx vitest run test/hit-test.test.ts test/floorplan-view.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the module and the view changes.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build && cd .. && .venv/bin/pytest -q`. Expected: PASS. Take a Playwright screenshot of the picker in the preview.
- [ ] **Step 5: Commit** `feat(frontend): pick from overlapping devices`, then push.
