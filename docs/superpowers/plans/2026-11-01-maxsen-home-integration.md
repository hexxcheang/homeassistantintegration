# Maxsen Home: HA Integration and Floor Plan Card Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Home Assistant custom integration (`maxsen`) that pairs with the Maxsen Planner (or takes a home file), shows the home's floor plans as a live, tappable panel with a customer-editable quick-functions panel, and lets installers link planned devices to real ones and create starter scenes.

**Architecture:** Python integration under `custom_components/maxsen/`: config flow (pairing code or file), planner client, storage (package, links, quick panel), websocket API, authenticated image view, scene platform, and a sidebar panel plus a Lovelace card. The UI is a Lit + TypeScript web component in `frontend/`, built into `custom_components/maxsen/frontend/maxsen-home.js` and committed, so HACS installs it with the integration.

**Tech Stack:** Python 3.13, Home Assistant ≥ 2025.1, `pytest-homeassistant-custom-component`; TypeScript, Lit 3, Vite (library build), Vitest + happy-dom.

**Repo:** `hexxcheang/homeassistantintegration` (public, installed as a HACS custom repository).

**Spec:** `docs/superpowers/specs/2026-11-01-maxsen-floorplan-dashboard-design.md`. **Depends on:** Plan 1 (`2026-11-01-planner-home-assistant-connection.md`). Its "home package" section is the input contract. Read it before starting.

## Global Constraints

- **No secrets in the repo**: no planner credentials, tokens or customer data. The pairing token lives only in the config entry's `data`.
- The planner address is entered by the installer in the config flow (a URL field, `https://` required except for `localhost`).
- Refresh is **manual only** (installer taps "Refresh from planner"). Nothing polls the planner.
- Link mode, refresh and "Create starter scenes" need **both** an HA admin user **and** the integration option `installer_mode: true`, enforced on the server side (websocket handlers), not just hidden in the UI.
- Any logged-in user may read the home and edit the quick panel. There is one shared quick-panel list per home.
- Unlinked elements are drawn greyed and don't respond to taps outside link mode.
- Element links: `{"type": "device", "id": <device_id>}` or `{"type": "entity", "id": <entity_id>}`. Lighting categories (`downlights`, `surface-lights`, `track-lights`, `led-strips`, `magnetic-track-lights`, `pendant-lights`, `spotlights`, `misc-lighting`, `ceiling-fans`) link to **entities**. The rest link to **devices**.
- Starter scenes are named exactly: `All off`, `All off – <level name>` (one per level), `All lights off`.
- Package accepted only if `format == "maxsen-home"` and `schemaVersion == 1`, and the size is ≤ 100 MB.
- `hacs.json`: `{"name": "Maxsen Home", "homeassistant": "2025.1.0", "render_readme": true}`. The integration version comes from `manifest.json` `version` and matches the GitHub release tag.
- Integration `iot_class`: `cloud_polling` (it calls the planner on demand). `config_flow: true`. Dependencies: `http`, `frontend`, `panel_custom`, `websocket_api`, `file_upload`.

## File Structure

```
hacs.json
README.md                              # install via HACS, pairing, installer guide
.github/workflows/ci.yml               # pytest, vitest, bundle freshness, hassfest, HACS validation
custom_components/maxsen/
  __init__.py      # setup/unload entry, register panel, card JS, image view, websocket commands
  manifest.json
  const.py         # DOMAIN, option keys, lighting category set, starter scene names
  package.py       # parse/validate HomePackage, save images, diff two packages
  planner.py       # PlannerClient: pair(), fetch_home(); typed errors
  config_flow.py   # user → pair | upload; options flow (installer_mode)
  store.py         # MaxsenStore: package meta, links, quick panel (HA Store)
  websocket.py     # maxsen/* commands
  http.py          # MaxsenImageView (auth required)
  scene.py         # starter scene entities
  strings.json, translations/en.json
  frontend/maxsen-home.js              # built bundle (committed)
frontend/
  package.json, tsconfig.json, vite.config.ts
  src/types.ts         # HomePackage TS types (copy of Plan 1 contract) + link/quick-panel types
  src/scene-svg.ts     # Scene → SVG element descriptors
  src/visual-state.ts  # element + link + hass states → what to draw
  src/link-candidates.ts
  src/api.ts           # websocket + image fetch wrappers
  src/floorplan-view.ts, src/quick-panel.ts, src/link-mode.ts
  src/maxsen-home-panel.ts, src/maxsen-floorplan-card.ts
  test/*.test.ts
  preview/             # run-on-your-Mac preview with a simulated Home Assistant (Task 8)
tests/
  conftest.py, fixtures/home-v1.json (small valid package: 2 levels, 1×1 PNG images)
  test_package.py, test_config_flow.py, test_websocket.py, test_refresh.py, test_scene.py, test_init.py
```

