import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeHass, type FakeHass } from '../preview/fake-hass.ts';
import { PackageProblem, parseHomeFile } from '../preview/validate-package.ts';
import type {
  ChangedElement,
  HomePackage,
  HomeResponse,
  Link,
  QuickItem,
  RefreshSummary,
} from '../src/types.ts';
import { home } from './helpers.ts';

const ENTRY = 'preview-entry';
const admin = { admin: true, installerMode: true };

const fresh = (): HomePackage => structuredClone(home);
const ws = <T>(fake: FakeHass, message: { type: string; [key: string]: unknown }): Promise<T> =>
  fake.callWS<T>({ entry_id: ENTRY, ...message });
const getHome = (fake: FakeHass): Promise<HomeResponse> => ws(fake, { type: 'maxsen/home' });
const ids = (list: ChangedElement[]): string[] => list.map((e) => e.id).sort();

/** The fixture with element `sw1` (3-gang switch) and `dl1` removed and a new downlight added. */
function changedPackage(): HomePackage {
  const pkg = fresh();
  const level1 = pkg.levels[0]!;
  const smart = level1.plans.find((p) => p.type === 'smart-home')!;
  const lighting = level1.plans.find((p) => p.type === 'lighting')!;
  smart.elements = smart.elements.filter((e) => e.id !== 'sw1');
  lighting.elements = lighting.elements.filter((e) => e.id !== 'dl1');
  lighting.elements.push({ ...lighting.elements[0]!, id: 'dl9', label: 'Porch light' });
  lighting.revision += 1;
  return pkg;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createFakeHass: devices and entities', () => {
  it('links every element to something that exists in the fake home', async () => {
    const fake = createFakeHass(fresh(), admin);
    const { links } = await getHome(fake);
    const elements = fresh().levels.flatMap((l) => l.plans.flatMap((p) => p.elements));
    expect(elements.length).toBeGreaterThan(0);
    for (const el of elements) {
      const link = links[el.id];
      expect(link, el.id).toBeDefined();
      if (link!.type === 'entity') {
        expect(fake.states[link!.id], el.id).toBeDefined();
      } else {
        expect(fake.devices[link!.id], el.id).toBeDefined();
        const owned = Object.values(fake.entities).filter((e) => e.device_id === link!.id);
        expect(owned.length, el.id).toBeGreaterThan(0);
        for (const e of owned) expect(fake.states[e.entity_id]).toBeDefined();
      }
    }
  });

  it('links lighting to entities and everything else to devices', async () => {
    const { links } = await getHome(createFakeHass(fresh(), admin));
    expect(links['dl1']?.type).toBe('entity');
    expect(links['led1']?.type).toBe('entity');
    expect(links['sw1']?.type).toBe('device');
    expect(links['cur1']?.type).toBe('device');
    expect(links['sen1']?.type).toBe('device');
  });

  it('gives each category the entities it would have, with readable names', () => {
    const fake = createFakeHass(fresh(), admin);
    // 3-gang switch labelled "Entrance switch"
    for (const n of [1, 2, 3]) {
      expect(fake.states[`switch.entrance_switch_${n}`]?.attributes['friendly_name']).toBe(
        `Entrance switch ${n}`,
      );
    }
    expect(fake.states['switch.entrance_switch_4']).toBeUndefined();
    // curtain track without a label is named after its product
    expect(fake.states['cover.smart_curtain_track']?.attributes['friendly_name']).toBe(
      'Smart Curtain Track',
    );
    // door sensor: door contact plus temperature; motion sensor: motion plus temperature
    const door = fake.states['binary_sensor.door_window_sensor_door'];
    expect(door?.attributes['device_class']).toBe('door');
    expect(fake.states['sensor.door_window_sensor_temperature']?.attributes['unit_of_measurement']).toBe(
      '°C',
    );
    expect(fake.states['binary_sensor.motion_sensor_motion']?.attributes['device_class']).toBe('motion');
  });

  it('names areas after levels and puts devices in them', () => {
    const fake = createFakeHass(fresh(), admin);
    expect(Object.values(fake.areas).map((a) => a.name).sort()).toEqual(['Level 1', 'Level 2']);
    const device = Object.values(fake.devices).find((d) => d.name === 'Entrance switch')!;
    expect(fake.areas[device.area_id!]?.name).toBe('Level 1');
  });

  it('makes one lighting switch per 4 lighting elements on the same plan', async () => {
    const pkg = fresh();
    const lighting = pkg.levels[0]!.plans.find((p) => p.type === 'lighting')!;
    // 4 existing elements + 1 more = 5, so 2 gangs: elements 1-4 share one, element 5 has its own
    lighting.elements.push({ ...lighting.elements[0]!, id: 'dl5' });
    const fake = createFakeHass(pkg, admin);
    const { links } = await getHome(fake);
    const gangOf = (id: string): string => links[id]!.id;
    expect(new Set(['dl1', 'dl2', 'dl3', 'led1'].map(gangOf)).size).toBe(1);
    expect(gangOf('dl5')).not.toBe(gangOf('dl1'));
    expect(gangOf('dl1')).toMatch(/^switch\.level_1_lighting_\d$/);
    expect(fake.states[gangOf('dl1')]?.attributes['friendly_name']).toMatch(/^Level 1 lighting \d$/);
  });
});

