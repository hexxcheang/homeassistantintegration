import { describe, expect, it } from 'vitest';
import type { HomePlan, SceneItem } from '../src/types.ts';
import { contentBox, layerOptions, placeInside } from '../src/view-geometry.ts';

function marker(x: number, y: number, size = 20, extra: Partial<SceneItem> = {}): SceneItem {
  return {
    type: 'marker',
    elementId: `m-${x}-${y}`,
    z: 0,
    categoryId: 'smart-switches',
    shape: 'square',
    x,
    y,
    rotation: 0,
    size,
    color: '#000',
    badgeStyle: 'filled',
    badge: { text: '', color: '#fff', dx: 0, dy: 0, fontSize: 8 },
    pathD: '',
    ...extra,
  } as SceneItem;
}

describe('contentBox', () => {
  it('puts 8% of the span on each side of the items', () => {
    // The markers' outer edges span x 200-400 and y 300-500.
    const box = contentBox([marker(210, 310), marker(390, 490)], 1000, 1400);
    expect(box).toEqual({ x: 184, y: 284, w: 232, h: 232 });
  });

  it('is clamped at 0 and at the drawing size', () => {
    expect(contentBox([marker(30, 30), marker(300, 300)], 1000, 1400)).toMatchObject({ x: 0, y: 0 });
    const far = contentBox([marker(700, 1100), marker(990, 1390)], 1000, 1400);
    expect(far.x + far.w).toBe(1000);
    expect(far.y + far.h).toBe(1400);
  });

  it('falls back to the whole drawing when there are no items', () => {
    expect(contentBox([], 1000, 1400)).toEqual({ x: 0, y: 0, w: 1000, h: 1400 });
  });

  it('never gives a zero-size box for a single item', () => {
    const box = contentBox([marker(500, 700)], 1000, 1400);
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
    expect(box.x).toBeLessThanOrEqual(490);
    expect(box.x + box.w).toBeGreaterThanOrEqual(510);
    expect(box.y).toBeLessThanOrEqual(690);
    expect(box.y + box.h).toBeGreaterThanOrEqual(710);
  });

  it('keeps a single item at the corner inside the drawing', () => {
    const box = contentBox([marker(5, 5)], 1000, 1400);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.w).toBeGreaterThan(20);
  });

  it('covers a line to its stroke and a note to its text', () => {
    const line: SceneItem = {
      type: 'path',
      elementId: 'p',
      z: 0,
      categoryId: 'led-strips',
      kind: 'led-strip',
      shape: 'strip',
      d: '',
      points: [
        { x: 300, y: 600 },
        { x: 500, y: 600 },
      ],
      closed: false,
      smooth: false,
      strokeWidth: 10,
      color: '#000',
      heads: [],
    };
    const note: SceneItem = {
      type: 'note',
      elementId: 'n',
      z: 0,
      x: 600,
      y: 650,
      text: 'Hello',
      fontSize: 20,
      bold: false,
      color: '#000',
      highlight: null,
    };
    const box = contentBox([line, note], 1000, 1000);
    expect(box.x).toBeLessThan(295);
    expect(box.y).toBeLessThan(595);
    // The note's text runs right of its anchor.
    expect(box.x + box.w).toBeGreaterThan(600 + 40);
    expect(box.y + box.h).toBeGreaterThan(650 + 20);
  });
});

function plan(type: HomePlan['type'], key: string): HomePlan {
  return { type, background: { imageId: 'i', key } } as HomePlan;
}

describe('layerOptions', () => {
  it('offers All when both plans share a background', () => {
    expect(layerOptions([plan('smart-home', 'k'), plan('lighting', 'k')])).toEqual([
      'all',
      'smart-home',
      'lighting',
    ]);
  });

  it('offers only the two layers when the backgrounds differ', () => {
    expect(layerOptions([plan('smart-home', 'a'), plan('lighting', 'b')])).toEqual(['smart-home', 'lighting']);
  });

  it('offers nothing when only one plan exists', () => {
    expect(layerOptions([plan('lighting', 'k')])).toEqual([]);
    expect(layerOptions([plan('smart-home', 'k')])).toEqual([]);
    expect(layerOptions([])).toEqual([]);
  });
});

describe('placeInside', () => {
  const bounds = { w: 800, h: 600 };
  const size = { w: 280, h: 152 };

  it('puts the box below the anchor, centred on it', () => {
    expect(placeInside({ x: 400, y: 200 }, size, bounds, 14, 8)).toEqual({ x: 260, y: 214 });
  });

  it('keeps the box inside the bounds at every edge', () => {
    expect(placeInside({ x: 5, y: 100 }, size, bounds, 14, 8).x).toBe(8);
    expect(placeInside({ x: 795, y: 100 }, size, bounds, 14, 8).x).toBe(800 - 280 - 8);
  });

  it('goes above the anchor when there is no room below', () => {
    expect(placeInside({ x: 400, y: 560 }, size, bounds, 14, 8)).toEqual({ x: 260, y: 560 - 14 - 152 });
  });

  it('slides up against the bottom margin when it fits neither above nor below', () => {
    const tall = { w: 280, h: 400 };
    const at = placeInside({ x: 400, y: 300 }, tall, bounds, 14, 8);
    expect(at.y).toBe(600 - 400 - 8);
    expect(at.y + tall.h).toBeLessThanOrEqual(600 - 8);
  });

  it('never leaves the bounds, wherever the anchor is', () => {
    for (const x of [0, 10, 400, 790, 800]) {
      for (const y of [0, 10, 300, 590, 600]) {
        const at = placeInside({ x, y }, size, bounds, 14, 8);
        expect(at.x).toBeGreaterThanOrEqual(8);
        expect(at.y).toBeGreaterThanOrEqual(8);
        expect(at.x + size.w).toBeLessThanOrEqual(800 - 8);
        expect(at.y + size.h).toBeLessThanOrEqual(600 - 8);
      }
    }
  });
});
