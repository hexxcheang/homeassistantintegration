# Test fixtures

`home-v1.json` is a real home package: it was produced by the planner's own
`buildHomePackage` (`packages/domain/src/home-package/build.ts`), not written by hand, so
the scene shapes (`marker`, `path`, `note`, legend, labels, dotted curtain dash) match the
contract exactly.

- Planner commit: `b08cc1c` (maxsen-planner).
- Project: 2 levels. Level 1 has a smart-home and a lighting plan that share one background
  (`file-l1`); level 2 has one smart-home plan (`file-l2`). Elements: a 3-gang smart switch with a
  label, a door sensor, a curtain path, a text note (in the smart-home plan), 3 downlights and an
  LED strip (in the lighting plan), and a motion sensor on level 2. The catalogue products come
  from the planner's `sample` catalogue and `sample.DEFAULT_SETTINGS`; `includeNotes` was true.
- The images are 1x1 PNGs attached by hand under the image ids `buildHomePackage` returned.

Regenerate it whenever the planner's home package contract changes (a throwaway script that
builds a `HomeSource`, calls `buildHomePackage` and writes the JSON with the images added);
then update the tests that reference its ids.

`home-v1-rooms.json` is the same kind of package for a level whose clean drawing is approved: the
level carries `rooms` (two rooms sharing a wall, a door, a window) and `furniture` (a wardrobe and
a bed). It was produced by the planner's `buildHomePackage` (planner commit `10cb27b`) from a
one-level project whose two plans share a clean drawing (a 1x1 PNG attached under `file-clean`),
a 12 m measured scale and a magic layout; two devices (a switch and a door sensor) are on it.