describe('createFakeHass: services', () => {
  it('toggle flips the state and notifies a subscriber', async () => {
    const fake = createFakeHass(fresh(), admin);
    const listener = vi.fn();
    fake.onChange(listener);
    const before = fake.states['switch.entrance_switch_2']!.state;
    await fake.callService('homeassistant', 'toggle', { entity_id: ['switch.entrance_switch_2'] });
    expect(fake.states['switch.entrance_switch_2']!.state).toBe(before === 'on' ? 'off' : 'on');
    expect(listener).toHaveBeenCalledTimes(1);
    await fake.callService('homeassistant', 'toggle', { entity_id: 'switch.entrance_switch_2' });
    expect(fake.states['switch.entrance_switch_2']!.state).toBe(before);
  });

  it('replaces the states object on change, as Home Assistant does', async () => {
    const fake = createFakeHass(fresh(), admin);
    const states = fake.states;
    await fake.callService('homeassistant', 'turn_off', { entity_id: 'switch.entrance_switch_1' });
    expect(fake.states).not.toBe(states);
    expect(states['switch.entrance_switch_1']!.state).toBe('on');
    expect(fake.states['switch.entrance_switch_1']!.state).toBe('off');
  });

  it('opens and closes covers, and accepts targets', async () => {
    const fake = createFakeHass(fresh(), admin);
    await fake.callService('cover', 'close_cover', {}, { entity_id: 'cover.smart_curtain_track' });
    expect(fake.states['cover.smart_curtain_track']!.state).toBe('closed');
    expect(fake.states['cover.smart_curtain_track']!.attributes['current_position']).toBe(0);
    await fake.callService('cover', 'open_cover', { entity_id: 'cover.smart_curtain_track' });
    expect(fake.states['cover.smart_curtain_track']!.state).toBe('open');
    expect(fake.states['cover.smart_curtain_track']!.attributes['current_position']).toBe(100);
  });

  it('rejects a service it does not know', async () => {
    const fake = createFakeHass(fresh(), admin);
    await expect(fake.callService('vacuum', 'start', {})).rejects.toMatchObject({
      code: 'service_not_found',
    });
  });

  it('flips door sensors every 20 seconds while the simulation runs', () => {
    vi.useFakeTimers();
    const fake = createFakeHass(fresh(), admin);
    const listener = vi.fn();
    fake.onChange(listener);
    const stop = fake.startSimulation();
    const door = 'binary_sensor.door_window_sensor_door';
    expect(fake.states[door]!.state).toBe('off');
    vi.advanceTimersByTime(20_000);
    expect(fake.states[door]!.state).toBe('on');
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(fake.states[door]!.state).toBe('off');
    stop();
    vi.advanceTimersByTime(60_000);
    expect(fake.states[door]!.state).toBe('off');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('createFakeHass: websocket', () => {
  it('answers config_entries/get with one loaded maxsen entry', async () => {
    const fake = createFakeHass(fresh(), admin);
    const entries = await fake.callWS<{ entry_id: string; state: string; domain: string }[]>({
      type: 'config_entries/get',
      domain: 'maxsen',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entry_id: ENTRY, state: 'loaded', domain: 'maxsen' });
    expect(await fake.callWS({ type: 'config_entries/get', domain: 'hue' })).toEqual([]);
  });

  it('answers maxsen/home with the integration shape: no image data, urls instead', async () => {
    const response = await getHome(createFakeHass(fresh(), { admin: true, installerMode: false }));
    expect(response.installer_mode).toBe(false);
    expect(response.quick_panel).toEqual([]);
    expect(response.package).not.toBeNull();
    expect(response.package).not.toHaveProperty('images');
    expect(response.package!.image_types).toEqual({
      'file-l1': 'image/png',
      'file-l2': 'image/png',
    });
    expect(response.image_urls).toEqual({
      'file-l1': `/api/maxsen/image/${ENTRY}/file-l1`,
      'file-l2': `/api/maxsen/image/${ENTRY}/file-l2`,
    });
  });

  it('rejects an unknown home and an unknown command', async () => {
    const fake = createFakeHass(fresh(), admin);
    await expect(fake.callWS({ type: 'maxsen/home', entry_id: 'nope' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(fake.callWS({ type: 'maxsen/bogus', entry_id: ENTRY })).rejects.toMatchObject({
      code: 'unknown_command',
    });
  });

  it('maxsen/quick_panel/set returns and keeps the new list, for any user', async () => {
    const fake = createFakeHass(fresh(), { admin: false, installerMode: false });
    const items: QuickItem[] = [
      { type: 'element', id: 'sw1' },
      { type: 'entity', id: 'switch.entrance_switch_1' },
    ];
    const result = await ws<{ quick_panel: QuickItem[] }>(fake, {
      type: 'maxsen/quick_panel/set',
      items,
    });
    expect(result).toEqual({ quick_panel: items });
    expect((await getHome(fake)).quick_panel).toEqual(items);
    await expect(
      ws(fake, { type: 'maxsen/quick_panel/set', items: [{ type: 'bogus', id: 'x' }] }),
    ).rejects.toMatchObject({ code: 'invalid_format' });
  });

  it('maxsen/links/set rejects with not_allowed unless admin and installer mode', async () => {
    const link: Link = { type: 'entity', id: 'switch.entrance_switch_1' };
    for (const opts of [
      { admin: false, installerMode: true },
      { admin: true, installerMode: false },
    ]) {
      const fake = createFakeHass(fresh(), opts);
      await expect(
        ws(fake, { type: 'maxsen/links/set', updates: { dl1: link } }),
      ).rejects.toMatchObject({ code: 'not_allowed' });
      expect((await getHome(fake)).links['dl1']).not.toEqual(link);
    }
  });

  it('maxsen/links/set links, unlinks and checks element ids', async () => {
    const fake = createFakeHass(fresh(), admin);
    const link: Link = { type: 'entity', id: 'switch.entrance_switch_1' };
    const result = await ws<{ links: Record<string, Link> }>(fake, {
      type: 'maxsen/links/set',
      updates: { dl1: link, sen1: null },
    });
    expect(result.links['dl1']).toEqual(link);
    expect(result.links).not.toHaveProperty('sen1');
    await expect(
      ws(fake, { type: 'maxsen/links/set', updates: { nope: link } }),
    ).rejects.toMatchObject({ code: 'invalid_element' });
  });

  it('follows admin and installer mode changes live', async () => {
    const fake = createFakeHass(fresh(), { admin: true, installerMode: false });
    const events: string[] = [];
    await fake.connection.subscribeMessage<{ event: string }>((m) => events.push(m.event), {
      type: 'maxsen/subscribe',
      entry_id: ENTRY,
    });
    expect(fake.user.is_admin).toBe(true);
    fake.setInstallerMode(true);
    expect((await getHome(fake)).installer_mode).toBe(true);
    expect(events).toEqual(['home']);
    fake.setAdmin(false);
    expect(fake.user.is_admin).toBe(false);
    await expect(ws(fake, { type: 'maxsen/links/set', updates: {} })).rejects.toMatchObject({
      code: 'not_allowed',
    });
  });

  it('tells subscribers what changed, until they unsubscribe', async () => {
    const fake = createFakeHass(fresh(), admin);
    const events: string[] = [];
    const stop = await fake.connection.subscribeMessage<{ event: string }>(
      (m) => events.push(m.event),
      { type: 'maxsen/subscribe', entry_id: ENTRY },
    );
    await ws(fake, { type: 'maxsen/links/set', updates: { sen1: null } });
    await ws(fake, { type: 'maxsen/quick_panel/set', items: [] });
    expect(events).toEqual(['links', 'quick_panel']);
    stop();
    await ws(fake, { type: 'maxsen/quick_panel/set', items: [] });
    expect(events).toHaveLength(2);
  });

  it('refuses to subscribe to something else', async () => {
    const fake = createFakeHass(fresh(), admin);
    await expect(
      fake.connection.subscribeMessage(() => undefined, { type: 'other/thing' }),
    ).rejects.toMatchObject({ code: 'unknown_command' });
  });
});

describe('createFakeHass: images', () => {
  it('serves the package background from its embedded base64', async () => {
    const fake = createFakeHass(fresh(), admin);
    const response = await fake.fetchWithAuth(`/api/maxsen/image/${ENTRY}/file-l1`);
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await response.arrayBuffer());
    // PNG signature
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('answers 404 for anything else', async () => {
    const fake = createFakeHass(fresh(), admin);
    expect((await fake.fetchWithAuth(`/api/maxsen/image/${ENTRY}/missing`)).status).toBe(404);
    expect((await fake.fetchWithAuth('/api/maxsen/image/other/file-l1')).status).toBe(404);
    expect((await fake.fetchWithAuth('/somewhere/else')).status).toBe(404);
  });
});

describe('createFakeHass: opening another home', () => {
  it('replaces everything and tells subscribers the home changed', async () => {
    const fake = createFakeHass(fresh(), admin);
    const events: string[] = [];
    await fake.connection.subscribeMessage<{ event: string }>((m) => events.push(m.event), {
      type: 'maxsen/subscribe',
      entry_id: ENTRY,
    });
    await ws(fake, { type: 'maxsen/quick_panel/set', items: [{ type: 'element', id: 'sw1' }] });
    const other = changedPackage();
    other.project = { id: 'p2', title: 'Another House' };
    fake.openHome(other);
    const response = await getHome(fake);
    expect(response.package!.project.title).toBe('Another House');
    expect(response.quick_panel).toEqual([]);
    expect(response.links).not.toHaveProperty('sw1');
    expect(response.links).toHaveProperty('dl9');
    expect(fake.states['switch.entrance_switch_1']).toBeUndefined();
    expect(events.at(-1)).toBe('home');
  });
});

describe('createFakeHass: refresh', () => {
  it('previews an empty summary when the planner still has the loaded home', async () => {
    const fake = createFakeHass(fresh(), admin);
    const summary = await ws<RefreshSummary>(fake, { type: 'maxsen/refresh/preview' });
    expect(summary).toEqual({
      preview_id: expect.any(String),
      added: [],
      removed: [],
      changed_drawings: [],
    });
  });

  it('previews what changed in a new planner home, with names for display', async () => {
    const fake = createFakeHass(fresh(), admin);
    fake.setPlannerPackage(changedPackage());
    const summary = await ws<RefreshSummary>(fake, { type: 'maxsen/refresh/preview' });
    expect(ids(summary.added)).toEqual(['dl9']);
    expect(summary.added[0]).toEqual({ id: 'dl9', productName: 'Luna Downlight', label: 'Porch light' });
    expect(ids(summary.removed)).toEqual(['dl1', 'sw1']);
    expect(summary.removed.find((e) => e.id === 'sw1')).toEqual({
      id: 'sw1',
      productName: 'Ark Series',
      label: 'Entrance switch',
    });
    // The lighting plan was redrawn: its surviving elements are listed (dl9 is under added)
    expect(ids(summary.changed_drawings)).toEqual(['dl2', 'dl3', 'led1']);
    // Preview changes nothing
    expect((await getHome(fake)).links).toHaveProperty('sw1');
  });

  it('previews against an opened file when given its file_id', async () => {
    const fake = createFakeHass(fresh(), admin);
    const fileId = fake.uploadFile(changedPackage());
    const summary = await ws<RefreshSummary>(fake, { type: 'maxsen/refresh/preview', file_id: fileId });
    expect(ids(summary.removed)).toEqual(['dl1', 'sw1']);
    await expect(
      ws(fake, { type: 'maxsen/refresh/preview', file_id: 'unknown' }),
    ).rejects.toMatchObject({ code: 'invalid_package' });
  });

  it('applies the preview: drops links, quick panel items and scene members of removed elements', async () => {
    const fake = createFakeHass(fresh(), admin);
    await ws(fake, { type: 'maxsen/scenes/create_starter' });
    await ws(fake, {
      type: 'maxsen/quick_panel/set',
      items: [
        { type: 'element', id: 'sw1' },
        { type: 'element', id: 'sen1' },
        { type: 'entity', id: 'scene.all_off' },
      ],
    });
    fake.setPlannerPackage(changedPackage());
    const preview = await ws<RefreshSummary>(fake, { type: 'maxsen/refresh/preview' });
    const applied = await ws<RefreshSummary>(fake, {
      type: 'maxsen/refresh/apply',
      preview_id: preview.preview_id,
    });
    expect(ids(applied.removed)).toEqual(['dl1', 'sw1']);

    const response = await getHome(fake);
    expect(response.links).not.toHaveProperty('sw1');
    expect(response.links).not.toHaveProperty('dl1');
    expect(response.links).toHaveProperty('sen1');
    expect(response.links).toHaveProperty('dl2');
    // the new element exists in the home, unlinked, ready to be linked
    expect(response.links).not.toHaveProperty('dl9');
    expect(response.quick_panel).toEqual([
      { type: 'element', id: 'sen1' },
      { type: 'entity', id: 'scene.all_off' },
    ]);
    // sw1's three gangs are no longer in "All off"
    expect(fake.states['scene.all_off']!.attributes['entity_id']).toEqual(['switch.level_1_lighting_1']);
    const planElements = response.package!.levels.flatMap((l) => l.plans.flatMap((p) => p.elements));
    expect(planElements.some((e) => e.id === 'dl9')).toBe(true);
  });

  it('rejects apply for an unknown, used or expired preview', async () => {
    vi.useFakeTimers();
    const fake = createFakeHass(fresh(), admin);
    await expect(
      ws(fake, { type: 'maxsen/refresh/apply', preview_id: 'nope' }),
    ).rejects.toMatchObject({ code: 'preview_expired' });

    const first = await ws<RefreshSummary>(fake, { type: 'maxsen/refresh/preview' });
    await ws(fake, { type: 'maxsen/refresh/apply', preview_id: first.preview_id });
    await expect(
      ws(fake, { type: 'maxsen/refresh/apply', preview_id: first.preview_id }),
    ).rejects.toMatchObject({ code: 'preview_expired' });

    const second = await ws<RefreshSummary>(fake, { type: 'maxsen/refresh/preview' });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await expect(
      ws(fake, { type: 'maxsen/refresh/apply', preview_id: second.preview_id }),
    ).rejects.toMatchObject({ code: 'preview_expired' });
  });

  it('needs admin and installer mode', async () => {
    for (const opts of [
      { admin: false, installerMode: true },
      { admin: true, installerMode: false },
    ]) {
      const fake = createFakeHass(fresh(), opts);
      await expect(ws(fake, { type: 'maxsen/refresh/preview' })).rejects.toMatchObject({
        code: 'not_allowed',
      });
      await expect(
        ws(fake, { type: 'maxsen/refresh/apply', preview_id: 'x' }),
      ).rejects.toMatchObject({ code: 'not_allowed' });
    }
  });
});

describe('createFakeHass: starter scenes', () => {
  type Created = { scenes: { id: string; name: string; entity_ids: string[] }[] };

  it('builds All off, one per level and All lights off from the links', async () => {
    const fake = createFakeHass(fresh(), admin);
    const { scenes } = await ws<Created>(fake, { type: 'maxsen/scenes/create_starter' });
    const byName = Object.fromEntries(scenes.map((s) => [s.name, s.entity_ids]));
    expect(Object.keys(byName).sort()).toEqual([
      'All lights off',
      'All off',
      'All off – Level 1',
    ]);
    // 3 switch gangs, the lighting circuit; the curtain and sensors are not switchable here
    expect(byName['All off – Level 1']).toHaveLength(4);
    expect(byName['All off']).toEqual(byName['All off – Level 1']);
    expect(byName['All lights off']).toHaveLength(1);
    expect(byName['All lights off']![0]).toMatch(/^switch\.level_1_lighting_1$/);
  });

  it('adds scene entities, and puts them in the quick panel once', async () => {
    const fake = createFakeHass(fresh(), admin);
    await ws(fake, { type: 'maxsen/scenes/create_starter' });
    await ws(fake, { type: 'maxsen/scenes/create_starter' });
    expect(fake.states['scene.all_off']!.attributes['friendly_name']).toBe('All off');
    expect(fake.states['scene.all_off_level_1']!.attributes['friendly_name']).toBe('All off – Level 1');
    expect(fake.states['scene.all_lights_off']).toBeDefined();
    expect(fake.entities['scene.all_off']).toBeDefined();
    const panel = (await getHome(fake)).quick_panel;
    expect(panel).toEqual([
      { type: 'entity', id: 'scene.all_off' },
      { type: 'entity', id: 'scene.all_off_level_1' },
      { type: 'entity', id: 'scene.all_lights_off' },
    ]);
  });

  it('turns its members off when activated', async () => {
    const fake = createFakeHass(fresh(), admin);
    await ws(fake, { type: 'maxsen/scenes/create_starter' });
    const listener = vi.fn();
    fake.onChange(listener);
    expect(fake.states['switch.entrance_switch_1']!.state).toBe('on');
    await fake.callService('scene', 'turn_on', { entity_id: 'scene.all_lights_off' });
    expect(fake.states['switch.level_1_lighting_1']!.state).toBe('off');
    expect(fake.states['switch.entrance_switch_1']!.state).toBe('on');
    await fake.callService('scene', 'turn_on', {}, { entity_id: 'scene.all_off' });
    expect(fake.states['switch.entrance_switch_1']!.state).toBe('off');
    expect(listener).toHaveBeenCalled();
  });

  it('needs admin and installer mode', async () => {
    const fake = createFakeHass(fresh(), { admin: false, installerMode: true });
    await expect(ws(fake, { type: 'maxsen/scenes/create_starter' })).rejects.toMatchObject({
      code: 'not_allowed',
    });
  });
});

describe('parseHomeFile', () => {
  const text = (value: unknown): string => JSON.stringify(value);

  it('accepts the planner fixture', () => {
    expect(parseHomeFile(text(home)).project.title).toBe('Test House');
  });

  it('explains each way a file can be wrong', () => {
    const reason = (raw: string): string => {
      try {
        parseHomeFile(raw);
      } catch (error) {
        if (error instanceof PackageProblem) return error.reason;
        throw error;
      }
      return 'ok';
    };
    expect(reason('not json {')).toBe('invalid_json');
    expect(reason(text([1, 2]))).toBe('wrong_format');
    expect(reason(text({ ...home, format: 'something-else' }))).toBe('wrong_format');
    expect(reason(text({ ...home, schemaVersion: 2 }))).toBe('unsupported_version');
    expect(reason(text({ ...home, levels: 'x' }))).toBe('wrong_format');
    const missing = fresh();
    missing.levels[0]!.plans[0]!.background.imageId = 'gone';
    expect(reason(text(missing))).toBe('missing_image');
  });

  it('has a friendly message for every reason', () => {
    for (const reason of ['invalid_json', 'wrong_format', 'unsupported_version', 'too_large', 'missing_image'] as const) {
      const message = new PackageProblem(reason).message;
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toContain('_');
    }
  });
});
