# Maxsen Home: Install Aids (linking walk) — Design

Date: 2026-11-01
Status: Draft, awaiting approval
Builds on: `2026-11-01-maxsen-floorplan-dashboard-design.md`, `2026-11-01-panel-polish-design.md`

## Why

Maxsen installers pair all of a home's Zigbee devices **in one batch** (the owner's answer). After
pairing, Home Assistant has dozens of unnamed devices. Neither the gateway nor HA can tell where a
device is: signal strength in concrete Singapore homes isn't reliable enough. Linking each
planned device to the real one is therefore today's slowest install step. The real-HA system test
also showed that tapping the right marker in a crowded plan is error-prone.

A physical press proves identity in 2–3 seconds, so the aids are built around it.

## Users

The **installer**, on a phone, walking the home with Installer mode on (admin + `installer_mode`,
server-enforced as today).

## Goals

1. **Press to identify.** In link mode, select a marker (or several lights), then press the real
   device. The first matching state change from a **not-yet-linked** device links it.
2. **Linking walk.** "Start linking walk" steps through every unlinked marker in a set order. It
   highlights each one, says what to press, links on the press and moves on. The installer can
   Skip, go Back, Undo last link, or tap any marker to jump to it.
3. **Name and place automatically.** On link, the HA device is given a readable name ("Living –
   Entrance switch": the marker label, else the product name) and an HA area (the level name for
   now; rooms come with the room-scenes project). This only applies when the device has no name
   set by a person.
4. **Check all.** Toggles each linked controllable device in turn (2 s apart, then back) while the
   installer watches. They mark each one OK or Wrong. Wrong ones go back into the walk.
5. **Installer guide.** Add the recommended pairing and walk procedure to the README:
   - mains devices first, nearest the radio outward, battery sensors last;
   - confirm the count against the planner;
   - walk room by room;
   - Check all;
   - hand over.

## Non-goals

- Guessing location from radio signal (could be added later as a hint only).
- Pairing devices one at a time from the panel (installers pair in a batch).
- Warehouse pre-assignment by QR (later, at scale).
- Rooms and room scenes (separate project).

## How identification works

| Marker kind | What the walk asks | What counts as "the press" |
|---|---|---|
| Smart switch / control panel | "Press any button on the switch at ‹label›" | A `state_changed` on a `switch`/`light` entity, or an `event` entity firing, belonging to an unlinked device. The whole **device** is linked. |
| Lights (downlights, LED strips, tracks…) | Turn every gang off first; then "Press the gang that turns these on" for one group of lights at a time | The first unlinked-or-linked **switch/light entity** turning on links the selected lights to that **entity**. Lights may share a gang, so a gang that is already linked is allowed here. |
| Curtain | "Press open or close on the curtain switch" | A `cover` entity of an unlinked device changing state |
| Sensors | "Wave at the motion sensor" / "Open the door with the sensor" | A `binary_sensor` of an unlinked device changing state |
| Aircon controller, camera, lock, other | "Pick it from the list" | No press. A short list of unlinked devices of the matching kind (existing link candidates). |

**Rules that prevent wrong links:**
- Only state changes that happen **after** the prompt appears count.
- Only devices with **no link yet** count (except gangs for lights, see the table).
- Settings and hidden entities never count (same rule as the current filter).
- **Gang matching:** if the marker's product name states a gang count ("3 Gang", "3-gang", "3G"), a
  device only matches when it has that many primary switch/light entities. If the name gives no
  count, the device isn't filtered.
- If two candidate devices change within 1 s, nothing is linked. The prompt says "Two devices
  reacted. Press once more."
- Every link is shown for 2 s ("Linked: Living – Entrance switch") with an **Undo** button, before
  the walk moves on.

**Walk order:** level by level, then by position, top to bottom and left to right on the drawing.
Lights come after the switches of the same level. Skipped markers come back at the end.

## Where the logic lives

- **Server (Python):**
  - New installer-only websocket command `maxsen/identify/subscribe` with `{entry_id, mode:
    "device"|"entity", kinds: [...]}`. It listens to `state_changed` events, applies the rules
    above, and pushes `{device_id?, entity_id?, name}` candidates to the installer's phone.
  - `maxsen/links/set` gains an optional `name_device: true`. Linking then also sets the HA
    device's `name_by_user` and `area_id` (creating the area named after the level if needed),
    unless a person has already named the device.
  - All new commands use the existing admin + installer_mode check.
- **Frontend:**
  - Link mode gets **Start linking walk** and **Check all**.
  - The walk is a small state machine (current marker, queue, history for Undo) with unit tests.
- **Preview app:** the simulated Home Assistant gets a "press" button per fake device, so the walk
  can be tried on a Mac.

## Anti-goals

- Linking a device the installer didn't press.
- Renaming devices a person already named.
- Anything here working for non-installers.

## Left to the builder

- Exact prompt wording within the table's meaning.
- The visual style of highlights and the walk bar.
- The `identify` subscription's internal event filtering.
- How Check all reports results on screen.
