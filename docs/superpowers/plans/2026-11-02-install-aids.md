# Install Aids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installers link every planned device to the real one by pressing it, either one at a time or in a guided linking walk. Devices get named and placed automatically, and a final Check all confirms every link.

**Architecture:**
- **Server (`identify.py`, `naming.py`):** turns HA `state_changed` events into identification matches using the design's rules. It also names and places devices on link, and restores them on unlink.
- **Frontend (`walk.ts`, `check-all.ts`):** pure state machines with unit tests. Link mode wires them into the existing installer UI.
- **Preview app:** the simulated HA gets a "press" button per fake device.

**Tech Stack:** Python 3.13 / HA 2026.2.3 (`.venv/bin/pytest`), TypeScript + Lit 3 + Vitest (`cd frontend && npm test`, `npm run typecheck`, `npm run build`).

**Spec:** `docs/superpowers/specs/2026-11-01-install-aids-design.md`, including its section "Decisions from the builder check".

## Global Constraints

- **Installer-only:** every new command and every naming change needs an admin **and** `installer_mode`, enforced server-side with the existing `_installer_only`. Refusals use `not_allowed`.
- **Only presses after the prompt count.** Device mode matches only devices with **no device link yet**. Light mode may match a gang that is already linked.
- **Settings and hidden entities never count** (entity_category set, or hidden_by set).
- **Zigbee only by default:** a device counts only if one of its config entries has domain `mqtt` or `zha`, unless `include_other: true`.
- **Light presses** count only on an off → on change of a `switch` or `light` entity.
- **Gang matching:** a gang count is read from the product name with `/(\d+)\s*-?\s*g(?:ang)?\b/i` (matches "3 Gang", "3-gang", "3G"). A device then matches only if it has exactly that many primary switch/light entities. No count in the name means no gang filter.
- **Ambiguity:** two different candidates within **1 s** of each other produce `{ "ambiguous": true }` and no match.
- **Naming applies to device links only.**
  - Format: `‹Level› – ‹label, else productName›` (en dash with spaces).
  - Area: the level name. The area is created if it is missing.
  - Duplicate names get ` 2`, ` 3`, and so on.
  - Never rename a device whose `name_by_user` Maxsen did not write. The same rule applies to the area.
- **Undo, Wrong and unlink:** removing a device link restores the `name_by_user` and `area_id` that Maxsen recorded before it wrote its own.
- **The app never switches loads during the walk.** Check all is the only feature that toggles devices: each one goes to the opposite state for **2 s**, then back. Climate, locks, cameras and sensors are skipped.
- Lit bindings only.
- The preview fake mirrors every new command.
- Rebuild and commit the bundle whenever `frontend/src` changes, and make sure it reproduces.
- Push after every task. Commit messages end with the session's attribution lines.

## Review Focus

1. **An automation or a family member flips some other light during the walk.** In device mode it must not link (that device is already linked or not Zigbee). In light mode the 1 s ambiguity rule or the off→on rule must stop a wrong link. *(Task 1 test)*
2. **The installer presses the same switch twice quickly.** That is one candidate, not "ambiguous". *(Task 1 test)*
3. **A device the customer already renamed in HA is linked, then undone.** Its name and area stay exactly as they were. *(Task 2 test)*
4. **Two markers both labelled "Switch" on Level 1.** They get "Level 1 – Switch" and "Level 1 – Switch 2". *(Task 2 test)*
5. **The walk is left half way (app closed, Installer mode switched off) and resumed later.** The queue is rebuilt from what is still unlinked. Nothing done so far is lost or redone. *(Task 3 test)*

---

### Task 1: Server identification (`maxsen/identify/subscribe`)

**Files:**
- Create: `custom_components/maxsen/identify.py`
- Modify: `custom_components/maxsen/websocket.py` (register the command)
- Test: `tests/test_identify.py`

