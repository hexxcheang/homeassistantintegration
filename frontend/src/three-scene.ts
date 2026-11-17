import { usableRooms } from './rooms-layer.ts';
import type { Box3, FurnitureBlock, ThreeModel, ThreeRoom, V2, V3, WallPiece } from './three-api.ts';
import type { HomeFurniture, HomeLevel, HomeRooms } from './types.ts';

/** No three.js here: this turns a level into plain numbers in metres. */

const DEFAULT_WALL_HEIGHT = 2.6;
const DOOR_HEIGHT = 2.1;
const WINDOW_SILL = 0.9;
const WINDOW_HEIGHT = 1.2;
/** How far past the wall's edge an opening may sit and still belong to the wall (metres). */
const OPENING_REACH = 0.05;
/** Anything shorter than this (metres) is no piece at all. */
const EPSILON = 1e-6;

type Opening = HomeRooms['openings'][number];

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

// ---------------------------------------------------------------- walls

interface Gap {
  t0: number;
  t1: number;
  y0: number;
  y1: number;
  type: Opening['type'];
}

/** The part of an opening that cuts this wall, or undefined when it is not on the wall. */
function gapIn(opening: Opening, from: V2, dir: V2, length: number, thickness: number, scale: number, wallHeight: number): Gap | undefined {
  const reach = thickness / 2 + OPENING_REACH;
  const along: number[] = [];
  for (const point of [opening.from, opening.to]) {
    const px = point[0] * scale - from[0];
    const pz = point[1] * scale - from[1];
    if (Math.abs(px * dir[1] - pz * dir[0]) > reach) return undefined;
    along.push(px * dir[0] + pz * dir[1]);
  }
  const t0 = Math.max(0, Math.min(...along));
  const t1 = Math.min(length, Math.max(...along));
  const isDoor = opening.type === 'door';
  const y0 = opening.sill ?? (isDoor ? 0 : WINDOW_SILL);
  const y1 = Math.min(wallHeight, y0 + (opening.height ?? (isDoor ? DOOR_HEIGHT : WINDOW_HEIGHT)));
  if (t1 - t0 < EPSILON || y1 - y0 < EPSILON) return undefined;
  return { t0, t1, y0, y1, type: opening.type };
}

function wallPieces(
  wall: HomeRooms['walls'][number],
  openings: Opening[],
  scale: number,
  wallHeight: number,
): WallPiece[] {
  const from: V2 = [wall.from[0] * scale, wall.from[1] * scale];
  const to: V2 = [wall.to[0] * scale, wall.to[1] * scale];
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (length < EPSILON) return [];
  const dir: V2 = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  const gaps = openings
    .map((o) => gapIn(o, from, dir, length, wall.thickness, scale, wallHeight))
    .filter((g): g is Gap => g !== undefined);

  const at = (t: number): V2 => [round(from[0] + dir[0] * t), round(from[1] + dir[1] * t)];
  const piece = (a: number, b: number, y0: number, y1: number, kind: WallPiece['kind']): WallPiece => ({
    from: at(a),
    to: at(b),
    thickness: wall.thickness,
    y0: round(y0),
    y1: round(y1),
    kind,
  });

  // Cut the wall at every opening edge, then decide each stretch from the openings covering it.
  const cuts = [...new Set([0, length, ...gaps.flatMap((g) => [g.t0, g.t1])])].sort((a, b) => a - b);
  const out: WallPiece[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    if (b - a < EPSILON) continue;
    const middle = (a + b) / 2;
    const here = gaps.filter((g) => g.t0 <= middle && middle <= g.t1);
    const levels = [...new Set([0, wallHeight, ...here.flatMap((g) => [g.y0, g.y1])])].sort((p, q) => p - q);
    const stack: { y0: number; y1: number; kind: WallPiece['kind'] | 'open' }[] = [];
    for (let j = 0; j + 1 < levels.length; j++) {
      const y0 = levels[j]!;
      const y1 = levels[j + 1]!;
      if (y1 - y0 < EPSILON) continue;
      const covering = here.filter((g) => g.y0 <= (y0 + y1) / 2 && (y0 + y1) / 2 <= g.y1);
      const kind = covering.length === 0 ? 'wall' : covering.some((g) => g.type === 'door') ? 'open' : 'glass';
      const last = stack[stack.length - 1];
      if (last && last.kind === kind) last.y1 = y1;
      else stack.push({ y0, y1, kind });
    }
    for (const s of stack) if (s.kind !== 'open') out.push(piece(a, b, s.y0, s.y1, s.kind));
  }
  return out;
}

// ---------------------------------------------------------------- rooms

function pointInPolygon(p: V2, polygon: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToEdges(p: V2, polygon: V2[]): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[j]!;
    const [bx, bz] = polygon[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / len2));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (az + t * dz)));
  }
  return best;
}