## Review Focus

1. **A linked device deleted or unavailable in HA.** The customer expects that element to show greyed "unavailable", taps doing nothing, and the rest of the plan working. Link mode marks it "missing". *(Task 6 test, Task 3 test)*
2. **Refresh when the token is revoked or the planner is unreachable.** The installer expects a clear message ("Connection revoked: ask Maxsen for a new pairing code" / "Can't reach the planner") and the current home keeps working, unchanged. *(Task 4 test)*
3. **A bad home file** (wrong format, `schemaVersion: 2`, invalid JSON, over 100 MB). The setup form shows an error and nothing is stored. *(Task 1 and Task 2 tests)*
4. **A refresh removes an element that is in the quick panel or a starter scene.** It disappears from both, and the refresh summary lists it. *(Task 4 test)*
5. **Quick panel edited on the wall panel while a phone is open.** The last save wins, and the other screen updates without reloading (subscription event). *(Task 3 test)*

---

### Task 1: Integration skeleton, package parsing, CI

**Files:**
- Create: `hacs.json`, `custom_components/maxsen/{manifest.json,const.py,package.py,__init__.py (empty setup returning True for now)}`
- Create: `tests/conftest.py`, `tests/fixtures/home-v1.json`, `tests/test_package.py`, `requirements_test.txt` (pin the latest `pytest-homeassistant-custom-component`)
- Create: `.github/workflows/ci.yml` (pytest; `home-assistant/actions/hassfest`; `hacs/action` with `category: integration`)

**Interfaces:**
- Produces in `package.py`:
  - `class PackageError(Exception)` with `.reason: Literal["invalid_json","wrong_format","unsupported_version","too_large","missing_image"]`
  - `def parse_package(raw: bytes) -> dict` (validates format, version, size ≤ 100 MB, and that every `plan.background.imageId` is in `images`)
  - `async def save_images(hass, entry_id: str, pkg: dict) -> dict`: writes `hass.config.path("maxsen", entry_id, f"{image_id}.{ext}")`, returns the package **without** the `images` data, plus `image_types: {image_id: media_type}`
  - `def element_index(pkg: dict) -> dict[str, dict]`: element id → `{**element, "levelId", "planId", "planType"}`
  - `def diff_packages(old: dict, new: dict) -> {"added": [ids], "removed": [ids], "changed_drawings": [plan ids whose revision changed]}`

