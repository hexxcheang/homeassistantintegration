import type { Pt } from './types.ts';

/**
 * A marker's touch area: a circle of `hitRadius` around its centre. `glyphRadius` is how far the
 * marker itself is drawn from its centre, when that is known (see `elementsAt`).
 */
export interface MarkerHit {
  elementId: string;
  x: number;
  y: number;
  hitRadius: number;
  glyphRadius?: number;
}

/**
 * A line's touch area: a stroke of half-width `hitRadius` along its points, with round ends.
 * `glyphRadius` is the half-width the line itself is drawn with, when that is known.
 */
export interface PathHit {
  elementId: string;
  points: Pt[];
  closed?: boolean;
  hitRadius: number;
  glyphRadius?: number;
}

/**
 * A box's touch area (a reading pill, a text label): the box from (`x`, `y`), its top-left corner,
 * `w` wide and `h` high, grown by `hitRadius` all round with rounded corners.
 */
export interface RectHit {
  elementId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hitRadius: number;
}

export type HitItem = MarkerHit | PathHit | RectHit;

/** Distance from `p` to the box: 0 anywhere inside it. */
export function distanceToRect(p: Pt, rect: Pick<RectHit, 'x' | 'y' | 'w' | 'h'>): number {
  return Math.hypot(
    Math.max(rect.x - p.x, 0, p.x - (rect.x + rect.w)),
    Math.max(rect.y - p.y, 0, p.y - (rect.y + rect.h)),
  );
}

/** Distance from `p` to the segment a-b: perpendicular beside it, to the nearest end beyond it. */
function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `point` to the nearest point of the polyline; `Infinity` for a path with no points. */
export function distanceToPath(point: Pt, points: Pt[], closed = false): number {
  const first = points[0];
  if (!first) return Infinity;
  if (points.length === 1) return Math.hypot(point.x - first.x, point.y - first.y);
  let nearest = Infinity;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    nearest = Math.min(nearest, distanceToSegment(point, points[i] as Pt, points[(i + 1) % points.length] as Pt));
  }
  return nearest;
}

/**
 * The elements whose touch area holds `point`, best first. Everything is in the same unit (screen
 * pixels in the view). An element with several areas (a marker and its reading) is listed once, at
 * its nearest one. Elements at the same distance keep the order they first appear in.
 *
 * A point inside what a device itself is drawn as (a marker within `glyphRadius` of its centre, a
 * line within `glyphRadius` of its stroke) belongs to that device first: when exactly one device's
 * glyph holds the point it is the only one returned (a reading pill or label, or another device's
 * touch halo, that happens to cover it does not take it), and when several do they come first,
 * nearest first. Only when no glyph holds the point do the pills, labels and halos decide, nearest first.
 */
export function elementsAt(point: Pt, items: readonly HitItem[]): string[] {
  const nearest = new Map<string, number>();
  const inGlyph = new Map<string, number>();
  for (const item of items) {
    const distance =
      'points' in item
        ? distanceToPath(point, item.points, item.closed)
        : 'w' in item
          ? distanceToRect(point, item)
          : Math.hypot(point.x - item.x, point.y - item.y);
    if (distance > item.hitRadius) continue;
    nearest.set(item.elementId, Math.min(distance, nearest.get(item.elementId) ?? Infinity));
    if (!('w' in item) && item.glyphRadius !== undefined && distance <= item.glyphRadius) {
      inGlyph.set(item.elementId, Math.min(distance, inGlyph.get(item.elementId) ?? Infinity));
    }
  }
  const byDistance = (a: [string, number], b: [string, number]) => a[1] - b[1];
  // Array.prototype.sort is stable, so equal distances keep the order the elements were first hit in.
  const glyphs = [...inGlyph].sort(byDistance).map(([elementId]) => elementId);
  if (glyphs.length === 1) return glyphs;
  const rest = [...nearest].filter(([elementId]) => !inGlyph.has(elementId)).sort(byDistance);
  return [...glyphs, ...rest.map(([elementId]) => elementId)];
}
