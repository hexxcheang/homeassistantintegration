import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fixture3d from '../../tests/fixtures/home-v1-3d.json';
import roomsFixture from '../../tests/fixtures/home-v1-rooms.json';
import { buildThreeModel } from '../src/three-scene.ts';
import type { ThreeModel, WallPiece } from '../src/three-api.ts';
import type { HomeFurniture, HomeLevel, HomePackage, HomeRooms } from '../src/types.ts';

type RoomsInput = Partial<HomeRooms> & Pick<HomeRooms, 'rooms' | 'walls' | 'openings'>;

/** A small level; scale 0.01 so 100 plan units are 1 m. */
function level(rooms: RoomsInput, furniture?: unknown, revision = 3): HomeLevel {
  const plan = {
    id: 'plan-a',
    type: 'smart-home',
    revision,
    width: 1000,
    height: 1000,
    background: { imageId: 'img', key: 'k' },
    scene: { width: 1000, height: 1000, items: [], legend: [] },
    elements: [],
  };
  return {
    id: 'lvl',
    name: 'Level',
    sortOrder: 1,
    plans: [plan],
    rooms: { scale: 0.01, ...rooms },
    ...(furniture === undefined ? {} : { furniture }),
  } as unknown as HomeLevel;
}

const SQUARE = [[0, 0], [500, 0], [500, 400], [0, 400]] as [number, number][];
const room = (id = 'r1', polygon = SQUARE, extra: object = {}) => ({ id, name: id, polygon, ...extra });
/** One 5 m wall along the x axis, 0.2 m thick, with the given openings. */
const oneWall = (openings: RoomsInput['openings'], wallHeight?: number): HomeLevel =>
  level({
    ...(wallHeight === undefined ? {} : { wallHeight }),
    rooms: [room()],
    walls: [{ from: [0, 0], to: [500, 0], thickness: 0.2 }],
    openings,
  });

const model = (l: HomeLevel): ThreeModel => {
  const m = buildThreeModel(l);
  if (!m) throw new Error('expected a model');
  return m;
};

const r = (n: number) => Math.round(n * 1000) / 1000;
/** [fromX, toX, y0, y1, kind], sorted. */
const pieces = (m: ThreeModel) =>
  m.walls
    .map((w): [number, number, number, number, string] => [
      r(Math.min(w.from[0], w.to[0])),
      r(Math.max(w.from[0], w.to[0])),
      r(w.y0),
      r(w.y1),
      w.kind,
    ])
    .sort((a, b) => a[0] - b[0] || a[2] - b[2]);

const door = (from: number, to: number, extra: object = {}) =>
  ({ type: 'door', from: [from, 0], to: [to, 0], ...extra }) as RoomsInput['openings'][number];
const windowAt = (from: number, to: number, extra: object = {}) =>
  ({ type: 'window', from: [from, 0], to: [to, 0], ...extra }) as RoomsInput['openings'][number];

