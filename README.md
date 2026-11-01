# Maxsen Home

A Home Assistant integration that puts a Maxsen Planner home drawing on your dashboard: the floor
plan with every light, switch, curtain and sensor on it, live and tappable.

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