- [ ] **Step 1: Write failing tests:** a valid fixture parses; `format: "other"` → `wrong_format`; `schemaVersion: 2` → `unsupported_version`; `b"{"` → `invalid_json`; 100 MB + 1 byte → `too_large`; a missing image → `missing_image`; `save_images` writes 2 files and strips `data`; `diff_packages` detects one added, one removed, one revision change.
- [ ] **Step 2: Run** `pytest tests/test_package.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `package.py`, the manifest and `hacs.json`.
- [ ] **Step 4: Run** `pytest tests/test_package.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: maxsen integration skeleton and home package parsing`

### Task 2: Planner client, config flow, options flow, entry setup

**Files:**
- Create: `custom_components/maxsen/planner.py`, `config_flow.py`, `strings.json`, `translations/en.json`
- Modify: `custom_components/maxsen/__init__.py` (`async_setup_entry` loads the stored package; `async_unload_entry`)
- Test: `tests/test_config_flow.py`

**Interfaces:**
- `class PlannerClient(session, base_url: str)`:
  - `async pair(code: str, device_name: str) -> {"token","projectId","title"}`
  - `async fetch_home(token: str) -> bytes`
  - errors: `PlannerBadCode`, `PlannerRevoked` (401 revoked/unknown), `PlannerTooMany` (429), `PlannerUnreachable` (network error, timeout 60 s, 5xx), `PlannerNotReady` (409, carries the planner's `message`)
- Endpoints per Plan 1: `POST {base}/api/public/home-assistant/pair`, `GET {base}/api/public/home-assistant/home` with `Authorization: Bearer`.
- Config flow steps: `user` (menu: `pair` / `upload`) → `pair` (fields `planner_url`, `code`) or `upload` (`FileSelector(accept=".json")`, read via `file_upload.process_uploaded_file`). Entry `data`: `{"source": "planner"|"file", "planner_url"?, "token"?, "project_id", "title"}`; entry title = project title; `unique_id` = project id (abort `already_configured`).
- Package handling in the flow: `parse_package` → `save_images` → `MaxsenStore.async_save_package` (Task 3 interface; in this task, write it through a thin `store.py` stub with `async_save_package(pkg)`, which Task 3 extends).
- Options flow: `installer_mode: bool` (default `True` on a new entry).
- Errors shown as form errors: `bad_code`, `too_many`, `cannot_connect`, `not_ready`, `invalid_file`, `unsupported_version`, `too_large`.

- [ ] **Step 1: Write failing tests** (aiohttp mocked with `aioclient_mock`): pair success creates an entry titled after the project, with the token in `data`; a 401 → `bad_code`; a 429 → `too_many`; a timeout → `cannot_connect`; uploading a `schemaVersion: 2` file → `unsupported_version` with no entry and no files written (**Review Focus 3**); a duplicate project → abort `already_configured`; the options flow toggles `installer_mode`.
- [ ] **Step 2: Run** `pytest tests/test_config_flow.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the client, the flows and the entry setup.
- [ ] **Step 4: Run** `pytest -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: pair with Maxsen Planner or upload a home file`

### Task 3: Store, websocket API, image view

**Files:**
- Modify: `custom_components/maxsen/store.py`
- Create: `custom_components/maxsen/websocket.py`, `http.py`
- Modify: `custom_components/maxsen/__init__.py` (register the view and commands once per HA start)
- Test: `tests/test_websocket.py`

**Interfaces:**
- `class MaxsenStore(hass, entry_id)` backed by `homeassistant.helpers.storage.Store(hass, 1, f"maxsen.{entry_id}")`. Data: `{"package": dict, "links": {element_id: Link}, "quick_panel": [QuickItem], "scenes": [StarterScene]}`.
  - `QuickItem = {"type": "element", "id": element_id} | {"type": "entity", "id": entity_id}` (scenes are entities)
  - methods: `async_load()`, `async_save_package(pkg)`, `async_set_links(updates: dict[str, Link|None])`, `async_set_quick_panel(items)`, `property data`
- Websocket commands (all take `entry_id`):
  - `maxsen/home` → `{"package", "links", "quick_panel", "installer_mode", "image_urls": {image_id: "/api/maxsen/image/<entry_id>/<image_id>"}}` (any user)
  - `maxsen/links/set` `{updates}` → `{"links"}` (admin + installer_mode, else error `not_allowed`)
  - `maxsen/quick_panel/set` `{items}` → `{"quick_panel"}` (any user). It fires the bus event `maxsen_quick_panel_updated` `{entry_id}`.
  - `maxsen/subscribe` → a subscription that pushes `{"event": "quick_panel"|"home"|"links"}` when those change
- `MaxsenImageView`: `GET /api/maxsen/image/{entry_id}/{image_id}`, `requires_auth = True`. Serves the saved file with its media type. Rejects `image_id` not matching `^[A-Za-z0-9_-]{1,64}$`.

- [ ] **Step 1: Write failing tests** (`hass_ws_client`, `hass_client`, `hass_admin_user` / non-admin user fixtures):
  - `maxsen/home` returns the package without image data, and the image URLs.
  - A non-admin `links/set` → `not_allowed`; an admin with `installer_mode: false` → `not_allowed`; an admin with installer mode → saved and persisted across a store reload.
  - A non-admin `quick_panel/set` succeeds.
  - **Review Focus 5:** two clients; client A sets the quick panel; client B's subscription receives `{"event": "quick_panel"}`.
  - **Review Focus 1:** `maxsen/home` still succeeds when a linked entity no longer exists (links are returned as stored; the card decides how to show it).
  - The image view: unauthenticated → 401; `../x` → 404; a valid id → 200 with the right content type.
