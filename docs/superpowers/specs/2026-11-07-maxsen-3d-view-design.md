# Maxsen Home: 3D view — Design

Date: 2026-11-07
Status: Draft, awaiting owner approval
Builds on: `2026-11-01-maxsen-floorplan-dashboard-design.md`, `2026-11-01-panel-polish-design.md`
Depends on: the **clean drawing from photos** project (not yet designed), which produces the room
and wall data this view needs. See *Input* below.

## Why

The owner saw the Home Assistant "neon house" style (NeonPlan 3D): the home as a glowing wireframe
dollhouse on a dark screen, rooms lighting up as lights turn on, tap a room to see its devices. He
wants that look for Maxsen customers, as the **everyday screen** on the wall panel, with three
conditions that rule out shipping NeonPlan itself:

- **No money to anyone else.** No paid packs, no shop, no account prompts for the customer.
- **Nothing but Maxsen on the screen.** No third-party names anywhere a customer looks.
- **The Maxsen logo on it.**

A trial (2026-11-07) showed NeonPlan rendering the Dairy Farm plan from a generated file. Everything
it needed came from our planner data except the room outlines. So the 3D is a new way to draw the
home we already have, not a new product.

## Users

- **The family**, on an Android wall panel (landscape) and phones, all day: glance at the house,
  tap a light, open a room.
- **The installer** sets it up once (chooses 2D or 3D as the opening view) and uses the 2D views for
  linking, as today.

## Goals

1. A **3D** layer in the existing Home panel, next to All / Smart Home / Lighting, in the NeonPlan
   look: dark background, floors as dark slabs, walls as translucent blocks with glowing edges,
   room names floating over the rooms, lit rooms glowing in their light's colour.
2. **Every planned device at its exact spot**, from the planner, with live state:
   - downlights: a small glowing disc on the ceiling plane and a soft pool of light on the floor
     when on, in the light's colour (RGB, or warm/cool from colour temperature); dim when off;
   - LED strips: a glowing line along the planned path;
   - curtains: a panel on the wall that slides with the cover's position (open / closed / %);
   - switches and control panels: the same SW / CP badges as 2D, on the wall;
   - sensors: a small pill, lit while the sensor is on (motion / door open);
   - aircon: the mode badge from 2D ("cool · 22°") above the unit;
   - unlinked devices: drawn dashed/dim, as in 2D.
3. **Same taps as 2D.** Tap a device to switch it, hold for details, overlap picker for crowded
   spots. Tap a room's floor to **enter the room**: the camera flies in, that room's ceiling goes
   away, and the quick-panel slot shows that room's devices as tiles. **Back** returns to the house.
4. **Everyday fast.** On the owner's Android wall panel: first picture within 1.5 s of the home
   loading; nothing is redrawn while nothing changes (idle CPU near zero); a tap responds within
   100 ms; turning and zooming stay smooth. Live updates arrive through the existing subscription.
5. **Maxsen logo** in the panel header on every view (2D and 3D), with the home's name beside it.
6. The installer picks the **opening view** per home: `2d` (default) or `3d`, saved with the home
   like the soft/original background setting, changeable only in Installer mode.

## Non-goals

- Furniture, roofs, gardens, pools, solar, energy flows, cars, a walk-through mode, day/night sun,
  "time travel" history. Walls, floors and devices only, for now.
- Drawing or editing the home inside Home Assistant. The planner is the editor.
- Several levels stacked in one picture. One level at a time, chosen with today's level pills.
- Replacing the 2D views: they stay, and linking stays 2D.
- Reusing NeonPlan's code. (Considered, see *Approaches*.)

## Anti-goals

- Any third-party name, account prompt, shop or paid tier visible to a customer.
- A 3D that shows a device in the wrong place or wrong state while the 2D shows it right.
- A panel that gets hot, drains or lags because the 3D keeps redrawing while idle.
- A broken screen on a panel without 3D support: the 3D option must simply not appear.

## Input: what the 3D needs from the home package

The home package (`maxsen-home`, schema 1) gains an optional **rooms layer** per level, produced by
the clean-drawing project. This design fixes its shape so that project knows what to deliver:

```
level.rooms: {
  scale: number,                 // metres per plan unit (plan units are the scene's 1000-wide space)
  wallHeight?: number,           // metres, default 2.6
  rooms: [{ id, name, polygon: [[x, y], ...] }],   // plan units; neighbours share edges
  walls: [{ from: [x, y], to: [x, y], thickness: number /* metres */ }],
  openings: [{ type: 'door' | 'window', from: [x, y], to: [x, y], sill?: number, height?: number }]
}
```

- Coordinates are in the same plan units as the scene (so device positions line up without a
  second mapping).
