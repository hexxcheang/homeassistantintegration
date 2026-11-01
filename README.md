# Maxsen Home

## What it is

Maxsen Home puts the home drawing from the Maxsen Planner on a Home Assistant dashboard: the floor
plan of each level with every light, switch, curtain and sensor on it, live and tappable. The
installer links each item on the drawing to its device in Home Assistant once; after that the
customer taps the drawing to use the home. It also has a quick panel of favourite buttons and a set
of starter scenes such as "All off".

You get a **Home** item in the Home Assistant sidebar, and a dashboard card for the same drawing.

**You need**

- Home Assistant 2025.1 or newer.
- [HACS](https://hacs.xyz) installed in that Home Assistant.
- A home from the Maxsen Planner: a pairing code, or a home file (see *Add the integration*).

The planner's side of the pairing (the **Home Assistant** button in a project) comes with the
planner change hexxcheang/maxsen-planner#25. Until that is merged and deployed, pairing does not
work; use a home file instead.

## Install with HACS

> **Not released yet:** version 0.1.0 is published after Maxsen's first hardware test. Until
> then, install only on a test Home Assistant.

1. In Home Assistant open **HACS**.
2. Open the three-dot menu at the top right and choose **Custom repositories**.
3. In **Repository** enter `https://github.com/hexxcheang/homeassistantintegration`. In **Type**
   (or **Category**) choose **Integration**. Tap **Add**.
4. Find **Maxsen Home** in the HACS list, open it and tap **Download**.
5. Restart Home Assistant (**Settings**, **System**, power button, **Restart Home Assistant**).

## Add the integration

1. Go to **Settings**, **Devices & services**, **Add integration** and search for **Maxsen Home**.
2. Choose how to bring in the home:
   - **Pair with the Maxsen Planner** (normal way). In the planner, open the project and tap
     **Home Assistant** in the top bar, then **Create pairing code**. Back in Home Assistant, enter
     the **Planner address** (starts with `https://`) and the **Pairing code**. The code works
     once and runs out after 24 hours. The project must be saved to the team first.
   - **Upload a home file** (when there is no pairing yet, or no internet at the site). In the
     planner's **Home Assistant** dialog tap **Download home file**, then choose that `.json`
     file here.
3. The **Home** item appears in the sidebar. The drawing is there, but nothing is linked yet.

One project can be added once. A home set up from a file is updated by uploading a newer file (see
*Updating the home*).

To put the drawing on a dashboard as well: **Edit dashboard**, **Add card**, **Maxsen floor plan**.
In YAML it is `type: custom:maxsen-floorplan-card`.

## Installer checklist

Do this on site, signed in to Home Assistant as an administrator.

1. **Installer mode on.** **Settings**, **Devices & services**, **Maxsen Home**, **Configure**,
   switch **Installer mode** on, **Submit**. Without it the installer tools stay hidden and the
   server refuses them, even for administrators.
2. Open **Home** in the sidebar. Tap **Installer**.
3. **Link devices.** Tap an element on the drawing, then tap the device (or, for lights, the light
   or switch) it belongs to in the list. Use **Search by name or room** to find it. The element
   stops being dashed. **Unlink** takes a link away.
   - **Select several** links a group in one go: for example tap all the downlights on one wall
     switch, then tap that switch. Pick lights together, or other devices together, not both.
   - Elements that are not shown on the drawing are under **Not on the drawing**. Tap one there
     to pick it.
   - The line at the top counts what is left ("3 not linked yet") and says "Everything is linked."
     when you are done.
4. **Create starter scenes.** Makes "All off", one "All off – (level name)" per level and
   "All lights off", and puts them on the quick panel.
5. Optional: tap **Done**, then **Edit** on the quick panel to choose which scenes and elements
   appear on it, and in what order.
6. **A non-admin user for each wall panel.** **Settings**, **People**, **Add person**; switch on
   **Allow person to login**, give it a name and password, and leave **Administrator** off. Use
   one per panel so you can remove a panel's access later.
7. **Installer mode off at handover.** Same place as step 1. Customers (and the wall panels) can
   still use the drawing and the quick panel; only the installer tools go away.

Unlinked elements are drawn greyed and do nothing when tapped. Elements whose device was deleted in
Home Assistant show "Missing device": link them again.

## Android wall panels

Use a non-admin user (checklist step 6), never an administrator.

- **Home Assistant Companion app:** install it from Google Play, sign in with the panel's user, and
  open **Home** from the sidebar.
- **Or a kiosk browser:** open `http://<home-assistant-address>:8123/maxsen-home` (the address
  you use for Home Assistant, ending in `/maxsen-home`) and sign in as the panel's user. A kiosk
  app that keeps the screen on and remembers the sign-in works best.

The panel switches between a wide layout (drawing with the quick panel beside it) and a phone
layout (quick panel under the drawing) by itself.

## Updating the home after planner changes

When the drawing or devices change in the planner, save the project to the team in the planner,
then in Home Assistant (installer mode on, signed in as administrator):

1. **Home**, **Installer**, **Refresh from planner**.
2. Read the summary, for example "2 new devices to link, 1 device removed, 1 drawing updated", with
   the lists **New devices**, **Removed devices** and **Updated drawings**.
3. Tap **Apply** to update the home, or **Cancel** to leave it as it is. "Nothing has changed."
   means there is nothing to apply.
4. Link the new devices (checklist step 3). Links for removed devices are tidied up by the refresh.

It only refreshes when you ask; Home Assistant never checks the planner by itself. For a home set
up from a file the button is **Choose a newer home file**: download the new file from the planner
and pick it. The file must be from the same project.

## Disconnecting

In the planner, open the project's **Home Assistant** dialog and tap **Disconnect** next to the
connection (staff do this). The next time an installer taps **Refresh from planner**, Home Assistant
shows "Connection revoked: ask Maxsen for a new pairing code". The drawing, links, quick panel
and scenes keep working as they are; only refreshing stops.

To connect again you need a new pairing code (the old one was used up), or the home file. The
integration cannot yet take a new code for a home it already has, so remove **Maxsen Home** in
**Settings**, **Devices & services** and add it again. Removing it clears everything kept for that
home: the links, the quick panel and the starter scenes. After adding it again, go through the
installer checklist: switch **Installer mode** on, link the devices (step 3), tap **Create starter
scenes** (step 4), set up the quick panel (step 5), and switch **Installer mode** off again.

## Troubleshooting

What the integration says, and what to do:

| Message | What to do |
| --- | --- |
| That code did not work. Check it, or create a new one in the planner. | Check the characters. A code works once and runs out after 24 hours; create a new one. |
| Too many tries. Wait a minute and try again. | Wait, then try again. |
| Could not reach the planner. Check the address and your connection. | Check the **Planner address** and that Home Assistant has internet. |
| Enter the planner address starting with https:// | Use the full address, for example `https://planner.example.com`. Plain `http://` is accepted only for `localhost` and `127.0.0.1`. |
| The planner has no home to send yet: … | Follow the planner's message, usually "Save this project to the team first." |
| This is not a Maxsen home file. | Use the file from the planner's **Download home file**, not another `.json`. |
| This home file is from a newer planner. Update this integration. | In HACS update **Maxsen Home**, restart Home Assistant. |
| This file is larger than 100 MB. | Ask Maxsen. |
| This home is already added. | That project is already in Home Assistant. Open **Home**. |
| Connection revoked: ask Maxsen for a new pairing code | See *Disconnecting*. |
| The planner is busy. Try again in 15 minutes. | Wait, then **Refresh from planner** again. |
| Can't reach the planner | Check the internet connection. The home keeps working meanwhile. |
| Refreshing needs an administrator and installer mode | Sign in as an administrator and switch **Installer mode** on. |
| The preview expired. Preview again. | Tap **Refresh from planner** again. |
| This home file is for a different project. | Pick the file of this home's project. |
| The home could not be saved. Remove this home and add it again. | Remove **Maxsen Home** and add it again. |
| Maxsen Home is not set up yet. Add it under Settings, Devices & services. | Add the integration (above). |

If the **Installer** button is missing: you are not an administrator, or **Installer mode** is off.
If an element does nothing when tapped: it is not linked yet (installer step 3).

## For developers

Everything here is for people changing the code; installers can skip it.

- **Python tests** (from the repository folder): `python3 -m venv .venv`, then
  `.venv/bin/pip install -r requirements_test.txt`, then `.venv/bin/pytest -q`.
- **Frontend tests**: `cd frontend && npm install && npm test`. `npm run typecheck` checks the types.
- **Build the bundle**: `cd frontend && npm run build`. This writes
  `custom_components/maxsen/frontend/maxsen-home.js`, which is committed so HACS installs it with
  the integration. Commit the rebuilt bundle with any change to `frontend/src`; CI fails if it is
  out of date.
- **Preview app**: run the real panel on your Mac with a simulated Home Assistant. See the next
  section.
- **Release**: the version is in `custom_components/maxsen/manifest.json` (`0.1.0`) and must match
  the GitHub release tag (`v0.1.0`). A person creates the tag after a test on real hardware.

## See it on your Mac

You can run the real panel on your Mac, without Home Assistant, to see what is changing. It runs
against a simulated home, so you can tap lights, try the installer tools and open the drawing of a
real customer.

**You need** Node 22 (the current long-term-support version) and this repository on your Mac.
If `node -v` does not print `v22.…`, install it with Homebrew:

```sh
brew install node@22
```

Homebrew installs it "keg-only", so it also prints a line to add to your `~/.zshrc` that puts
`node@22` on your `PATH`; add it and open a new terminal window.

No Homebrew? Download the installer for Node 22 (the "LTS" version) from
<https://nodejs.org> and run it.

**Then run**, from the repository folder:

```sh
cd frontend
npm install
npm run preview
```

and open <http://localhost:5174>. (Port 5174, so it does not clash with the planner on 5173.) Press
`Ctrl+C` in the terminal to stop it. After a `git pull`, run `npm install` again only if the
dependencies changed.

### The toolbar

- **Open home file…**: choose a `… home.json` downloaded from the planner, and the preview shows
  that drawing instead of the sample home. A file that is not a Maxsen home file (or is from a
  newer planner) gets a plain-language message and nothing changes. A home opened this way behaves
  like one set up from a file in Home Assistant: the refresh tool asks for a newer file instead of
  asking the planner.
- **Planner update file…**: pretend the planner now holds this other version of the home. Use it
  with **Refresh from planner** (below) to see what a refresh adds, removes and redraws. It applies
  to the sample home, which plays a home paired with the planner.
- **Panel 1280×800 / Phone 390×844**: the size of the frame the panel is shown in, so you can check
  both the wide layout and the phone layout.
- **Admin** and **Installer mode**: the two things a Home Assistant user needs before the
  installer tools appear. Switch them off to see what an ordinary user sees.

### What you can try in the panel

Below the toolbar is the actual Maxsen Home panel.

- **The drawing.** Tap a light or a switch to turn it on or off; hold one for its details. The
  door sensors open and close by themselves every 20 seconds so you can see an alert.
- **The quick panel** (beside the drawing, or under it on a phone). It starts empty. **Edit** opens
  a sheet where you tick the scenes and elements you want, and put them in order by dragging the
  handle or with the up and down buttons; **Save** keeps the list. Anyone can do this. Elements
  that are not linked yet cannot be ticked. Tap a button to use it: an element toggles, a scene
  runs.
- **Installer** (the button beside Edit; only with Admin and Installer mode on) opens link mode.
  Tap an element on the drawing to pick it, search the list for the device or light switch it
  belongs to, and tap that to link it. **Select several** links a group of elements (for example
  all the downlights on one switch) in one go. Unlinked elements have a dashed outline, and
  elements whose device has gone are marked "Missing device". Elements that are not on the drawing
  are listed under "Not on the drawing". (The sample home starts with everything linked: pick an
  element and tap **Unlink** to see the dashed outline.) **Create starter scenes** makes "All off", one per level
  and "All lights off", and puts them on the quick panel. **Done** goes back.
- **Refresh from planner** (in link mode) shows what would change ("2 new devices to link, 1 device
  removed, 1 drawing updated", with the lists) and only changes the home when you tap **Apply**.
  For a home opened from a file, **Choose a newer home file** does the same with a file you pick.

Whatever you change (links, the quick panel, scenes) is kept until you reload the page.

### It is a simulation

Nothing here talks to a real home or to Home Assistant. The preview makes up devices for every
element of the drawing (switches, curtains, air conditioners, sensors, and one lighting circuit
for every four lights) and answers the panel the way the integration does. Reloading the page
starts again from the sample home.
