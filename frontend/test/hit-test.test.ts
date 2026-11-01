import { describe, expect, it } from 'vitest';
import { distanceToPath, distanceToRect, elementsAt } from '../src/hit-test.ts';

describe('elementsAt', () => {
  const a = { elementId: 'a', x: 100, y: 100, hitRadius: 22 };
  const b = { elementId: 'b', x: 130, y: 100, hitRadius: 22 };

  it('returns every item whose hit area holds the point, nearest first', () => {
    expect(elementsAt({ x: 115, y: 100 }, [a, b])).toEqual(['a', 'b']);
    expect(elementsAt({ x: 120, y: 100 }, [a, b])).toEqual(['b', 'a']);
    // The order of the input does not matter.
    expect(elementsAt({ x: 120, y: 100 }, [b, a])).toEqual(['b', 'a']);
  });

  it('returns only the item in reach when the others are too far', () => {
    expect(elementsAt({ x: 80, y: 100 }, [a, b])).toEqual(['a']);
  });

  it('returns nothing for a point outside every hit area', () => {
    expect(elementsAt({ x: 300, y: 300 }, [a, b])).toEqual([]);
    expect(elementsAt({ x: 0, y: 0 }, [])).toEqual([]);
  });

  it('counts the edge of a hit area as inside', () => {
    expect(elementsAt({ x: 122, y: 100 }, [a])).toEqual(['a']);
    expect(elementsAt({ x: 122.01, y: 100 }, [a])).toEqual([]);
  });

  it('uses each item\'s own radius', () => {
    const small = { elementId: 's', x: 200, y: 200, hitRadius: 5 };
    const big = { elementId: 'g', x: 220, y: 200, hitRadius: 30 };
    expect(elementsAt({ x: 207, y: 200 }, [small, big])).toEqual(['g']);
    expect(elementsAt({ x: 203, y: 200 }, [small, big])).toEqual(['s', 'g']);
  });

  it('hits a path within its hit stroke half-width, measured to the nearest point of the line', () => {
    const strip = { elementId: 'strip', points: [{ x: 0, y: 50 }, { x: 200, y: 50 }], hitRadius: 22 };
    expect(elementsAt({ x: 100, y: 70 }, [strip])).toEqual(['strip']);
    expect(elementsAt({ x: 100, y: 80 }, [strip])).toEqual([]);
    // Beyond the end, the round cap reaches as far as the half-width.
    expect(elementsAt({ x: 215, y: 50 }, [strip])).toEqual(['strip']);
    expect(elementsAt({ x: 230, y: 50 }, [strip])).toEqual([]);
  });

  it('orders a marker and a path by their distance to the tap', () => {
    const strip = { elementId: 'strip', points: [{ x: 0, y: 110 }, { x: 200, y: 110 }], hitRadius: 22 };
    const marker = { elementId: 'm', x: 100, y: 100, hitRadius: 22 };
    expect(elementsAt({ x: 100, y: 101 }, [strip, marker])).toEqual(['m', 'strip']);
    expect(elementsAt({ x: 100, y: 109 }, [marker, strip])).toEqual(['strip', 'm']);
  });

  it('keeps the input order for items at the same distance', () => {
    const one = { elementId: 'one', x: 100, y: 100, hitRadius: 22 };
    const two = { elementId: 'two', x: 100, y: 100, hitRadius: 22 };
    expect(elementsAt({ x: 100, y: 100 }, [one, two])).toEqual(['one', 'two']);
    expect(elementsAt({ x: 100, y: 100 }, [two, one])).toEqual(['two', 'one']);
  });

  it('lists an element once even if it is given twice', () => {
    expect(elementsAt({ x: 100, y: 100 }, [a, { ...a }])).toEqual(['a']);
  });
});

describe('distanceToPath', () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

  it('is the perpendicular distance beside a segment', () => {
    expect(distanceToPath({ x: 40, y: 30 }, line)).toBe(30);
    expect(distanceToPath({ x: 40, y: -12 }, line)).toBe(12);
    expect(distanceToPath({ x: 40, y: 0 }, line)).toBe(0);
  });

  it('is the distance to the nearest end beyond the ends of a segment', () => {
    expect(distanceToPath({ x: -30, y: 40 }, line)).toBe(50);
    expect(distanceToPath({ x: 130, y: 40 }, line)).toBe(50);
  });

  it('takes the nearest of several segments', () => {
    const bent = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(distanceToPath({ x: 90, y: 60 }, bent)).toBe(10);
    expect(distanceToPath({ x: 60, y: 10 }, bent)).toBe(10);
  });

  it('measures to a single point, a degenerate segment, and an empty path', () => {
    expect(distanceToPath({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBe(5);
    expect(distanceToPath({ x: 3, y: 4 }, [{ x: 0, y: 0 }, { x: 0, y: 0 }])).toBe(5);
    expect(distanceToPath({ x: 3, y: 4 }, [])).toBe(Infinity);
  });

  it('can close the path back to its first point', () => {
    const open = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(distanceToPath({ x: 40, y: 40 }, open)).toBe(40);
    expect(distanceToPath({ x: 40, y: 40 }, open, true)).toBeCloseTo(0, 5);
  });
});

describe('elementsAt with box items', () => {
  const pill = { elementId: 'sen', x: 100, y: 50, w: 70, h: 24, hitRadius: 0 };

  it('hits inside the box, anywhere in it, and not beyond its edge', () => {
    expect(elementsAt({ x: 165, y: 55 }, [pill])).toEqual(['sen']);
    expect(elementsAt({ x: 170, y: 74 }, [pill])).toEqual(['sen']);
    expect(elementsAt({ x: 170.5, y: 55 }, [pill])).toEqual([]);
    expect(elementsAt({ x: 130, y: 74.5 }, [pill])).toEqual([]);
    expect(elementsAt({ x: 130, y: 49.5 }, [pill])).toEqual([]);
  });

  it('reaches hitRadius beyond the box, measured to its edge, rounded at the corners', () => {
    const roomy = { ...pill, hitRadius: 4 };
    expect(elementsAt({ x: 174, y: 60 }, [roomy])).toEqual(['sen']);
    expect(elementsAt({ x: 175, y: 60 }, [roomy])).toEqual([]);
    expect(elementsAt({ x: 173, y: 77 }, [roomy])).toEqual([]);
    expect(elementsAt({ x: 172, y: 76 }, [roomy])).toEqual(['sen']);
    expect(distanceToRect({ x: 100, y: 50 }, roomy)).toBe(0);
  });

  it('lists an element once, at its nearest area, however many areas it has', () => {
    const marker = { elementId: 'sen', x: 60, y: 50, hitRadius: 22 };
    const other = { elementId: 'other', x: 120, y: 55, hitRadius: 22 };
    // Inside the pill (distance 0), 65 from the marker, 5 from the other: the pill's distance counts, so it heads the list.
    expect(elementsAt({ x: 125, y: 55 }, [marker, other, pill])).toEqual(['sen', 'other']);
    // Only the marker reaches here.
    expect(elementsAt({ x: 40, y: 50 }, [marker, other, pill])).toEqual(['sen']);
  });
});