- [ ] **Step 2: Run** `pytest tests/test_websocket.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the store, commands and view.
- [ ] **Step 4: Run** `pytest -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: websocket API, links, quick panel and image view`

### Task 4: Refresh from planner

**Files:**
- Modify: `custom_components/maxsen/websocket.py`, `store.py`
- Test: `tests/test_refresh.py`

**Interfaces:**
- `maxsen/refresh/preview` → fetches with the stored token, parses, keeps the result in memory for 10 minutes under a `preview_id`, returns `{"preview_id", "added": [...], "removed": [...], "changed_drawings": [...]}` (element ids with `productName`/`label` for display). Admin + installer_mode.
- `maxsen/refresh/apply` `{preview_id}` → saves images and package, drops links, quick-panel items and starter-scene members for removed element ids, then returns the same summary. Admin + installer_mode.
- Errors: `revoked` (message "Connection revoked: ask Maxsen for a new pairing code"), `too_many` (planner answered 429: "The planner is busy. Try again in 15 minutes." Never treat it as revoked), `cannot_connect` ("Can't reach the planner"), `not_ready` (the planner's message), `invalid_package`, `preview_expired`. For `source: "file"` entries, preview takes `{file_id}` (an uploaded file) instead of fetching.

- [ ] **Step 1: Write failing tests:**
  - **Review Focus 2:** the planner returns 401 → error `revoked`, and the stored package and links are unchanged; a timeout → `cannot_connect`, unchanged.
  - **Review Focus 4:** a new package without element `e2` (which was linked, in the quick panel and in `All off`) → after apply, `e2` is gone from links, quick panel and scene members, and `removed` contains `e2`.
  - Links for surviving element ids are kept.
  - Apply with an unknown or expired `preview_id` → `preview_expired`.
- [ ] **Step 2: Run** `pytest tests/test_refresh.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** preview and apply.
- [ ] **Step 4: Run** `pytest -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: manual refresh from planner with change summary`

### Task 5: Starter scenes

**Files:**
- Create: `custom_components/maxsen/scene.py`
- Modify: `websocket.py` (`maxsen/scenes/create_starter`), `__init__.py` (forward the `scene` platform)
- Test: `tests/test_scene.py`