**Interfaces:**
- Produces:
  - `gang_count(product_name: str) -> int | None`
  - `class Identifier(hass, entry, *, mode: Literal["device","entity"], kinds: list[str], gangs: int | None, include_other: bool, on_result: Callable[[dict], None])` with `async_start() -> None` and `stop() -> None`
  - `kinds` values: `"switch"` (a switch/light entity changing state, or an `event` entity firing), `"cover"`, `"binary_sensor"`, `"light_gang"` (entity mode only).
  - Results pushed:
    - `{"device_id", "name"}` in device mode
    - `{"entity_id", "name"}` in entity mode
    - `{"ambiguous": true}`
  - Websocket command `maxsen/identify/subscribe`: `{entry_id, mode, kinds, gangs?: int, include_other?: bool}`. It is a subscription (`connection.subscriptions[msg_id]`) that sends each result as an event message, and it is installer-gated.

- [ ] **Step 1: Write failing tests**
  - `gang_count` parses "3 Gang Smart Switch" → 3, "Nova 2-gang" → 2, "S1 3G" → 3, "Luna Downlight" → None.
  - Device mode, kind `switch`: an unlinked Zigbee (mqtt) device's switch flips → `{device_id, name}` pushed once.
  - A linked device flips → nothing.
  - A non-Zigbee device flips → nothing, unless `include_other` is set.
  - A config-category switch (backlight) flips → nothing.
  - `gangs: 3` with a 2-gang device → nothing.
  - **Review Focus 2:** the same device flips twice within 1 s → one result.
  - **Review Focus 1:** two different eligible devices flip within 1 s → `{"ambiguous": true}`.
  - Entity mode `light_gang`: an already-linked gang going off→on → `{entity_id}`; on→off → nothing.
  - Events from before the subscription → ignored.
  - A non-admin user, or installer mode off → `not_allowed`.
  - Unsubscribing removes the `state_changed` listener (assert via `hass.bus` listener count).
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_identify.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Use `async_track_state_change_event`, or a filtered `hass.bus.async_listen(EVENT_STATE_CHANGED)`.
  - Use the entity and device registries for device_id, config entries, entity_category, hidden_by and disabled_by.
  - Linked devices come from the store's `links` values with `type == "device"`.
  - Keep the 1 s window per subscription.
- [ ] **Step 4: Run** `.venv/bin/pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: identify devices by pressing them`, then push.

### Task 2: Name and place devices on link; restore on unlink

**Files:**
- Create: `custom_components/maxsen/naming.py`
- Modify: `custom_components/maxsen/store.py`:
  - data gains `"named": {device_id: {"name", "area_id", "prev_name", "prev_area_id"}}`
  - writes go through `_async_write`
- Modify: `custom_components/maxsen/websocket.py`:
  - `maxsen/links/set` accepts optional `name_device: bool` (default False)
  - for each device link set with `name_device`, apply naming
  - for each device link removed (value `null`), restore the device if Maxsen named it
- Test: `tests/test_naming.py`, `tests/test_websocket.py`

**Interfaces:**
- Produces:
  - `device_name(level_name: str, element: dict, taken: set[str]) -> str`
  - `async apply_naming(hass, store, device_id: str, level_name: str, element: dict) -> None`
  - `async restore_naming(hass, store, device_id: str) -> None`

- [ ] **Step 1: Write failing tests**
  - `device_name("Level 1", {"label":"Entrance switch"}, set())` → `"Level 1 – Entrance switch"`.
  - The label is empty, so the productName is used.
  - **Review Focus 4:** a second "Switch" on Level 1 → `"Level 1 – Switch 2"`.
  - `links/set` with `name_device: true` on a device with no `name_by_user`:
    - `name_by_user` and `area_id` are set
    - an area "Level 1" is created if missing
    - the store records `named`
  - **Review Focus 3:** a device whose `name_by_user` a person set → name and area untouched, and nothing recorded.
  - Unlinking (`null`) a Maxsen-named device → previous name and area restored, and the record removed.
  - Entity (light) links with `name_device` → nothing renamed.
  - Gating unchanged (`not_allowed` for non-installers).
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_naming.py tests/test_websocket.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** with `dr.async_get(hass).async_update_device(device_id, name_by_user=..., area_id=...)` and `ar.async_get(hass).async_get_or_create(name)`.
- [ ] **Step 4: Run** `.venv/bin/pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: name and place devices when linking`, then push.

