# Maxsen Floor Plan Dashboard — Design

Date: 2026-11-01
Status: Draft, awaiting approval
Repos: `hexxcheang/homeassistantintegration` (HA side), `hexxcheang/maxsen-planner` (export)

## Intent

Maxsen's add-on service gives customers Home Assistant (HA) on Android wall
panels and their phones. The main screen should be **the 2D floor plan Maxsen's
team already drew for that home in the Maxsen Planner**, with every switch,
sensor, light, LED strip and curtain where it was planned, live and tappable.
Beside it, a **quick-functions panel** holds the shortcuts and scenes the
customer picks for themselves.

The planner already holds each home's drawings and every planned device, so
the floor plan should come from it, not be rebuilt by hand for every customer.

## Users

- **Homeowner**: uses the panel and phone daily; taps devices, runs scenes,
  chooses what's in the quick panel. Not technical.
- **Installer**: at the planner's "integration" schedule step, imports the
  home into HA and links each planned device to the real paired one.
- **Planner staff**: export the home from the planner when the project is
  ready.

## Goals

1. **Connected to the planner:** staff press "Connect to Home Assistant" on
   a project and get a pairing code. The installer types it into the Maxsen
   integration in HA, which downloads the home from the planner. A downloadable
   home package file is also available, as a fallback for homes without a
   reliable connection.
2. **Manual refresh** (decided by the user): when a plan changes after
   install, nothing changes in the customer's HA until the installer taps
   "Refresh from planner". A refresh replaces the drawings and keeps existing
   device links.
3. **Floor plan card:** shows each level's drawing exactly as the planner draws
   it (same icons, colours, LED strips, curtain lines, labels), with live state:
   lights glow when on, curtains show open/closed/position, sensors show their
   reading or alert. Tap toggles; press-and-hold opens HA's details dialog.
4. **Link mode** (installer only): tap a planned device, pick the real device
   or entity from a filtered list. Several lights can be linked to one switch
   gang in one go.
5. **Quick-functions panel:** the customer taps "Edit", ticks devices and
   scenes, drags to reorder, done. The panel and phone show the same choices.
6. **Starter scenes:** after linking, the installer can create a starter set
   of scenes so the quick panel is useful from day one.
7. Works on Android panels running the HA Companion app or a kiosk browser
   (landscape) and on phones (portrait), touch-first.

## Non-goals (this version)

- Customers creating scenes by telling an AI agent. Planned next. Scenes are
  standard HA scenes, so an agent can create them later and they'll appear in
  the quick-panel picker without rework.
- 3D views; customers editing or rearranging the floor plan itself.
- Showing scenes on the physical screen switches (a later idea, tied to the
  device-definition project).
- Automatic syncing of planner changes (refresh is manual, by the installer).
- Managing many homes remotely from one place.
- Submitting to the default HACS store list (installed as a HACS custom
  repository for now).
- Device definitions for Maxsen hardware (separate project:
  `2026-11-01-maxsen-device-assistant-design.md`).

## Anti-goals

- Customers needing HA's dashboard/YAML editor for everyday customisation.
- A drawing in HA that differs from what Maxsen and the customer approved in
  the planner.
- Installers linking devices by typing entity IDs.
- Leaking quote/billing data: the export carries no prices, invoices, customer
  contact details or addresses.

## How the planner stores homes (findings)

From `maxsen-planner/packages/domain/src`:

- Project → levels → plans. Each level can have two plans, `smart-home` and
  `lighting` (`categories.ts`), each with its own background image
  (`PlanBackground`: uploaded page, rotation, crop, image file, pixel size).
- Plan coordinates: background width is 1000 "plan units", height is
  1000 × H / W (`types.ts`).
- Elements (`PlanDocument.elements`): point markers (switches, control panels,
  aircon controllers, gateways, sensors, cameras, locks, downlights, pendants,
  fans, spotlights…), LED strip paths, track paths, curtain paths, text notes.
  Each has a stable `id`, a `variantId` (→ product/category), rotation and
  label.
- `render/scene.ts` turns a plan into a renderer-neutral `Scene` (icons as SVG
  path data, paths as SVG `d`, labels, badges, legend). The editor (Konva) and
  the PDF export both draw from it.
- Optional Magic Plan room layout (named room rectangles). Not every plan has
  one.
- No 3D data, no HA export today, and no link from planned devices to real
  devices.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | HA built-in cards only: export generates a `picture-elements` dashboard plus a button grid | Little custom code, but customisation goes through HA's technical editor, LED strips and curtains become plain icons, and it doesn't look like Maxsen |
| **B (chosen)** | Maxsen floor plan card plus a small Maxsen HA integration; planner export file; link mode; customer-friendly quick-panel editing | Several weeks of work; some upkeep as HA updates |
| C | Separate Maxsen panel app talking to HA's API | Rebuilds logins, live state and the phone app; customers end up with two apps |

Chosen by the user: **B**.

## Decided

### Where the code lives
- HA side in `homeassistantintegration`: a custom integration
  `custom_components/maxsen/` (Python) that also serves the card's JavaScript,
  so installing the integration installs the card (no separate frontend
  install). Card source lives in the same repo and is built into the
  integration.
- Planner side: one small PR to `maxsen-planner` adding the export, following
  its `AGENTS.md` rules (own branch, PR, never push to `main`; `pnpm check`,
  `pnpm build`, `pnpm e2e` green; small PR).

### Distribution (decided by the user)
- The HA integration (with its card) is published from a **public GitHub
  repo** and installed through **HACS as a custom repository**. Updates reach
  every customer through HA's normal Updates screen. Releases are versioned
  (GitHub releases), so HACS can offer them.