describe('buildThreeModel: the level', () => {
  it('is undefined for a level without a usable rooms layer', () => {
    const none = level({ rooms: [], walls: [], openings: [] });
    delete none.rooms;
    expect(buildThreeModel(none)).toBeUndefined();
    expect(buildThreeModel(level({ rooms: [room('bad', [[0, 0], [1, 1]])], walls: [], openings: [] }))).toBeUndefined();
    expect(buildThreeModel(level({ scale: 0, rooms: [room()], walls: [], openings: [] }))).toBeUndefined();
  });

  it('gives room polygons and bounds in metres', () => {
    const m = model(level({ scale: 0.02, rooms: [room()], walls: [{ from: [0, 0], to: [500, 0], thickness: 0.2 }], openings: [] }));
    expect(m.rooms[0]?.polygon).toEqual([[0, 0], [10, 0], [10, 8], [0, 8]]);
    expect(m.bounds).toEqual({ minX: 0, minZ: 0, maxX: 10, maxZ: 8 });
    expect(m.devices).toEqual([]);
  });

  it('maps plan y to z, not to height', () => {
    const m = model(level({ rooms: [room('r', [[100, 200], [300, 200], [300, 600]])], walls: [], openings: [] }));
    expect(m.rooms[0]?.polygon).toEqual([[1, 2], [3, 2], [3, 6]]);
    expect(m.bounds).toEqual({ minX: 1, minZ: 2, maxX: 3, maxZ: 6 });
  });

  it('puts the centre of an L-shaped room inside it', () => {
    // A thin L whose bounding box centre (and vertex mean) fall outside the room.
    const ell: [number, number][] = [[0, 0], [1000, 0], [1000, 100], [100, 100], [100, 1000], [0, 1000]];
    const m = model(level({ rooms: [room('l', ell)], walls: [], openings: [] }));
    const [cx, cz] = m.rooms[0]!.centre;
    const inside = (cx >= 0 && cx <= 10 && cz >= 0 && cz <= 1) || (cx >= 0 && cx <= 1 && cz >= 0 && cz <= 10);
    expect(inside).toBe(true);
  });

  it('centres a plain rectangle in the middle', () => {
    const m = model(level({ rooms: [room()], walls: [], openings: [] }));
    expect(m.rooms[0]?.centre[0]).toBeCloseTo(2.5);
    expect(m.rooms[0]?.centre[1]).toBeCloseTo(2);
  });

  it('defaults the wall height to 2.6 and uses the layer value when given', () => {
    expect(model(oneWall([])).wallHeight).toBe(2.6);
    expect(model(oneWall([], 3)).wallHeight).toBe(3);
  });

  it('keeps partOf when it names another room and drops it otherwise', () => {
    const m = model(
      level({
        rooms: [room('main'), room('annex', [[600, 0], [800, 0], [800, 200]], { partOf: 'main' }), room('lost', [[0, 500], [100, 500], [100, 600]], { partOf: 'nowhere' }), room('self', [[0, 700], [100, 700], [100, 800]], { partOf: 'self' })],
        walls: [],
        openings: [],
      }),
    );
    const byId = Object.fromEntries(m.rooms.map((x) => [x.id, x]));
    expect(byId['annex']?.partOf).toBe('main');
    expect('partOf' in byId['main']!).toBe(false);
    expect('partOf' in byId['lost']!).toBe(false);
    expect('partOf' in byId['self']!).toBe(false);
    expect(m.rooms).toHaveLength(4);
  });

  it('changes key when a plan revision changes, and not otherwise', () => {
    const a = model(oneWall([])).key;
    expect(model(oneWall([])).key).toBe(a);
    const l = oneWall([]);
    (l.plans[0] as { revision: number }).revision = 4;
    expect(model(l).key).not.toBe(a);
    expect(a).toContain('lvl');
  });

  it('does not import three', () => {
    for (const file of ['../src/three-scene.ts', '../src/three-api.ts']) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(/from ['"]three/);
    }
  });
});

describe('buildThreeModel: walls and openings', () => {
  it('makes one full-height piece for a wall with no opening', () => {
    const m = model(oneWall([]));
    expect(m.walls).toEqual([{ from: [0, 0], to: [5, 0], thickness: 0.2, y0: 0, y1: 2.6, kind: 'wall' }]);
  });

  it('cuts a door out of the wall and leaves a lintel over the gap', () => {
    const m = model(oneWall([door(200, 300, { sill: 0, height: 2.1 })]));
    expect(pieces(m)).toEqual([
      [0, 2, 0, 2.6, 'wall'],
      [2, 3, 2.1, 2.6, 'wall'],
      [3, 5, 0, 2.6, 'wall'],
    ]);
    expect(m.walls.every((w) => w.thickness === 0.2)).toBe(true);
  });

  it('uses 2.1 m for a door that gives no height', () => {
    expect(pieces(model(oneWall([door(200, 300)])))).toContainEqual([2, 3, 2.1, 2.6, 'wall']);
  });

  it('cuts a window: wall below the sill, glass, wall above', () => {
    const m = model(oneWall([windowAt(200, 300, { sill: 0.9, height: 1.2 })]));
    expect(pieces(m)).toEqual([
      [0, 2, 0, 2.6, 'wall'],
      [2, 3, 0, 0.9, 'wall'],
      [2, 3, 0.9, 2.1, 'glass'],
      [2, 3, 2.1, 2.6, 'wall'],
      [3, 5, 0, 2.6, 'wall'],
    ]);
  });

  it('uses sill 0.9 and height 1.2 for a window that gives neither', () => {
    expect(pieces(model(oneWall([windowAt(200, 300)])))).toContainEqual([2, 3, 0.9, 2.1, 'glass']);
  });

  it('clips an opening taller than the wall, with no lintel', () => {
    expect(pieces(model(oneWall([door(200, 300, { height: 3 })])))).toEqual([
      [0, 2, 0, 2.6, 'wall'],
      [3, 5, 0, 2.6, 'wall'],
    ]);
    expect(pieces(model(oneWall([windowAt(200, 300, { sill: 0.9, height: 3 })])))).toEqual([
      [0, 2, 0, 2.6, 'wall'],
      [2, 3, 0, 0.9, 'wall'],
      [2, 3, 0.9, 2.6, 'glass'],
      [3, 5, 0, 2.6, 'wall'],
    ]);
  });

  it('clips against a lower wall height', () => {
    expect(pieces(model(oneWall([door(200, 300)], 2)))).toEqual([
      [0, 2, 0, 2, 'wall'],
      [3, 5, 0, 2, 'wall'],
    ]);
  });

  it('ignores an opening that lies on no wall', () => {
    const far = { type: 'door', from: [200, 40], to: [300, 40] } as RoomsInput['openings'][number];
    expect(pieces(model(oneWall([far])))).toEqual([[0, 5, 0, 2.6, 'wall']]);
  });

  it('assigns an opening within half the thickness plus 5 cm, and not beyond', () => {
    const near = { type: 'door', from: [200, 14], to: [300, 14] } as RoomsInput['openings'][number];
    const past = { type: 'door', from: [200, 16], to: [300, 16] } as RoomsInput['openings'][number];
    expect(model(oneWall([near])).walls).toHaveLength(3);
    expect(model(oneWall([past])).walls).toHaveLength(1);
  });

  it('ignores an opening across the wall rather than along it', () => {
    const across = { type: 'door', from: [250, -50], to: [250, 50] } as RoomsInput['openings'][number];
    expect(pieces(model(oneWall([across])))).toEqual([[0, 5, 0, 2.6, 'wall']]);
  });

  it('cuts two openings on one wall', () => {
    const m = model(oneWall([door(100, 200), windowAt(300, 400)]));
    expect(pieces(m)).toEqual([
      [0, 1, 0, 2.6, 'wall'],
      [1, 2, 2.1, 2.6, 'wall'],
      [2, 3, 0, 2.6, 'wall'],
      [3, 4, 0, 0.9, 'wall'],
      [3, 4, 0.9, 2.1, 'glass'],
      [3, 4, 2.1, 2.6, 'wall'],
      [4, 5, 0, 2.6, 'wall'],
    ]);
  });

  it('clips an opening that runs past the end of the wall', () => {
    expect(pieces(model(oneWall([door(-100, 100)])))).toEqual([
      [0, 1, 2.1, 2.6, 'wall'],
      [1, 5, 0, 2.6, 'wall'],
    ]);
    expect(pieces(model(oneWall([door(400, 700)])))).toEqual([
      [0, 4, 0, 2.6, 'wall'],
      [4, 5, 2.1, 2.6, 'wall'],
    ]);
    // Past the end altogether: nothing to cut.
    expect(pieces(model(oneWall([door(600, 700)])))).toEqual([[0, 5, 0, 2.6, 'wall']]);
  });

  it('never produces a piece of zero or negative size for overlapping openings', () => {
    const m = model(oneWall([door(100, 300), windowAt(200, 400), door(250, 250), windowAt(0, 0)]));
    for (const w of m.walls) {
      expect(Math.abs(w.to[0] - w.from[0])).toBeGreaterThan(1e-6);
      expect(w.y1 - w.y0).toBeGreaterThan(1e-6);
    }
    // Where the door and the window overlap the door wins: open to 2.1.
    expect(pieces(m)).toContainEqual([2, 3, 2.1, 2.6, 'wall']);
    expect(pieces(m).filter((p) => p[0] >= 2 && p[1] <= 3 && p[4] === 'glass')).toEqual([]);
    // Beyond the door the window shows.
    expect(pieces(m)).toContainEqual([3, 4, 0.9, 2.1, 'glass']);
  });

  it('keeps walls given backwards and skips a wall of no length', () => {
    const l = level({
      rooms: [room()],
      walls: [{ from: [500, 0], to: [0, 0], thickness: 0.2 }, { from: [10, 10], to: [10, 10], thickness: 0.2 }],
      openings: [door(200, 300)],
    });
    expect(pieces(model(l))).toEqual([
      [0, 2, 0, 2.6, 'wall'],
      [2, 3, 2.1, 2.6, 'wall'],
      [3, 5, 0, 2.6, 'wall'],
    ]);
  });
});

const furnished = (item: Partial<HomeFurniture> & { type: string }): ThreeModel =>
  model(
    level(
      { rooms: [room()], walls: [], openings: [] },
      [{ id: 'f1', roomId: 'r1', x: 100, y: 200, rotation: 0, width: 1.2, depth: 0.6, height: 2, builtIn: false, ...item }],
    ),
  );

describe('buildThreeModel: furniture', () => {
  it('makes a wardrobe one body box of its size, at its spot', () => {
    const f = furnished({ type: 'wardrobe', rotation: 90, width: 1.35, depth: 0.84, height: 2.4 }).furniture;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: 'f1', type: 'wardrobe', roomId: 'r1' });
    expect(f[0]?.boxes).toEqual([{ centre: [1, 1.2, 2], size: [1.35, 2.4, 0.84], turn: 90, part: 'body' }]);
  });

  it('makes an unknown type one body box of its size', () => {
    const boxes = furnished({ type: 'mystery', width: 0.5, depth: 0.4, height: 0.3 }).furniture[0]!.boxes;
    expect(boxes).toEqual([{ centre: [1, 0.15, 2], size: [0.5, 0.3, 0.4], turn: 0, part: 'body' }]);
  });

  it('makes a bed a low body and a raised head on its back side', () => {
    const boxes = furnished({ type: 'bed', rotation: 90, width: 1.6, depth: 2, height: 0.6 }).furniture[0]!.boxes;
    expect(boxes).toHaveLength(2);
    const [body, head] = boxes as [(typeof boxes)[number], (typeof boxes)[number]];
    expect(body.part).toBe('body');
    expect(body.size).toEqual([1.6, expect.closeTo(0.33), 2]);
    expect(body.centre[0]).toBeCloseTo(1);
    expect(head.size[1]).toBeGreaterThan(body.size[1]);
    expect(head.size[1]).toBeLessThanOrEqual(0.6 + 1e-9);
    // Back is on the right (+x) for rotation 90: the head board sits at the right end.
    expect(head.centre[0]).toBeGreaterThan(1.9);
    expect(head.centre[2]).toBeCloseTo(2);
    expect(head.turn).toBe(90);
  });

  it('puts the head of an unturned bed at the top of the plan (smaller z)', () => {
    const boxes = furnished({ type: 'bed', rotation: 0, width: 1.6, depth: 2, height: 0.6 }).furniture[0]!.boxes;
    expect(boxes[1]!.centre[2]).toBeLessThan(2 - 0.9);
    expect(boxes[1]!.centre[0]).toBeCloseTo(1);
  });

  it('makes a sofa a seat and a back on its back side', () => {
    const boxes = furnished({ type: 'sofa', rotation: 180, width: 2, depth: 0.9, height: 0.85 }).furniture[0]!.boxes;
    expect(boxes).toHaveLength(2);
    const [seat, back] = boxes as [(typeof boxes)[number], (typeof boxes)[number]];
    expect(seat.size).toEqual([2, expect.closeTo(0.425), 0.9]);
    expect(back.size[1]).toBeCloseTo(0.85);
    expect(back.size[0]).toBe(2);
    // Back at the bottom of the plan for rotation 180: larger z.
    expect(back.centre[2]).toBeGreaterThan(2 + 0.3);
  });

  it.each(['dining-table', 'desk'])('makes a %s a top plus four legs', (type) => {
    const boxes = furnished({ type, width: 1.4, depth: 0.7, height: 0.75 }).furniture[0]!.boxes;
    expect(boxes).toHaveLength(5);
    const top = boxes[0]!;
    expect(top.size[0]).toBe(1.4);
    expect(top.size[2]).toBe(0.7);
    expect(top.centre[1] + top.size[1] / 2).toBeCloseTo(0.75);
    const legs = boxes.slice(1);
    for (const leg of legs) {
      expect(leg.centre[1] + leg.size[1] / 2).toBeCloseTo(top.centre[1] - top.size[1] / 2);
      expect(leg.centre[1] - leg.size[1] / 2).toBeCloseTo(0);
    }
    const corners = new Set(legs.map((l) => `${Math.sign(l.centre[0] - 1)},${Math.sign(l.centre[2] - 2)}`));
    expect(corners.size).toBe(4);
  });

  it('makes a tv a console plus a screen box', () => {
    const boxes = furnished({ type: 'tv', width: 1.4, depth: 0.4, height: 0.8 }).furniture[0]!.boxes;
    expect(boxes.map((b) => b.part)).toEqual(['body', 'screen']);
    expect(boxes[1]!.centre[1] - boxes[1]!.size[1] / 2).toBeCloseTo(boxes[0]!.size[1]);
    expect(boxes[1]!.centre[1] + boxes[1]!.size[1] / 2).toBeCloseTo(0.8);
  });

  it('moves the legs of a turned table with the table', () => {
    const boxes = furnished({ type: 'desk', rotation: 90, width: 2, depth: 0.5, height: 0.75 }).furniture[0]!.boxes;
    // Turned 90 degrees the table is long along z.
    const zs = boxes.slice(1).map((b) => b.centre[2]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(1.5);
    expect(boxes.every((b) => b.turn === 90)).toBe(true);
  });

  it('keeps the room id or null', () => {
    expect(furnished({ type: 'wc', roomId: null }).furniture[0]?.roomId).toBeNull();
  });

  it('leaves out a furniture item that fails the server rules and builds the rest', () => {
    const good = { id: 'ok', type: 'wardrobe', roomId: null, x: 100, y: 100, rotation: 0, width: 1, depth: 1, height: 1, builtIn: false };
    const bad = [
      { ...good, id: 'rot', rotation: 45 },
      { ...good, id: 'neg', width: -1 },
      { ...good, id: 'zero', height: 0 },
      { ...good, id: 'inf', x: Infinity },
      { ...good, id: 'str', y: '3' },
      { ...good, id: 'notype', type: 3 },
      { ...good, id: 5 },
      null,
      'text',
    ];
    const m = model(level({ rooms: [room()], walls: [], openings: [] }, [bad[0], good, ...bad.slice(1), { ...good, id: 'ok2' }]));
    expect(m.furniture.map((f) => f.id)).toEqual(['ok', 'ok2']);
  });

  it('treats furniture that is not a list as none', () => {
    expect(model(level({ rooms: [room()], walls: [], openings: [] }, { a: 1 })).furniture).toEqual([]);
    expect(model(level({ rooms: [room()], walls: [], openings: [] }, 'x')).furniture).toEqual([]);
    expect(model(level({ rooms: [room()], walls: [], openings: [] })).furniture).toEqual([]);
  });
});

