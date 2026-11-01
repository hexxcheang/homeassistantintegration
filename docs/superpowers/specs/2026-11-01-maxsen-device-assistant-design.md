# Maxsen Device Assistant — Design

Date: 2026-11-01
Status: Approved 2026-11-01

## Intent

Maxsen sells Tuya-based smart home devices, including Zigbee wall switches with
screens. Maxsen plans an add-on service that lets customers run Home Assistant
(HA) with Maxsen devices and panels. To make that work, every Maxsen device
model needs a device definition for HA, and the screen features (button label
text, icons, backlight) must be controllable from HA.

**Scope: every Maxsen Zigbee device** (decided by the user) — wall switches
with screens first, but also plugs, sensors, curtain motors, thermostats and
whatever comes next.

This repo becomes the Maxsen integration team's workspace, set up so that
Claude Code acts as the team's coding assistant: a developer supplies a
device's Tuya datapoint (DP) export and the assistant produces a working,
tested device definition, which a human reviews and verifies on real hardware.

Why now: the team is just forming, and the first device DP lists are being
requested from Maxsen's Tuya developer. The kit should be ready when they arrive.

## How devices reach Home Assistant (context)

HA Green + Zigbee USB radio + **Zigbee2MQTT (Z2M)** add-on. Devices pair
directly to Z2M (not via the Tuya gateway/cloud). Z2M maps each device using a
definition from its library, `zigbee-herdsman-converters` (ZHC); devices not in
the library can be added with an **external converter** — a JS file dropped in
Z2M's `external_converters` folder. Z2M publishes the device to HA via MQTT
discovery, so every exposed feature (switch, text label, enum, number) shows up
as an HA entity automatically.

ZHC already contains Tuya LCD switches with writable button names (e.g. models
`M8Pro`, `F3-Pro` in `devices/tuya.js`, using `e.text(...)` exposes mapped to
Tuya DPs). These are the reference pattern, and a Maxsen device may already be
one of them under another name.

## Goals

1. From a DP export, one Claude Code session produces: the converter file, its
   tests, and a device docs page — consistently structured across models.
2. Before writing anything, the assistant checks whether the device's
   fingerprint (Zigbee model ID + manufacturer name) is already supported in
   the pinned ZHC version. If it is, the assistant doesn't rewrite it: it
   produces a thin **Maxsen-branded** definition that reuses the upstream one
   (see Decided).
3. The pipeline is **device-agnostic**: any Tuya DP can be mapped to a ZHC
   expose (switch, number, enum, binary, text, sensor value, cover, climate…).
   Category helpers (gang switch, screen labels, backlight, energy metering,
   cover, thermostat) sit on top as an optional convenience layer.
4. Tests run offline (no device, no Z2M install) and catch wrong DP numbers,
   wrong types, and broken label encoding before anyone pairs hardware.
5. Screen label text, backlight, and gang switches are covered by shared
   helpers so each new model is mostly configuration. *(Icons deferred — see
   Decided.)*
6. Each shipped converter works when dropped into a stock Z2M
   `external_converters` folder.

## Non-goals (for this version)

- GitHub automation (issue → automatic PR). Planned next; the kit should not
  preclude it.