- A level without a rooms layer has no 3D; the layer toggle shows only the 2D options for it.
- Schema version stays 1: the field is optional and old packages still load.

## The look (within the NeonPlan style)

- Background: very dark navy. Floors: dark slabs with a faint tint per room; the room name floats
  above its centre in a rounded label. Walls: translucent dark blocks with thin bright cyan edges.
  Doors: gaps in the wall; windows: lighter, glassy wall sections.
- Light: a lit room's floor and walls take a soft wash of the light's colour; each downlight shows
  as a disc with a glow halo; LED strips glow along their line. Off = dim grey marks, still visible.
- Device badges use the same colours as the 2D plan (switch blue, control-panel purple, sensor
  orange…) so the two views read the same.
- The current room, when entered, has its own walls drawn lower and more transparent so the camera
  sees in; other rooms fade back.
- Logo: the Maxsen wordmark (from the planner, `apps/web/public/sample/maxsen-logo.png`, converted
  to a small SVG or 2× PNG inside the bundle), left of the home name in the header, in dark-on-light
  for 2D and light-on-dark for 3D.

## Camera and touch

- Opens on a fixed dollhouse angle (about 35° above the floor, 30° turned), framed to the level's
  rooms, like today's "fit to rooms".
- One finger drags to turn (any direction around the vertical axis; tilt limited to 15°–80° so the
  house never flips). Pinch zooms within limits. Double-tap resets to the opening angle. The 2D's
  "Whole drawing" button becomes "Whole house" here.
- Tapping a room floor enters the room; Back (and the Android back gesture, where the browser
  gives it) leaves it. Entering a room is an animated fly of about 400 ms.

## Where the logic lives

- **Frontend (Lit, TypeScript):** a new `maxsen-3d-view` element in `frontend/src/three-view.ts`,
  with the scene built in a pure module `frontend/src/three-scene.ts` (rooms layer + scene +
  states → meshes and marker positions), so it can be unit-tested without a browser.
- **Rendering:** three.js (MIT), WebGL. The 3D code is a **separate chunk** loaded only when the 3D
  layer is opened, so the 2D panel's load time and bundle stay as they are. The committed build must
  stay byte-reproducible: fixed chunk file names, no hashes.
- **Render on demand:** a frame is drawn only on camera movement, an animation, or a state change;
  never a continuous loop. Device pixel ratio is capped at 1.5. No shadows; one directional light
  plus ambient; downlights are instanced meshes; labels are canvas sprites rebuilt only when text
  changes. Colour and brightness come straight from the entity state the panel already has.
- **Hit testing:** raycast on tap; the existing overlap picker is reused when several devices are
  within the touch radius. Device taps call the existing `operate` paths, so 2D and 3D do the same
  thing.
- **Room tiles:** when a room is entered, the quick-panel slot lists the room's devices as tiles,
  reusing the quick panel's tile element; the customer's own quick panel returns on Back.
- **Server (Python):** `display` gains `opening_view: "2d" | "3d"` (default `"2d"`), set through
  the existing `maxsen/display/set` (installer-only, same rule as `background`). The package parser
  accepts and validates the optional rooms layer.
- **Capability check:** if `WebGL` (1 or 2) is unavailable, the 3D option is hidden and the opening
  view falls back to 2D with no message.
- **Preview app:** the simulated Home Assistant gets a sample home with a rooms layer, so the 3D can
  be tried on a Mac, including entering rooms and lights changing colour.
- **Tests:** unit tests for the scene module (rooms → walls and slabs; devices → positions and glow
  from states; a level without rooms → no 3D); element tests for the layer toggle, opening view,
  capability fallback and room tiles; a real-HA system test with screenshots on desktop and phone
  viewports; the owner's Android panel for the performance goals.

## Approaches considered

1. **Reuse NeonPlan's free (MIT) core, rebranded.** Fastest to the full look, including furniture
   and walk mode. Rejected: a large foreign codebase to maintain (energy, pools, solar, cars…), the
   licence requires keeping their copyright notice and an "includes code from NeonPlan 3D" line,
   and its devices are placed per room rather than at the planned spot.
2. **Our own 3D layer in Maxsen Home.** Chosen. 100 % Maxsen, same links and installer flow, every
   downlight at its planned spot. Costs more build time and starts without furniture.
3. **Generate NeonPlan files from the planner.** Cheapest, but the customer still sees NeonPlan's
   name and account prompt, which fails the reason for the project.

## Left to the builder

- Exact colours, glow technique (sprites vs. emissive materials vs. post-processing; prefer the
  cheapest that looks right on a mid-range Android WebView), label font and sizes.
- How the curtain panel is drawn and how windows look.
- The fly-in animation path and easing.
- Chunk loading mechanics within the reproducible build.