**Interfaces:**
- `StarterScene = {"id": str, "name": str, "entity_ids": [str]}` stored in `MaxsenStore.data["scenes"]`.
- `build_starter_scenes(pkg, links, hass) -> list[StarterScene]`: resolve each link to entity ids (device links → the device's entities in domains `light`, `switch`, `fan`, `climate`; entity links as-is):
  - `All off`: every resolved entity
  - `All off – <level name>`: entities of elements on that level
  - `All lights off`: entities of elements in lighting categories (`const.LIGHTING_CATEGORIES`)
  - Levels with no linked entities get no scene.
- `MaxsenStarterScene(Scene)` entity per stored scene, `unique_id = f"{entry_id}_{scene_id}"`. `async_activate` calls `homeassistant.turn_off` for its `entity_ids`.
- `maxsen/scenes/create_starter` (admin + installer_mode) replaces the stored starter scenes, reloads the platform, and **appends** new starter scene entity ids to the quick panel if not already there.

- [ ] **Step 1: Write failing tests:** a two-level package with a 3-gang switch device (3 `switch.` entities) on level 1 and a downlight linked to `switch.l1_gang2` → `All off` has 3 entities; `All off – Level 1` has 3; `All lights off` has `switch.l1_gang2` only; no scene for an empty level 2. Activating `All lights off` turns off `switch.l1_gang2` (service call captured). The scene entities appear in the quick panel after creation. Running it twice doesn't duplicate quick-panel items.
- [ ] **Step 2: Run** `pytest tests/test_scene.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the scene builder, entities and command.
- [ ] **Step 4: Run** `pytest -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Maxsen starter scenes`

### Task 6: Frontend foundation: types, drawing model, visual state, link candidates

**Files:**
- Create: `frontend/package.json` (lit, vite, typescript, vitest, happy-dom; scripts `build`, `test`), `frontend/tsconfig.json`, `frontend/vite.config.ts` (library build, single ES module output to `../custom_components/maxsen/frontend/maxsen-home.js`)
- Create: `frontend/src/types.ts`, `scene-svg.ts`, `visual-state.ts`, `link-candidates.ts`
- Test: `frontend/test/scene-svg.test.ts`, `visual-state.test.ts`, `link-candidates.test.ts`
- Modify: `.github/workflows/ci.yml` (`npm ci && npm test && npm run build` in `frontend/`, then `git diff --exit-code custom_components/maxsen/frontend`)

**Interfaces:**
- `types.ts`: `HomePackage`, `HomePlan`, `HomeElement`, `Scene` and its item types, mirroring Plan 1 exactly. Also `Link`, `QuickItem`, `HomeResponse` (the `maxsen/home` result).
- `sceneToSvg(scene: Scene): SvgNode[]`, where `SvgNode = {tag: 'path'|'text'|'g'; attrs: Record<string,string>; elementId?: string; children?: SvgNode[]}`. Markers: `pathD` scaled by `size`, translated to `(x,y)`, rotated by `rotation`; paths use `d`, `strokeWidth`, `dash`; badges and labels as `text`.
- `visualState(el: HomeElement, link: Link | undefined, hass: HassLike): VisualState`, where `VisualState = {status: 'unlinked'|'missing'|'unavailable'|'on'|'off'|'alert'|'idle'; text?: string; position?: number}`:
  - no link → `unlinked`; the linked entity/device not in `hass` → `missing`; all states `unavailable`/`unknown` → `unavailable`
  - lights/switches: any entity `on` → `on`, else `off`
  - `cover`: `position` from `current_position`; `text` `Open`/`Closed`/`<n>%`
  - `binary_sensor` on with device class in {`door`,`window`,`motion`,`occupancy`,`smoke`,`moisture`,`gas`} → `alert`; a `sensor` → `idle` with `text` = state + unit
  - `climate`: `text` = `"<hvac_mode> · <current_temperature>°"`
- `linkCandidates(el: HomeElement, hass: HassLike): Candidate[]`: lighting categories → entities in `light`/`switch`; `curtains-blinds` → devices with a `cover`; `aircon-controllers` → devices with `climate`; `sensors` → devices with `sensor`/`binary_sensor`; `cameras` → `camera`; `smart-locks` → `lock`; `smart-switches`/`control-panels` → devices with `switch`/`light`; other → all devices. Sorted by area name, then name.

- [ ] **Step 1: Write failing tests:** `sceneToSvg` produces the transform `translate(100 200) rotate(90) scale(20)` for a marker at (100,200), rotation 90, size 20, and a dashed curtain path keeps `stroke-dasharray`; `visualState` covers each rule above, including **Review Focus 1** (`missing` for a deleted entity, `unavailable` for an unavailable one); `linkCandidates` gives a downlight only `light.*`/`switch.*` entities, and a curtain only devices that have a cover.
- [ ] **Step 2: Run** `cd frontend && npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the three modules and the types.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): drawing model, visual state and link candidates`

### Task 7: Floor plan view, panel and card registration

**Files:**
- Create: `frontend/src/api.ts`, `floorplan-view.ts`, `maxsen-home-panel.ts`, `maxsen-floorplan-card.ts`
- Modify: `custom_components/maxsen/__init__.py` (static path `/maxsen_static` → `frontend/`; `panel_custom.async_register_panel(frontend_url_path="maxsen-home", webcomponent_name="maxsen-home-panel", sidebar_title="Home", sidebar_icon="mdi:floor-plan", module_url="/maxsen_static/maxsen-home.js?v=<manifest version>", require_admin=False)`; `frontend.add_extra_js_url` for the card; remove the panel when the last entry unloads)
- Test: `frontend/test/floorplan-view.test.ts`, `tests/test_init.py`

**Interfaces:**
- `api.ts`: `getHome(hass, entryId)`, `subscribe(hass, entryId, cb)`, `setLinks`, `setQuickPanel`, `refreshPreview`, `refreshApply`, `createStarterScenes`, `loadImage(hass, url): Promise<string>` (`hass.fetchWithAuth` → blob → object URL)
- `<maxsen-floorplan-view>` properties: `hass`, `home: HomeResponse`, `mode: 'use'|'link'`. Behaviour:
  - Level tabs (ascending `sortOrder`). When a level has two plans with equal `background.key`, draw both scenes over one background; otherwise show a `Smart Home | Lighting` toggle.
  - Draws `sceneToSvg` output over the background `<image>` in one SVG with `viewBox="0 0 width height"`. Status classes come from `visualState` (`on` glows: LED strips get a glow filter along the path; `unlinked`/`missing`/`unavailable` greyed at 35% opacity).
  - Pinch-zoom and pan (pointer events). Double-tap resets.
  - In `use` mode: tap → toggle (`homeassistant.toggle` on the link's entities; covers: open/close toggle); press ≥ 500 ms → fire `hass-more-info` with the first entity; a device with more than one controllable entity → a popup with one row per entity. Unlinked/missing → no action.
  - In `link` mode: tap emits a `maxsen-element-tap` event `{elementId}`.
- `<maxsen-home-panel>`: HA panel element (`hass`, `narrow`, `panel`). Finds the first `maxsen` config entry (or `panel.config.entry_id`), loads the home, subscribes, lays out the view plus the quick panel (Task 9): side by side when landscape and ≥ 900 px wide, stacked otherwise.
- `<maxsen-floorplan-card>`: Lovelace card (`setConfig({entry_id?})`, `getCardSize() → 8`), rendering the same layout. Registered in `window.customCards`.

- [ ] **Step 1: Write failing tests:**
  - (vitest, happy-dom) the view renders one `<g data-element-id>` per scene item; an `on` light gets class `on`; tapping an unlinked element calls no service; tapping a linked switch calls `homeassistant.toggle` with its entity; a 600 ms hold fires `hass-more-info`; a level with two equal-key plans renders no toggle, with different keys renders the toggle.
  - (pytest) after setting up an entry, `hass.data["frontend_panels"]` contains `maxsen-home`, and `GET /maxsen_static/maxsen-home.js` returns 200.
- [ ] **Step 2: Run** `cd frontend && npm test` and `pytest tests/test_init.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the API wrappers, view, panel, card and registration. Run `npm run build` so the bundle lands in `custom_components/maxsen/frontend/`.
- [ ] **Step 4: Run** `npm test && npm run build && cd .. && pytest -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Maxsen Home panel and floor plan card` (including the built bundle)

