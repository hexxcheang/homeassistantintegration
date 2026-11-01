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
  newer planner) gets a plain-language message and nothing changes.
- **Planner update file…**: pretend the planner now holds this other version of the home. Use it
  with the refresh tool to see what a refresh adds, removes and redraws.
- **Panel 1280×800 / Phone 390×844**: the size of the frame the panel is shown in, so you can check
  both the wide layout and the phone layout.
- **Admin** and **Installer mode**: the two things a Home Assistant user needs before the
  installer tools (link mode, refresh, starter scenes) appear. Switch them off to see what an
  ordinary user sees.

Below the toolbar is the actual Maxsen Home panel. Tapping a light or a switch turns it on or off,
the door sensors open and close by themselves every 20 seconds so you can see an alert, and
whatever you change (links, the quick panel) is kept until you reload the page.

### It is a simulation

Nothing here talks to a real home or to Home Assistant. The preview makes up devices for every
element of the drawing (switches, curtains, air conditioners, sensors, and one lighting circuit
for every four lights) and answers the panel the way the integration does. Reloading the page
starts again from the sample home.