- Because the code is public, it **contains no secrets**: no planner
  credentials, API keys or customer data. The planner's address isn't secret,
  and the installer enters it (or it's pre-filled) during setup.
- **Check before publishing:** this repo also holds the device-definition kit,
  whose `datapoints/raw/` would contain Maxsen's Tuya datapoint exports. If
  those must stay private, they need to live elsewhere before the repo goes
  public.

### Planner connection *(security details are Claude's call)*
- **Pairing:** "Connect to Home Assistant" on a project creates a short
  pairing code that works once and expires (e.g. after 24 hours) if unused.
  When HA uses the code, the planner swaps it for a long-lived access token
  that HA stores in its integration config.
- **What the token can do:** read **that one project's** floor-plan package,
  nothing else. No prices, invoices, leads, customer details, inbox or Jiaxin.
- Staff can see and **revoke** a project's Home Assistant connection in the
  planner.
- New planner endpoints are rate-limited, and pairing attempts are limited to
  stop code guessing.
- Planner work goes in through PRs per its `AGENTS.md`: own branch, checks
  green, never pushed to `main`. It touches a live app with real customers,
  so changes are kept small and separate from Jiaxin.
- **Refresh:** "Refresh from planner" (installer mode only) downloads the
  current package with the stored token, shows a summary (devices added,
  removed, drawings changed), and applies it on confirm.

### Home package *(format is Claude's call)*
The same content whether downloaded through the connection or as a file. One
`.zip` per project:
- `manifest.json`: package schema version, planner project id, project
  title, export time, planner revision per plan.
- Per level: id, name, sort order; per plan: type (`smart-home`/`lighting`),
  width/height in plan units, the background image file, the plan's **`Scene`**
  (from `render/scene.ts`, so the card draws exactly what the planner draws),
  and an element list: element id, category, kind, product and variant name,
  label. The card links by element id.
- Background images as files inside the zip.
- No prices, customer name, contact or address.

### Which drawing is exported *(Claude's call)*
- The drawing follows the project's **customer floor-plan export settings**
  (the same ones as the PDF the customer approved): levels and plans left out
  there are left out here, and labels follow `showLabels`.
- **Text notes are excluded by default**, because they're free text staff may
  use for electrician instructions or prices. The export dialog has an
  "Include notes" option, off by default.
- **Categories hidden from the PDF are still exported as elements** (not
  drawn), so the installer can link them and the customer can add them to the
  quick panel. Link mode lists them under "Not on the drawing".
- Element labels are kept (e.g. "Living L1"), because they're how the
  installer and customer recognise devices.

### Import and refresh
- The integration's setup flow takes either a pairing code (and planner
  address) or an uploaded zip. The package and images are stored in HA's
  config storage and served to the card.
- Refresh and re-upload replace drawings and keep links for element ids that
  still exist, then report devices that were added (need linking) and removed
  (links dropped).

### Linking model
- A planned element links to either an **HA device** (e.g. a smart switch,
  control panel, curtain motor, sensor) or a specific **entity** (e.g. one
  switch gang).
- In Maxsen homes, lights are typically ordinary fittings controlled by smart
  switch gangs, so **lighting elements (downlights, LED strips, tracks,
  pendants…) link to the entity that powers them**, and many lights can share
  one gang. Link mode supports multi-select: select several lights, assign
  one gang.
- When a device has several controllable entities (a 3-gang switch), tapping
  it opens a small popup with one control per gang.
- Unlinked elements are drawn greyed out and don't respond to taps (except in
  link mode).
- **Link mode needs two things** *(Claude's call)*: an HA admin user **and**
  "Installer mode" switched on in the Maxsen integration's options. The
  installer turns it on during setup and off at handover. That way, customers
  or panels logged in as an admin (HA's first user is always one) can't
  wander into link mode. The setup guide recommends a non-admin user for each
  wall panel.

### Floor plan card
- Level tabs. When a level has both plans: if their backgrounds are identical,
  show them combined; otherwise show a Smart Home / Lighting toggle.
- Drawing rendered from the exported `Scene` as SVG over the background image,
  so it scales crisply on any screen. Pinch-zoom/pan on touch.
- Live states: lit/unlit for lights (LED strips glow along their path),
  curtain open/closed/position, sensor value or alert colour, switch on/off,
  aircon mode/temperature.
- Layout: quick panel on the right in landscape (panels), below in portrait
  (phones).

### Quick-functions panel
- Items: linked devices/entities, and scenes (any HA scene, including Maxsen
  starter scenes and, later, agent-created ones).
- "Edit": tick items from a grouped list (by level/room/category), drag to
  reorder, save.
- Stored in the integration (one shared list per home), so every panel and
  phone shows the same. Any logged-in HA user can edit *(Claude's call)*.

### Starter scenes *(Claude's call)*
A "Create starter scenes" button in link mode creates standard HA scenes from
the linked devices: **All off (whole home)**, **All off – \<level>** for each
level, and **All lights off**. They're added to the quick panel by default and
customers can remove them.

## Left to the builder

- Card technology (e.g. Lit + TypeScript, bundled into the integration),
  build tooling, and how the integration registers the card.
- The integration ↔ card API (websocket commands) and storage layout.
- Exact visuals for each state, the zoom/pan implementation, popup design.
- Exact zip schema beyond the fields listed, and how the planner gathers the
  scenes and images (reusing existing export code where possible).
- Where "Connect to Home Assistant" and the file download sit in the planner
  UI, and how the planner stores connection tokens.
- Exact token format, expiry and rate-limit numbers within the rules above.
- Test strategy on both sides, within each repo's existing conventions.