const fixtureLevel = (pkg: unknown): HomeLevel => structuredClone((pkg as HomePackage).levels[0] as HomeLevel);

/** Whether a wall of the given kind occupies the point (x, z) at height y. */
function occupied(walls: WallPiece[], kind: WallPiece['kind'], x: number, z: number, y: number): boolean {
  return walls.some((w) => {
    if (w.kind !== kind || y < w.y0 || y > w.y1) return false;
    const dx = w.to[0] - w.from[0];
    const dz = w.to[1] - w.from[1];
    const len = Math.hypot(dx, dz);
    const t = ((x - w.from[0]) * dx + (z - w.from[1]) * dz) / len;
    const side = Math.abs(((x - w.from[0]) * dz - (z - w.from[1]) * dx) / len);
    return t >= 0 && t <= len && side <= w.thickness / 2;
  });
}

describe('buildThreeModel: the sample house', () => {
  const l = fixtureLevel(fixture3d);
  const m = model(l);
  const scale = l.rooms!.scale;

  it('has five rooms, eight pieces of furniture and no devices yet', () => {
    expect(m.rooms.map((x) => x.name)).toEqual(['Living', 'Kitchen', 'Bedroom', 'Bathroom', 'Study']);
    expect(m.furniture.map((f) => f.type).sort()).toEqual(
      ['bed', 'desk', 'dining-table', 'kitchen-counter', 'sofa', 'tv', 'wardrobe', 'wc'],
    );
    expect(m.devices).toEqual([]);
    expect(m.key).toBe('level-1|plan-1-sh@4,plan-1-lt@2');
  });

  it('is about 10 by 8.4 metres', () => {
    expect(m.bounds.minX).toBeCloseTo(80 * scale);
    expect(m.bounds.maxX).toBeCloseTo(920 * scale);
    expect(m.bounds.minZ).toBeCloseTo(100 * scale);
    expect(m.bounds.maxZ).toBeCloseTo(800 * scale);
  });

  it('opens every door and window of the layer', () => {
    for (const o of l.rooms!.openings) {
      const x = ((o.from[0] + o.to[0]) / 2) * scale;
      const z = ((o.from[1] + o.to[1]) / 2) * scale;
      if (o.type === 'door') {
        expect(occupied(m.walls, 'wall', x, z, 1)).toBe(false);
        expect(occupied(m.walls, 'wall', x, z, 2.4)).toBe(true);
      } else {
        expect(occupied(m.walls, 'wall', x, z, 0.5)).toBe(true);
        expect(occupied(m.walls, 'glass', x, z, 1.5)).toBe(true);
        expect(occupied(m.walls, 'wall', x, z, 1.5)).toBe(false);
      }
    }
  });

  it('puts every furniture box inside the bounds', () => {
    for (const f of m.furniture) {
      for (const b of f.boxes) {
        expect(b.centre[0]).toBeGreaterThan(m.bounds.minX);
        expect(b.centre[0]).toBeLessThan(m.bounds.maxX);
        expect(b.centre[2]).toBeGreaterThan(m.bounds.minZ);
        expect(b.centre[2]).toBeLessThan(m.bounds.maxZ);
      }
    }
  });
});

describe('buildThreeModel: the rooms fixture', () => {
  it('builds from the Task 2 fixture', () => {
    const m = model(fixtureLevel(roomsFixture));
    expect(m.rooms.map((x) => x.id)).toEqual(['room-living', 'room-bedroom']);
    expect(m.furniture.map((f) => f.id)).toEqual(['wardrobe1', 'bed1']);
    expect(m.wallHeight).toBe(2.6);
  });
});