### Task 3: Walk state machine (frontend, pure)

**Files:**
- Create: `frontend/src/walk.ts`
- Test: `frontend/test/walk.test.ts`

**Interfaces:**
- Produces:

```ts
export type WalkStep =
  | { kind: 'device'; elementId: string; prompt: string; mode: 'device'; kinds: IdentifyKind[]; gangs: number | null }
  | { kind: 'lights'; elementId: string; prompt: string; mode: 'entity'; kinds: ['light_gang'] }
  | { kind: 'pick'; elementId: string; prompt: string };
export type IdentifyKind = 'switch' | 'cover' | 'binary_sensor' | 'light_gang';
export function buildQueue(home: HomeResponse): WalkStep[];
export class Walk {
  constructor(home: HomeResponse);
  get current(): WalkStep | undefined;
  get done(): number;
  get total(): number;
  linked(elementIds: string[], link: Link): void;
  skip(): void;
  back(): void;
  undo(): { elementIds: string[]; link: Link } | undefined;
  jump(elementId: string): void;
  refresh(home: HomeResponse): void;
}
```

- **Order:** level by `sortOrder`. Within a level: non-lighting elements first, then lighting. Within each group, top to bottom, then left to right (y, then x of the element's scene position; for paths, the midpoint).
- **Skipped steps** move to the end.
- **Kinds per category:**
  - `smart-switches` and `control-panels` → `switch`
  - `curtains-blinds` → `cover`
  - `sensors` → `binary_sensor`
  - lighting categories → `lights`
  - everything else → `pick`
- **Prompts** (exact):
  - `Press any button on the switch at ‹label›`
  - `Press the gang that turns this on`
  - `Press open or close on the curtain switch`
  - `Wave at the sensor, or open the door it's on`
  - `Pick it from the list`
  - `‹label›` is the label, else the productName.

- [ ] **Step 1: Write failing tests**
  - Queue order on the fixture.
  - Kinds per category.
  - Prompts.
  - Gang count passed from the productName.
  - `linked` advances.
  - `skip` moves the step to the end.
  - `back` returns to the previous step.
  - `undo` returns the last link and re-queues its elements at the front.
  - `jump` makes that element current.
  - **Review Focus 5:** `refresh` with a home where some elements got linked elsewhere drops them from the queue and keeps the current element if it is still unlinked.
- [ ] **Step 2: Run** `cd frontend && npx vitest run test/walk.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): linking walk state machine`, then push.

### Task 4: Linking walk and press-to-identify in link mode (+ preview)

**Files:**
- Modify: `frontend/src/api.ts`: `identify(hass, entryId, opts, cb): Promise<() => void>` (uses `subscribeMessage` with `{resubscribe:false}`); `setLinks(..., { nameDevice })`
- Modify: `frontend/src/link-mode.ts`:
  - **Start linking walk** button; a walk bar with the prompt, progress `‹done›/‹total›`, **Skip**, **Back** and **Include other devices** switch
  - the current marker highlighted on the plan
  - for a `device` step: subscribe, then on a result call `setLinks({[elementId]: {type:'device', id}}, nameDevice: true)`, show `Linked: ‹name›` with **Undo** for 2 s, then advance
  - for a `lights` step: subscribe in entity mode; on a result, link the highlighted light to that entity, then prompt `Tap the other lights that came on` with a **Done** button; tapping markers adds them to the same gang link
  - `ambiguous` shows `Two devices reacted. Press once more.`
  - a `pick` step shows the existing candidate list
  - **Press to identify** outside the walk: with exactly one marker selected in link mode, a `Press the device now` hint subscribes the same way
- Modify: `frontend/src/floorplan-view.ts`: a `current` property (element id) drawn with a pulsing highlight
- Modify: `frontend/preview/fake-hass.ts` and `frontend/preview/main.ts`:
  - `maxsen/identify/subscribe` with the same rules
  - a **Press a device** toolbar menu listing the fake devices and gangs, which flips them
- Test: `frontend/test/link-mode.test.ts`, `frontend/test/fake-hass.test.ts`

- [ ] **Step 1: Write failing tests**
  - Walk: start → the first prompt shows. A fake identify result links with `nameDevice: true` and shows `Linked: …`. Undo within 2 s unlinks and returns to the step. It advances after 2 s.
  - Lights: a result links the highlighted light, then the tap-others phase adds tapped markers to the same entity link.
  - Ambiguous shows the exact message.
  - Skip and Back.
  - The Include other devices switch passes `include_other: true`.
  - Single-marker press-to-identify links.
  - The fake: identify respects linked, Zigbee and gang rules like the server.
- [ ] **Step 2: Run** `cd frontend && npx vitest run test/link-mode.test.ts test/fake-hass.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`. Expected: PASS. Take Playwright screenshots of a walk in the preview (device prompt, linked toast, lights tap-others) into the SDD workspace.
- [ ] **Step 5: Commit** `feat(frontend): linking walk and press to identify`, then push.

### Task 5: Check all

**Files:**
- Create: `frontend/src/check-all.ts` with `class CheckAll(hass, home)`:
  - `steps(): CheckStep[]`, where each step is `{label, entityIds, restore}`:
    - each distinct gang entity linked by lights
    - each primary switch/light entity of linked switch devices
    - each linked curtain
  - climate, lock, camera and sensors are skipped
  - `run(step)`: opposite state for 2000 ms, then restore. Covers: `open_cover`/`close_cover` for 2 s, then `stop_cover`, then return to the previous position with `set_cover_position` when the device supports it.
- Modify: `frontend/src/link-mode.ts`:
  - a **Check all** button
  - per step: highlight, run, then **OK** or **Wrong**
  - **Wrong** unlinks the step's elements (`setLinks` with `null`; the server restores names) and adds them back to the walk queue
  - a summary at the end: `‹n› OK, ‹m› to relink`
- Test: `frontend/test/check-all.test.ts`, `frontend/test/link-mode.test.ts`

- [ ] **Step 1: Write failing tests**
  - Steps from a fixture home: per gang, no climate or lock, curtains included.
  - `run` calls turn_on, then turn_off after 2000 ms (fake timers) for an off entity, and the reverse for an on entity.
  - Curtain: open, stop, restore position.
  - UI: Wrong unlinks and re-queues; the summary text is right.
- [ ] **Step 2: Run** `cd frontend && npx vitest run test/check-all.test.ts test/link-mode.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build && cd .. && .venv/bin/pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): check all linked devices`, then push.

### Task 6: Installer guide

**Files:**
- Modify: `README.md` with a new section **Pairing and linking a home**:
  1. Prepare: HA box and radio central on a USB extension; add Maxsen Home with the planner code.
  2. Batch pair in mesh order: mains devices first, nearest the radio outward; battery sensors last; don't name anything.
  3. Check the count against the planner.
  4. Turn every gang off.
  5. Home → Installer → **Start linking walk**: follow each prompt (press, wave, open, or pick); for lights, press the gang and then tap the other lights that came on.
  6. **Check all**: OK or Wrong for each.
  7. **Create starter scenes**, a non-admin user per panel, then Installer mode off.
  Also update the installer checklist to point to this section. Every label must match the UI text exactly; grep to confirm.

- [ ] **Step 1: Write the section.**
- [ ] **Step 2: Verify** with `grep` that every quoted label exists in `frontend/src` or `strings.json`.
- [ ] **Step 3: Commit** `docs: pairing and linking guide`, then push.