/** The area centroid when it lies inside; otherwise the inside point farthest from every edge. */
function centreOf(polygon: V2[]): V2 {
  let area = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[j]!;
    const [bx, bz] = polygon[i]!;
    const cross = ax * bz - bx * az;
    area += cross;
    cx += (ax + bx) * cross;
    cz += (az + bz) * cross;
  }
  if (Math.abs(area) > EPSILON) {
    const centroid: V2 = [cx / (3 * area), cz / (3 * area)];
    if (pointInPolygon(centroid, polygon)) return [round(centroid[0]), round(centroid[1])];
  }
  const xs = polygon.map((p) => p[0]);
  const zs = polygon.map((p) => p[1]);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const steps = 40;
  let best: V2 = polygon[0]!;
  let bestDistance = -1;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const p: V2 = [minX + ((maxX - minX) * i) / steps, minZ + ((maxZ - minZ) * j) / steps];
      if (!pointInPolygon(p, polygon)) continue;
      const d = distanceToEdges(p, polygon);
      if (d > bestDistance) {
        bestDistance = d;
        best = p;
      }
    }
  }
  return [round(best[0]), round(best[1])];
}

function buildRooms(layer: HomeRooms): ThreeRoom[] {
  const ids = new Set(layer.rooms.map((r) => r.id));
  return layer.rooms.map((r) => {
    const polygon = r.polygon.map((p): V2 => [round(p[0] * layer.scale), round(p[1] * layer.scale)]);
    const room: ThreeRoom = { id: r.id, name: r.name, polygon, centre: centreOf(polygon) };
    // A piece of another room in this level; anything else leaves the room standing on its own.
    if (typeof r.partOf === 'string' && r.partOf !== r.id && ids.has(r.partOf)) room.partOf = r.partOf;
    return room;
  });
}

// ---------------------------------------------------------------- furniture

/** The server's furniture rules (`_furniture_item_ok` in package.py). */
function furnitureOk(item: unknown): item is HomeFurniture {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
  const f = item as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return (
    typeof f['id'] === 'string' &&
    typeof f['type'] === 'string' &&
    finite(f['x']) &&
    finite(f['y']) &&
    [0, 90, 180, 270].includes(f['rotation'] as number) &&
    ['width', 'depth', 'height'].every((key) => finite(f[key]) && (f[key] as number) > 0)
  );
}

const LEG = 0.06;
const TOP = 0.05;
const BOARD = 0.1;

/** Boxes of one piece of furniture. Offsets are along the piece (`across`) and from its centre towards the front (`front`). */
function furnitureBoxes(item: HomeFurniture, scale: number): Box3[] {
  const { width, depth, height } = item;
  const turn = item.rotation;
  const rad = (turn * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  const x = item.x * scale;
  const z = item.y * scale;
  const box = (across: number, front: number, y0: number, y1: number, w: number, d: number, part: Box3['part'] = 'body'): Box3 => ({
    centre: [round(x + across * cos - front * sin), round((y0 + y1) / 2), round(z + across * sin + front * cos)] as V3,
    size: [round(w), round(y1 - y0), round(d)] as V3,
    turn,
    part,
  });
  const type = item.type.toLowerCase();
  const back = -depth / 2;

  if (type === 'bed') {
    const mattress = height * 0.55;
    return [box(0, 0, 0, mattress, width, depth), box(0, back + BOARD / 2, 0, height, width, BOARD)];
  }
  if (type === 'sofa') {
    const seat = height * 0.5;
    const rest = Math.min(0.2, depth / 3);
    return [box(0, 0, 0, seat, width, depth), box(0, back + rest / 2, 0, height, width, rest)];
  }
  if (type.includes('table') || type === 'desk') {
    const underside = Math.max(height - TOP, 0);
    const legs: Box3[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        legs.push(box(sx * (width / 2 - LEG / 2), sz * (depth / 2 - LEG / 2), 0, underside, LEG, LEG));
      }
    }
    return [box(0, 0, underside, height, width, depth), ...legs];
  }
  if (type === 'tv') {
    const stand = height * 0.5;
    return [box(0, 0, 0, stand, width, depth), box(0, back + 0.04, stand, height, width, 0.06, 'screen')];
  }
  return [box(0, 0, 0, height, width, depth)];
}

function buildFurniture(level: HomeLevel, scale: number): FurnitureBlock[] {
  const list: unknown = level.furniture;
  if (!Array.isArray(list)) return [];
  return list.filter(furnitureOk).map((item) => ({
    id: item.id,
    type: item.type,
    roomId: typeof item.roomId === 'string' ? item.roomId : null,
    boxes: furnitureBoxes(item, scale),
  }));
}

// ---------------------------------------------------------------- the model

/** The house of one level, or undefined when the level has no usable rooms layer. */
export function buildThreeModel(level: HomeLevel): ThreeModel | undefined {
  const layer = usableRooms(level);
  if (!layer) return undefined;
  const wallHeight = layer.wallHeight ?? DEFAULT_WALL_HEIGHT;
  const rooms = buildRooms(layer);
  const walls = layer.walls.flatMap((w) => wallPieces(w, layer.openings, layer.scale, wallHeight));

  const points: V2[] = [
    ...rooms.flatMap((r) => r.polygon),
    ...layer.walls.flatMap((w): V2[] => [
      [w.from[0] * layer.scale, w.from[1] * layer.scale],
      [w.to[0] * layer.scale, w.to[1] * layer.scale],
    ]),
  ];
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const bounds = points.length
    ? { minX: round(Math.min(...xs)), minZ: round(Math.min(...zs)), maxX: round(Math.max(...xs)), maxZ: round(Math.max(...zs)) }
    : { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };

  return {
    key: `${level.id}|${level.plans.map((p) => `${p.id}@${p.revision}`).join(',')}`,
    wallHeight,
    bounds,
    rooms,
    walls,
    furniture: buildFurniture(level, layer.scale),
    devices: [],
  };
}
