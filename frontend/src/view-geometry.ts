import type { HomePlan, SceneItem } from './types.ts';

export type Layer = 'all' | 'smart-home' | 'lighting';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A fitted box is never narrower than this share of the drawing, so one lonely item is not blown up. */
const MIN_SHARE = 0.15;
/** Rough width of one character, as a share of the font size (the real metrics are only known in a browser). */
const CHAR_WIDTH = 0.58;

const round = (n: number): number => Math.round(n * 100) / 100;

interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function grow(extent: Extent, x0: number, y0: number, x1: number, y1: number): void {
  extent.minX = Math.min(extent.minX, x0);
  extent.minY = Math.min(extent.minY, y0);
  extent.maxX = Math.max(extent.maxX, x1);
  extent.maxY = Math.max(extent.maxY, y1);
}

/** Text centred on (x, y). */
function growText(extent: Extent, text: string, x: number, y: number, fontSize: number): void {
  const half = (text.length * fontSize * CHAR_WIDTH) / 2;
  grow(extent, x - half, y - fontSize / 2, x + half, y + fontSize / 2);
}

function growItem(extent: Extent, item: SceneItem): void {
  switch (item.type) {
    case 'marker': {
      const r = item.size / 2;
      grow(extent, item.x - r, item.y - r, item.x + r, item.y + r);
      if (item.label) growText(extent, item.label.text, item.label.x, item.label.y, item.label.fontSize);
      return;
    }
    case 'path': {
      const r = item.strokeWidth / 2;
      for (const p of item.points) grow(extent, p.x - r, p.y - r, p.x + r, p.y + r);
      for (const h of item.heads) grow(extent, h.x - h.size / 2, h.y - h.size / 2, h.x + h.size / 2, h.y + h.size / 2);
      if (item.label) growText(extent, item.label.text, item.label.x, item.label.y, item.label.fontSize);
      return;
    }
    case 'note': {
      // A note's text starts at its anchor and runs right and down.
      const lines = item.text.split('\n');
      const widest = Math.max(...lines.map((l) => l.length));
      grow(extent, item.x, item.y, item.x + widest * item.fontSize * CHAR_WIDTH, item.y + lines.length * item.fontSize * 1.2);
      return;
    }
  }
}

/** One axis of the box: padded, widened to the minimum if need be, and kept inside 0…total. */
function fitAxis(min: number, max: number, total: number, margin: number): [number, number] {
  const pad = (max - min) * margin;
  let lo = min - pad;
  let hi = max + pad;
  const least = total * MIN_SHARE;
  if (hi - lo < least) {
    const mid = (lo + hi) / 2;
    lo = mid - least / 2;
    hi = mid + least / 2;
    // Slide, rather than squash, a widened box that hangs over an edge.
    if (lo < 0) [lo, hi] = [0, hi - lo];
    if (hi > total) [lo, hi] = [lo - (hi - total), total];
  }
  return [Math.max(lo, 0), Math.min(hi, total)];
}

/**
 * The part of a drawing worth showing: a box around the items, `margin` of their span added on
 * each side, kept inside the drawing. With no items it is the whole drawing.
 */
export function contentBox(items: SceneItem[], width: number, height: number, margin = 0.08): Box {
  const whole = { x: 0, y: 0, w: width, h: height };
  if (items.length === 0) return whole;
  const extent: Extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const item of items) growItem(extent, item);
  if (!Number.isFinite(extent.minX + extent.minY + extent.maxX + extent.maxY)) return whole;
  const [x0, x1] = fitAxis(extent.minX, extent.maxX, width, margin);
  const [y0, y1] = fitAxis(extent.minY, extent.maxY, height, margin);
  return { x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) };
}

/**
 * The layers a level can show. Both plans on one background can be shown together (`all`);
 * plans on different backgrounds only one at a time; a single plan needs no choice.
 */
export function layerOptions(plans: HomePlan[]): Layer[] {
  const hasSmartHome = plans.some((p) => p.type === 'smart-home');
  const hasLighting = plans.some((p) => p.type === 'lighting');
  if (!hasSmartHome || !hasLighting) return [];
  const sameBackground = plans.every((p) => p.background.key === plans[0]?.background.key);
  return sameBackground ? ['all', 'smart-home', 'lighting'] : ['smart-home', 'lighting'];
}

/**
 * Where to put a box of `size` so that it sits near `anchor` and fully inside `bounds` (which
 * starts at 0, 0), `margin` from its edges. It goes below the anchor, centred on it, `gap` away;
 * above when there is no room below, and otherwise slid up against the bottom margin.
 */
export function placeInside(
  anchor: { x: number; y: number },
  size: { w: number; h: number },
  bounds: { w: number; h: number },
  gap: number,
  margin: number,
): { x: number; y: number } {
  const x = Math.max(margin, Math.min(anchor.x - size.w / 2, bounds.w - size.w - margin));
  const below = anchor.y + gap;
  const above = anchor.y - gap - size.h;
  let y: number;
  if (below + size.h <= bounds.h - margin) y = below;
  else if (above >= margin) y = above;
  else y = Math.max(margin, bounds.h - size.h - margin);
  return { x, y };
}