- A Python HA custom integration, Tuya cloud integration, or Maxsen cloud API.
- Customer dashboards / panel layouts, onboarding flows, hub images.
- Customer-facing or support-staff AI assistants.
- Submitting definitions upstream to ZHC (pending Maxsen's permission to open
  source; keep conventions compatible so it's easy later).

## Anti-goals

- A converter that passes tests but misbehaves on a real switch is marked as
  done. Every device stays "unverified" until a person completes its hardware
  checklist.
- The assistant merging or shipping its own work. A human always reviews.
- Maxsen-specific conventions that diverge from ZHC style so far that
  upstreaming later means a rewrite.

## Constraints

- Z2M 2.x external converter format; Node 20+ (container has Node 22).
- ZHC is pinned to one exact version, chosen to match the Z2M version shipped
  in the current HA Z2M add-on; the README explains how to bump it.
- The shipped converter must be a single self-contained file (Z2M loads each
  external converter file on its own; don't rely on it resolving relative
  imports of repo-local helpers). Shared helpers may exist in source, but the
  deliverable per model is one file.
- No real Maxsen DP list exists yet. The kit is built against a clearly marked
  **fictional example device** (a 4-gang LCD switch modeled on the upstream
  `M8Pro` DP layout). It must be obvious in file names and docs that it is not
  a real Maxsen product.
- Label text encoding and max length are unknown until the DP details arrive;
  the label helper must make both configurable per model.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Claude Code kit in this repo: `CLAUDE.md`, a project skill `/add-maxsen-device`, converter template + shared helpers, offline tests against the real ZHC library | Each developer needs Claude Code access |
| B | A + GitHub Action: issue with DP file attached → assistant opens a PR | Extra setup (Action, API key); less interactive. Deferred, not rejected |
| C | Custom-built assistant tool (Agent SDK etc.) | Weeks of work to replicate what A gives |

Chosen by the user: **A**, with B as a later addition.

## Decided

**Language/tooling:** JavaScript (ES modules) to match Z2M/ZHC; npm; ZHC as a
pinned dev dependency.

**Repo layout:**

```
CLAUDE.md                     # conventions + workflow for the assistant
README.md                     # human guide: setup, add a device, install on HA
package.json
.claude/skills/add-maxsen-device/SKILL.md
src/lib/                      # shared helpers (gangs, labels, backlight, icons)
src/devices/<model>.mjs       # per-model definition source
converters/<model>.mjs        # shipped single-file external converter (generated from src)
datapoints/<model>.json       # normalized DP spec — source of truth per model
datapoints/raw/<model>.*      # original export as received
templates/datapoints.csv      # blank template a developer can fill by hand
scripts/                      # import (raw export → normalized JSON), build, check-upstream
tests/                        # per-model tests + shared harness
docs/devices/<model>.md       # features, DP table, install steps, hardware checklist
```

**Normalized DP spec** (per model) records: identifiers (model name, Tuya PID,
Zigbee model ID, manufacturer names), and per DP: id, code, name, type
(bool/value/enum/string/raw/bitmap), access (ro/wo/rw), range/scale/unit or
enum values, and — for screen DPs — encoding, max length, gang/endpoint it
belongs to. This file, not the raw export, drives generation.

**Fingerprint and wire format** *(Claude's call)*: the Tuya platform export
gives DP ids/types but not the Zigbee model ID / manufacturer name, and doesn't
prove every DP travels over the Tuya cluster (0xEF00). The skill takes the
fingerprint from the developer's answer (it's in the request sent to Maxsen's
Tuya developer) or from a Z2M pairing/interview log. If neither is available,
it uses a clearly marked placeholder, and the upstream check is re-run once
the real fingerprint is known. Version 1 generates definitions for **all-DP
(TS0601-style)** devices, which is how the upstream LCD switches, curtain
motors, thermostats and many sensors work. Many Tuya plugs and simple switches
(TS000x / TS011F-style) instead use standard Zigbee clusters (on/off,
metering) on separate endpoints; these are almost always already in ZHC, so
they go through the branded-reuse path. A standard-cluster device that is
*not* upstream is reported to the developer for manual handling, not guessed
at.

**Already supported upstream → Maxsen-branded reuse** *(Claude's call; the
user can override)*: customers of a Maxsen add-on service should see "Maxsen
<model>" in HA, not another brand. When the fingerprint exists in ZHC, the
skill generates a small external converter that reuses the upstream
definition (ZHC's white-label pattern or an equivalent wrapper) under Maxsen
vendor/model names, and adds any Maxsen-specific features the upstream
definition lacks (e.g. screen labels). Tests confirm it still matches the
fingerprint and exposes at least everything upstream does.

**Icons** *(Claude's call)*: deferred. Icons might be an enum, an index per
gang, or a bitmap upload, and the reference devices don't cover them. The
normalized spec keeps any icon DPs (so nothing is lost), the skill lists them
as "not yet supported" in the device doc, and an icon helper gets built once a
real DP definition exists.

**`/add-maxsen-device` skill workflow:**
1. Take the raw DP export (Tuya platform JSON, or the CSV template).
2. Normalize it into `datapoints/<model>.json`; list anything ambiguous and ask
   the developer rather than guessing (e.g. label encoding).
3. Check upstream: search the pinned ZHC for the fingerprint. If supported,
   report the existing model and take the branded-reuse path.
4. Otherwise generate `src/devices/<model>.mjs` — category helpers where they
   fit, generic DP→expose mapping for everything else — and build
   `converters/<model>.mjs`.
5. Generate tests; run them until green.
6. Write `docs/devices/<model>.md` including the hardware checklist, status
   "unverified".
7. Commit on a branch for human review. Never mark verified or merge.

**Tests must at minimum:** load each shipped converter through ZHC the way Z2M
would; assert fingerprint and exposes; for each writable DP, assert the Tuya
frame produced for a sample value (DP id, type, payload bytes — including label
text encoding and length limit); for each reported DP, assert the decoded HA
state.

**Example devices** (all fictional, clearly marked):
- `example-sw4-lcd`: 4-gang screen switch: per-gang switch + label text,
  scene labels, backlight (M8Pro-like DP layout). Proves the screen path.
- `example-plug-meter` (all-DP plug with power/energy metering) and
  `example-curtain` (all-DP curtain motor). Prove the generic, non-switch path.
- One branded-reuse example wrapping an existing upstream device. Proves the
  upstream path.

## Left to the builder

- Test framework and harness internals (how to drive ZHC's `toZigbee` /
  `fromZigbee` with mock endpoints).
- Helper APIs in `src/lib/` and how the build inlines them into one file.
- Exact parsing of the Tuya platform export (support what the platform
  produces; the CSV template covers hand entry).
- Which ZHC version to pin (latest compatible with current Z2M add-on).
- Which categories get a dedicated helper in v1 beyond switch/screen/
  backlight (metering, cover, thermostat are suggested; the generic path must
  work without them).
- Wording/structure of `CLAUDE.md` and the skill, within the workflow above.