### Task 8: Preview app (see the UI on a Mac without Home Assistant)

Added at the owner's request: "an application I can run to see what is changing". It is also extended by Task 9 (the quick panel and link mode show up in it automatically, because it renders the real panel element).

**Files:**
- Create: `frontend/preview/index.html`, `frontend/preview/main.ts`, `frontend/preview/fake-hass.ts`
- Modify: `frontend/package.json` (script `"preview": "vite --config vite.preview.config.ts"`), create `frontend/vite.preview.config.ts` (dev server port **5174**, so it doesn't clash with the planner's 5173)
- Modify: `README.md` ("See it on your Mac" section)
- Test: `frontend/test/fake-hass.test.ts`

**Interfaces:**
- `createFakeHass(home: HomeResponse, opts: { admin: boolean; installerMode: boolean }): FakeHass`. It is a `HassLike` object (states, entities, devices, areas, `user.is_admin`, `callService`, `callWS`, `fetchWithAuth`, `connection.subscribeMessage`) that:
  - makes one fake device per non-lighting element (with entities matching its category: 1–3 `switch.*` gangs for smart switches, `cover.*` for curtains, `climate.*` for aircon, `binary_sensor.*` door/motion and `sensor.*` temperature for sensors), and one `switch.*` "gang" per 4 lighting elements on the same plan, auto-linked to them
  - answers `maxsen/home`, `maxsen/links/set`, `maxsen/quick_panel/set`, `maxsen/scenes/create_starter`, `maxsen/refresh/preview|apply` in memory, with the same shapes as Tasks 3–5
  - `homeassistant.toggle` / `turn_off` / `scene.turn_on` update states and notify subscribers; a door sensor flips every 20 s, so alerts can be seen
  - `fetchWithAuth` serves background images from the loaded package's embedded base64
- `preview/main.ts` page:
  - toolbar: **Open home file…** (any `… home.json` downloaded from the planner, loading the real customer drawing), **Panel 1280×800 / Phone 390×844** frame switch, **Admin** and **Installer mode** toggles
  - below it, the real `<maxsen-home-panel>` element fed by the fake hass
  - starts with `tests/fixtures/home-v1.json`
