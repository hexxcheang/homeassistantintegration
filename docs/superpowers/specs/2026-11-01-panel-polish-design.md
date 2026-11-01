# Maxsen Home: Wall Panel Polish (short design)

Date: 2026-11-01
Status: Draft, awaiting approval
Builds on: `2026-11-01-maxsen-floorplan-dashboard-design.md`

## Why

The final review and the owner's real project "17 Dairy Farm 01-04" showed where
the floor plan screen falls short on a real wall panel:
- Panels lose live updates after a Home Assistant restart.
- Photo backgrounds are grey and grainy.
- Portrait plans look tiny on landscape panels.
- About 109 devices sit on one combined view.
- Switch clusters are too close together to tap reliably.

The owner approved all six fixes below.

## Changes

1. **Panel survives HA restarts.** While HA is restarting, the Maxsen entry is listed but not yet
   loaded. Treat that, and "no entry" during a retry or reconnect, as *retry later*, using the
   existing 2/5/10/30 s backoff. Keep showing the home already on screen meanwhile.
2. **No duplicate live-update subscriptions.** Subscribe with
   home-assistant-js-websocket's `{ resubscribe: false }`. On reconnect, drop the old unsubscribe
   handle without calling it, then subscribe again. Tests use a fake connection that resubscribes the
   way the real one does.
3. **Softer backgrounds.** Each home gets a display setting: background `soft` (default) or
   `original`.
   - `soft` shows the background in greyscale, lighter and with less contrast, so devices and glows
     stand out.
   - The setting is stored with the home (shared by every panel and phone).
   - Installers switch it in Installer mode.
   - Any logged-in user can read it; only an admin in installer mode can change it (server-enforced).
4. **Open zoomed to the rooms.** Each level opens fitted to the area that holds devices (the box
   around all drawn items plus an 8% margin), not the whole page.
   - Double-tap returns to that fitted view.
   - A small "Whole drawing" button shows the full page.
5. **Layer toggle.** When a level has both a Smart Home and a Lighting plan, show
   **All | Smart Home | Lighting**.
   - All is the default when the plans share a background.
   - When the backgrounds differ, only Smart Home | Lighting is shown, as today.
6. **Cluster picker.** A tap or press-and-hold that lands on more than one device's touch area opens
   a small list of those devices (name and live state) to pick from. The same applies in link mode.

The preview app's simulated Home Assistant gets the same behaviour, so it can be tried on a Mac.

## Not in this change

Redrawing photo backgrounds as clean 2D plans. That is a separate design (see the conversation).

## Left to the builder

Exact filter values for `soft`, the picker's look, the "Whole drawing" button placement, and the
reconnect state machine details, within the rules above.
