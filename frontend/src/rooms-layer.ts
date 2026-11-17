import type { HomeLevel, HomeRooms } from './types.ts';

/**
 * The rules the server applies to a level's rooms layer (`_rooms_layer_ok` in package.py), so that
 * the 3D view is only offered for a layer the server would have kept. Keep the two in step.
 */
const MAX_ROOMS = 200;
const MAX_WALLS = 2000;
const MAX_OPENINGS = 1000;

/** A finite number; booleans, NaN and infinity are not. */
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isPoint = (value: unknown): boolean => Array.isArray(value) && value.length === 2 && value.every(isNumber);
const listWithin = (value: unknown, limit: number): value is unknown[] => Array.isArray(value) && value.length <= limit;

function roomOk(room: unknown): boolean {
  if (!isObject(room) || typeof room['id'] !== 'string' || typeof room['name'] !== 'string') return false;
  const polygon = room['polygon'];
  return Array.isArray(polygon) && polygon.length >= 3 && polygon.every(isPoint);
}

function wallOk(wall: unknown): boolean {
  if (!isObject(wall) || !isPoint(wall['from']) || !isPoint(wall['to'])) return false;
  const thickness = wall['thickness'];
  return isNumber(thickness) && thickness > 0 && thickness <= 2;
}

function openingOk(opening: unknown): boolean {
  if (!isObject(opening)) return false;
  if (opening['type'] !== 'door' && opening['type'] !== 'window') return false;
  if (!isPoint(opening['from']) || !isPoint(opening['to'])) return false;
  return ['sill', 'height'].every((key) => !(key in opening) || (isNumber(opening[key]) && (opening[key] as number) >= 0));
}

function roomsOk(layer: unknown): layer is HomeRooms {
  if (!isObject(layer)) return false;
  if (!isNumber(layer['scale']) || layer['scale'] <= 0) return false;
  if ('wallHeight' in layer) {
    const height = layer['wallHeight'];
    if (!isNumber(height) || height <= 0 || height > 10) return false;
  }
  if ('mounts' in layer && !isObject(layer['mounts'])) return false;
  const checks: [string, number, (item: unknown) => boolean][] = [
    ['rooms', MAX_ROOMS, roomOk],
    ['walls', MAX_WALLS, wallOk],
    ['openings', MAX_OPENINGS, openingOk],
  ];
  return checks.every(([key, limit, check]) => {
    const items = layer[key];
    return listWithin(items, limit) && items.every(check);
  });
}

/** The level's rooms layer when 3D can use it, otherwise `undefined`. Furniture is not judged here. */
export function usableRooms(level: HomeLevel): HomeRooms | undefined {
  return roomsOk(level.rooms) ? level.rooms : undefined;
}
