import { describe, expect, it } from 'vitest';
import roomsFixture from '../../tests/fixtures/home-v1-rooms.json';
import { usableRooms } from '../src/rooms-layer.ts';
import type { HomeLevel, HomePackage } from '../src/types.ts';

const fixtureLevel = (): HomeLevel =>
  structuredClone((roomsFixture as unknown as HomePackage).levels[0] as HomeLevel);

/** Set one value inside the level, as the Python tests do. */
function mutate(path: (string | number)[], value: unknown): HomeLevel {
  const level = fixtureLevel();
  let target: any = level;
  for (const key of path.slice(0, -1)) target = target[key];
  target[path[path.length - 1] as string | number] = value;
  return level;
}

const rooms = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: 'R', polygon: [[0, 0], [1, 0], [1, 1]] }));

describe('usableRooms', () => {
  it('returns the rooms layer of the fixture level', () => {
    const level = fixtureLevel();
    expect(usableRooms(level)).toBe(level.rooms);
    expect(usableRooms(level)?.rooms.map((r) => r.id)).toEqual(['room-living', 'room-bedroom']);
  });

  it('is undefined for a level without a rooms layer', () => {
    const level = fixtureLevel();
    delete level.rooms;
    expect(usableRooms(level)).toBeUndefined();
  });

  it('accepts a layer without wall height or mounts', () => {
    const level = fixtureLevel();
    delete (level.rooms as { wallHeight?: number }).wallHeight;
    expect(usableRooms(level)).toBeDefined();
    (level.rooms as { mounts?: unknown }).mounts = { a: { height: 2 } };
    expect(usableRooms(level)).toBeDefined();
  });

  it('does not judge furniture', () => {
    const level = mutate(['furniture', 0, 'rotation'], 45);
    expect(usableRooms(level)).toBeDefined();
  });

  const bad: Record<string, [(string | number)[], unknown]> = {
    'scale zero': [['rooms', 'scale'], 0],
    'scale text': [['rooms', 'scale'], 'x'],
    'scale bool': [['rooms', 'scale'], true],
    'scale NaN': [['rooms', 'scale'], NaN],
    'wall height too tall': [['rooms', 'wallHeight'], 11],
    'wall height zero': [['rooms', 'wallHeight'], 0],
    'polygon with two points': [['rooms', 'rooms', 0, 'polygon'], [[0, 0], [1, 1]]],
    'wall from with one number': [['rooms', 'walls', 0, 'from'], [1]],
    'infinite coordinate': [['rooms', 'walls', 0, 'from'], [Infinity, 0]],
    'nan coordinate': [['rooms', 'walls', 0, 'to'], [NaN, 0]],
    'boolean coordinate': [['rooms', 'walls', 0, 'to'], [true, 0]],
    'wall too thick': [['rooms', 'walls', 0, 'thickness'], 3],
    'wall thickness zero': [['rooms', 'walls', 0, 'thickness'], 0],
    'opening type hatch': [['rooms', 'openings', 0, 'type'], 'hatch'],
    'opening negative sill': [['rooms', 'openings', 0, 'sill'], -1],
    'opening height text': [['rooms', 'openings', 0, 'height'], '2'],
    'room id not text': [['rooms', 'rooms', 0, 'id'], 5],
    'mounts not an object': [['rooms', 'mounts'], []],
    'rooms not an object': [['rooms'], []],
    '201 rooms': [['rooms', 'rooms'], rooms(201)],
    '2001 walls': [['rooms', 'walls'], Array.from({ length: 2001 }, () => ({ from: [0, 0], to: [1, 0], thickness: 0.2 }))],
    '1001 openings': [['rooms', 'openings'], Array.from({ length: 1001 }, () => ({ type: 'door', from: [0, 0], to: [1, 0] }))],
  };
  for (const [name, [path, value]] of Object.entries(bad)) {
    it(`is undefined for: ${name}`, () => {
      expect(usableRooms(mutate(path, value))).toBeUndefined();
    });
  }

  it('accepts the limits themselves', () => {
    expect(usableRooms(mutate(['rooms', 'rooms'], rooms(200)))).toBeDefined();
    expect(usableRooms(mutate(['rooms', 'wallHeight'], 10))).toBeDefined();
    expect(usableRooms(mutate(['rooms', 'walls', 0, 'thickness'], 2))).toBeDefined();
  });
});
