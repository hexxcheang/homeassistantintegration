import type { Pt } from './types.ts';

/** A marker's touch area: a circle of `hitRadius` around its centre. */
export interface MarkerHit {
  elementId: string;
  x: number;
  y: number;
  hitRadius: number;
}

/** A line's touch area: a stroke of half-width `hitRadius` along its points, with round ends. */
export interface PathHit {
  elementId: string;
  points: Pt[];
  closed?: boolean;
  hitRadius: number;
}

export type HitItem = MarkerHit | PathHit;

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
 * The elements whose touch area holds `point`, nearest first. Everything is in the same unit
 * (screen pixels in the view). Items at the same distance keep their given order.
 */
export function elementsAt(point: Pt, items: readonly HitItem[]): string[] {
  const hits: { elementId: string; distance: number }[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.elementId)) continue;
    const distance =
      'points' in item
        ? distanceToPath(point, item.points, item.closed)
        : Math.hypot(point.x - item.x, point.y - item.y);
    if (distance > item.hitRadius) continue;
    seen.add(item.elementId);
    hits.push({ elementId: item.elementId, distance });
  }
  // Array.prototype.sort is stable, so equal distances keep the input order.
  return hits.sort((a, b) => a.distance - b.distance).map((h) => h.elementId);
}