- Run with `cd frontend && npm install && npm run preview`, then open http://localhost:5174.

- [ ] **Step 1: Write failing tests:** `createFakeHass` on the fixture creates a linked entity for every element; `callService('homeassistant','toggle',{entity_id})` flips the state and notifies a subscriber; `callWS({type:'maxsen/quick_panel/set', ...})` returns the new list; with `admin: false`, `maxsen/links/set` rejects with `not_allowed`.
- [ ] **Step 2: Run** `cd frontend && npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the fake hass, the preview page and the config. Add the README section.
- [ ] **Step 4: Verify:** `npm test` passes, and `npm run preview` serves http://localhost:5174 with the floor plan visible. Check it with a headless browser screenshot (Playwright's preinstalled Chromium) and attach the screenshot to the report.
- [ ] **Step 5: Commit** `feat(frontend): preview app with simulated Home Assistant`

### Task 9: Quick-functions panel and installer tools

**Files:**
- Create: `frontend/src/quick-panel.ts`, `frontend/src/link-mode.ts`
- Modify: `frontend/src/maxsen-home-panel.ts` (place them; show the "Installer" button only when `hass.user.is_admin && home.installer_mode`)
- Test: `frontend/test/quick-panel.test.ts`, `frontend/test/link-mode.test.ts`

**Interfaces:**
- `<maxsen-quick-panel>` (`hass`, `home`): one big touch button per `QuickItem` (an element shows its label or product name and live state, and toggles on tap; a scene entity runs `scene.turn_on`). **Edit** opens a sheet: a list grouped `Scenes` / per level, each with a checkbox, plus drag handles (pointer-based reordering) and **Save** → `setQuickPanel`. Elements that are unlinked can't be ticked (shown disabled, "Not linked yet").
- `<maxsen-link-mode>` (`hass`, `home`): a toolbar with **Done**, **Select several** (multi-select toggle), **Create starter scenes**, **Refresh from planner** (preview summary dialog → Apply). Tapping elements selects them, and a side sheet lists `linkCandidates(first selected)` with a search box. Picking one calls `setLinks` for every selected element; **Unlink** sets `null`. A "Not on the drawing" list shows elements with `drawn: false`. Elements whose status is `missing` are marked "Missing device".
- Refresh dialog wording: "N new devices to link, M devices removed, K drawings updated", with the lists; errors show the message from Task 4 verbatim.

- [ ] **Step 1: Write failing tests:** Edit → tick a scene → Save calls `setQuickPanel` with that scene appended; an unlinked element's checkbox is disabled; in link mode, multi-selecting 3 downlights and picking `switch.l1_gang2` calls `setLinks` with 3 updates to that entity; the Installer button is hidden for non-admins and when `installer_mode` is false; the refresh summary text matches the counts; a `revoked` error shows "Connection revoked: ask Maxsen for a new pairing code".
- [ ] **Step 2: Run** `cd frontend && npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** both components, then `npm run build`.
- [ ] **Step 4: Run** `npm test && npm run build && cd .. && pytest -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: quick-functions panel and installer link mode` (with the built bundle)

### Task 10: Install guide and release

**Files:**
- Create/replace: `README.md`
- Modify: `custom_components/maxsen/manifest.json` (`version: "0.1.0"`)

- [ ] **Step 1: Write the README:**
  - What it is.
  - Install via HACS → *Custom repositories* → this repo, category *Integration*.
  - Add the integration and enter the planner address and pairing code (or upload a home file).
  - Installer checklist: Installer mode on → link devices → Create starter scenes → set up a non-admin user per wall panel → Installer mode off at handover.
  - Android panel setup: HA Companion app or a kiosk browser opening `/maxsen-home`.
  - Refreshing after planner changes. Revoking from the planner.
- [ ] **Step 2: Verify:** `pytest -v`, `cd frontend && npm test && npm run build`, `git diff --exit-code custom_components/maxsen/frontend`. All pass, and the bundle is up to date.
- [ ] **Step 3: Commit** `docs: install and installer guide` and push. Release tag `v0.1.0` is created by a person after a hardware test on an HA Green.
