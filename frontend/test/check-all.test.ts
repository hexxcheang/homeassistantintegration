import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeHass } from '../preview/fake-hass.ts';
import { CHECK_MS, CheckAll, type CheckStep } from '../src/check-all.ts';
import type { HassLike, HomeElement, HomeResponse, Link } from '../src/types.ts';
import { home as sampleHome, makeHass } from './helpers.ts';
import { homeResponse } from './view-helpers.ts';

const device = (id: string): Link => ({ type: 'device', id });
const entity = (id: string): Link => ({ type: 'entity', id });

/** A home whose elements are all linked, plus an aircon, a lock and a camera, which Check all skips. */
function linkedHome(links: Record<string, Link> = {}): HomeResponse {
  const home = structuredClone(homeResponse({ installer_mode: true }));
  const extra = (id: string, categoryId: HomeElement['categoryId']): HomeElement => ({
    id,
    categoryId,
    kind: 'point',
    productName: id,
    variantName: '',
    label: '',
    drawn: true,
  });
  home.package!.levels[0]!.plans[0]!.elements.push(
    extra('ac1', 'aircon-controllers'),
    extra('lk1', 'smart-locks'),
    extra('cam1', 'cameras'),
  );
  return {
    ...home,
    links: {
      sw1: device('dev-sw'),
      cur1: device('dev-cur'),
      sen1: device('dev-door'),
      ac1: device('dev-ac'),
      lk1: device('dev-lock'),
      cam1: device('dev-cam'),
      dl1: entity('switch.l1_gang1'),
      dl2: entity('switch.l1_gang1'),
      dl3: entity('switch.l1_gang2'),
      led1: entity('light.led'),
      ...links,
    },
  };
}

function world(): HassLike {
  const hass = makeHass({
    devices: {
      'dev-sw': { name: 'Entrance switch' },
      'dev-cur': { name: 'Curtain' },
      'dev-door': { name: 'Door sensor' },
      'dev-ac': { name: 'Aircon' },
      'dev-lock': { name: 'Lock' },
      'dev-cam': { name: 'Camera' },
    },
    entities: {
      'switch.sw_1': { device_id: 'dev-sw' },
      'switch.sw_2': { device_id: 'dev-sw' },
      'switch.sw_3': { device_id: 'dev-sw' },
      'switch.sw_backlight': { device_id: 'dev-sw', entity_category: 'config' },
      'lock.sw_child_lock': { device_id: 'dev-sw', entity_category: 'config' },
      'cover.cur': { device_id: 'dev-cur' },
      'binary_sensor.door': { device_id: 'dev-door' },
      'climate.ac': { device_id: 'dev-ac' },
      'lock.front': { device_id: 'dev-lock' },
      'camera.porch': { device_id: 'dev-cam' },
      'switch.l1_gang1': {},
      'switch.l1_gang2': {},
      'light.led': {},
    },
    states: {
      'switch.sw_1': { state: 'on' },
      'switch.sw_2': { state: 'off' },
      'switch.sw_3': { state: 'off' },
      'switch.sw_backlight': { state: 'on' },
      'lock.sw_child_lock': { state: 'unlocked' },
      'cover.cur': { state: 'open', attributes: { current_position: 100, supported_features: 15 } },
      'binary_sensor.door': { state: 'off' },
      'climate.ac': { state: 'cool' },
      'lock.front': { state: 'locked' },
      'camera.porch': { state: 'idle' },
      'switch.l1_gang1': { state: 'on' },
      'switch.l1_gang2': { state: 'off' },
      'light.led': { state: 'off' },
    },
  });
  hass.callService = vi.fn(async () => undefined);
  return hass;
}

const calls = (hass: HassLike): unknown[][] => (hass.callService as ReturnType<typeof vi.fn>).mock.calls;
const stepFor = (steps: CheckStep[], entityId: string): CheckStep => {
  const step = steps.find((s) => s.entityIds.includes(entityId));
  if (!step) throw new Error(`No step for ${entityId}`);
  return step;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('CheckAll.steps', () => {
  it('has one step per gang entity, in walk order: curtain and switch gangs, then the lights gangs and strips', () => {
    const steps = new CheckAll(world(), linkedHome()).steps();
    expect(steps.map((s) => s.entityIds)).toEqual([
      ['cover.cur'], // cur1 is the top-most smart-home element of Level 1
      ['switch.sw_1'],
      ['switch.sw_2'],
      ['switch.sw_3'],
      ['switch.l1_gang1'],
      ['switch.l1_gang2'],
      ['light.led'],
    ]);
  });

  it('leaves out climate, locks, cameras and sensors, and a switch device\'s settings', () => {
    const all = new CheckAll(world(), linkedHome())
      .steps()
      .flatMap((s) => s.entityIds);
    for (const id of ['climate.ac', 'lock.front', 'camera.porch', 'binary_sensor.door', 'switch.sw_backlight', 'lock.sw_child_lock']) {
      expect(all, id).not.toContain(id);
    }
  });

  it('names the lights of a gang step and carries every light element, so Wrong can cover them all', () => {
    const steps = new CheckAll(world(), linkedHome()).steps();
    const gang1 = stepFor(steps, 'switch.l1_gang1');
    expect(gang1.elementIds).toEqual(['dl1', 'dl2']);
    expect(gang1.label).toBe('Luna Downlight and 1 more');
    expect(gang1.levelName).toBe('Level 1');
    const gang2 = stepFor(steps, 'switch.l1_gang2');
    expect(gang2.elementIds).toEqual(['dl3']);
    expect(gang2.label).toBe('Luna Downlight');
    expect(stepFor(steps, 'light.led').elementIds).toEqual(['led1']);
  });

  it('has a step for each gang of a linked switch, naming the gang, and one for a curtain', () => {
    const steps = new CheckAll(world(), linkedHome()).steps();
    expect(stepFor(steps, 'switch.sw_2')).toMatchObject({
      label: 'Entrance switch · gang 2 of 3',
      elementIds: ['sw1'],
      levelName: 'Level 1',
    });
    expect(stepFor(steps, 'cover.cur')).toMatchObject({ label: 'Smart Curtain Track', elementIds: ['cur1'] });
  });

  it('checks a gang once when lights are linked to a gang of a linked switch (the lights are what Wrong unlinks)', () => {
    const steps = new CheckAll(world(), linkedHome({ dl1: entity('switch.sw_1') })).steps();
    expect(steps.filter((s) => s.entityIds.includes('switch.sw_1'))).toHaveLength(1);
    expect(stepFor(steps, 'switch.sw_1').elementIds).toEqual(['dl1']);
  });

  it('names the switch in the label of such a gang and highlights its marker too, but Wrong still unlinks only the lights', () => {
    const step = stepFor(new CheckAll(world(), linkedHome({ dl1: entity('switch.sw_1') })).steps(), 'switch.sw_1');
    expect(step.label).toBe('Luna Downlight · via Entrance switch, gang 1 of 3');
    expect(step.elementIds).toEqual(['dl1']);
    expect(step.highlightIds).toEqual(['dl1', 'sw1']);
    // A gang of a single-gang switch has no "gang n of m".
    const hass = world();
    delete hass.entities['switch.sw_2'];
    delete hass.entities['switch.sw_3'];
    const single = stepFor(new CheckAll(hass, linkedHome({ dl1: entity('switch.sw_1') })).steps(), 'switch.sw_1');
    expect(single.label).toBe('Luna Downlight · via Entrance switch');
  });

  it('highlights just the lights of a gang no switch device owns', () => {
    const step = stepFor(new CheckAll(world(), linkedHome()).steps(), 'switch.l1_gang1');
    expect(step.highlightIds).toEqual(['dl1', 'dl2']);
  });

  it('numbers the gangs of a device by entity id, whatever order the registry lists them in', () => {
    const hass = world();
    const { 'switch.sw_1': one, 'switch.sw_2': two, 'switch.sw_3': three, ...rest } = hass.entities;
    hass.entities = { ...rest, 'switch.sw_3': three!, 'switch.sw_1': one!, 'switch.sw_2': two! };
    const steps = new CheckAll(hass, linkedHome()).steps();
    expect(steps.filter((s) => s.label.startsWith('Entrance switch')).map((s) => [s.entityIds[0], s.label])).toEqual([
      ['switch.sw_1', 'Entrance switch · gang 1 of 3'],
      ['switch.sw_2', 'Entrance switch · gang 2 of 3'],
      ['switch.sw_3', 'Entrance switch · gang 3 of 3'],
    ]);
  });

  it('has no step for an element that is not linked', () => {
    const home = linkedHome();
    delete home.links['cur1'];
    delete home.links['dl3'];
    const entities = new CheckAll(world(), home).steps().flatMap((s) => s.entityIds);
    expect(entities).not.toContain('cover.cur');
    expect(entities).not.toContain('switch.l1_gang2');
  });

  it('counts a light linked to a device by its switch and light entities', () => {
    const steps = new CheckAll(world(), linkedHome({ led1: device('dev-sw') })).steps();
    expect(stepFor(steps, 'switch.sw_3').elementIds).toContain('led1');
  });

  it('keeps a step for an entity Home Assistant no longer has, so it can be reported', () => {
    const hass = world();
    delete hass.states['light.led'];
    expect(new CheckAll(hass, linkedHome()).steps().flatMap((s) => s.entityIds)).toContain('light.led');
  });
});

describe('CheckAll.run', () => {
  it('turns an off entity on for 2 s, then off again', async () => {
    vi.useFakeTimers();
    const hass = world();
    const all = new CheckAll(hass, linkedHome());
    const step = stepFor(all.steps(), 'switch.sw_2'); // off

    const done = all.run(step);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(hass)).toEqual([['switch', 'turn_on', { entity_id: 'switch.sw_2' }]]);

    await vi.advanceTimersByTimeAsync(CHECK_MS - 1);
    expect(calls(hass)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls(hass)).toEqual([
      ['switch', 'turn_on', { entity_id: 'switch.sw_2' }],
      ['switch', 'turn_off', { entity_id: 'switch.sw_2' }],
    ]);
    expect(await done).toEqual({ status: 'done', restored: true });
  });

  it('turns an on entity off for 2 s, then on again', async () => {
    vi.useFakeTimers();
    const hass = world();
    const all = new CheckAll(hass, linkedHome());
    const done = all.run(stepFor(all.steps(), 'switch.l1_gang1')); // on
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    expect(calls(hass)).toEqual([
      ['switch', 'turn_off', { entity_id: 'switch.l1_gang1' }],
      ['switch', 'turn_on', { entity_id: 'switch.l1_gang1' }],
    ]);
    expect((await done).status).toBe('done');
  });

  it('uses the entity\'s own domain', async () => {
    vi.useFakeTimers();
    const hass = world();
    const all = new CheckAll(hass, linkedHome());
    const done = all.run(stepFor(all.steps(), 'light.led'));
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    await done;
    expect(calls(hass).map((c) => c.slice(0, 2))).toEqual([
      ['light', 'turn_on'],
      ['light', 'turn_off'],
    ]);
  });

  it('closes an open curtain, stops it after 2 s and returns it to where it was', async () => {
    vi.useFakeTimers();
    const hass = world();
    hass.states['cover.cur'] = {
      state: 'open',
      attributes: { current_position: 60, supported_features: 15 },
    };
    const all = new CheckAll(hass, linkedHome());
    const done = all.run(stepFor(all.steps(), 'cover.cur'));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(hass)).toEqual([['cover', 'close_cover', { entity_id: 'cover.cur' }]]);
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    expect(calls(hass)).toEqual([
      ['cover', 'close_cover', { entity_id: 'cover.cur' }],
      ['cover', 'stop_cover', { entity_id: 'cover.cur' }],
      ['cover', 'set_cover_position', { entity_id: 'cover.cur', position: 60 }],
    ]);
    expect(await done).toEqual({ status: 'done', restored: true });
  });

  it('opens a closed curtain, then stops it and puts it back to closed', async () => {
    vi.useFakeTimers();
    const hass = world();
    hass.states['cover.cur'] = { state: 'closed', attributes: { current_position: 0, supported_features: 15 } };
    const all = new CheckAll(hass, linkedHome());
    const done = all.run(stepFor(all.steps(), 'cover.cur'));
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    await done;
    expect(calls(hass).map((c) => [c[1], (c[2] as Record<string, unknown>)['position']])).toEqual([
      ['open_cover', undefined],
      ['stop_cover', undefined],
      ['set_cover_position', 0],
    ]);
  });

  it('returns a curtain that cannot be set to a position by driving it back, and skips a stop it lacks', async () => {
    vi.useFakeTimers();
    const hass = world();
    // open + close only: no stop (8) and no position (4)
    hass.states['cover.cur'] = { state: 'open', attributes: { supported_features: 3 } };
    const all = new CheckAll(hass, linkedHome());
    const done = all.run(stepFor(all.steps(), 'cover.cur'));
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    await done;
    expect(calls(hass).map((c) => c[1])).toEqual(['close_cover', 'open_cover']);
  });

  it('does not touch an entity that is unavailable, and says which', async () => {
    const hass = world();
    hass.states['switch.l1_gang2'] = { state: 'unavailable', attributes: {} };
    const all = new CheckAll(hass, linkedHome());
    expect(await all.run(stepFor(all.steps(), 'switch.l1_gang2'))).toEqual({
      status: 'unavailable',
      entityIds: ['switch.l1_gang2'],
    });
    expect(calls(hass)).toHaveLength(0);
  });

  it('treats an unknown state and an entity with no state as unavailable too', async () => {
    const hass = world();
    hass.states['switch.l1_gang2'] = { state: 'unknown', attributes: {} };
    delete hass.states['light.led'];
    const all = new CheckAll(hass, linkedHome());
    expect((await all.run(stepFor(all.steps(), 'switch.l1_gang2'))).status).toBe('unavailable');
    expect((await all.run(stepFor(all.steps(), 'light.led'))).status).toBe('unavailable');
    expect(calls(hass)).toHaveLength(0);
  });

  it('runs one step at a time', async () => {
    vi.useFakeTimers();
    const hass = world();
    const all = new CheckAll(hass, linkedHome());
    const steps = all.steps();
    const first = all.run(stepFor(steps, 'switch.sw_2'));
    expect(await all.run(stepFor(steps, 'switch.sw_3'))).toEqual({ status: 'busy' });
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    await first;
    expect(calls(hass).every((c) => (c[2] as { entity_id: string }).entity_id === 'switch.sw_2')).toBe(true);
  });

  it('puts the state back at once when aborted in the 2 s, and does nothing more afterwards', async () => {
    vi.useFakeTimers();
    const hass = world();
    const all = new CheckAll(hass, linkedHome());
    const done = all.run(stepFor(all.steps(), 'switch.sw_2'));
    await vi.advanceTimersByTimeAsync(500);
    await all.abort();
    expect(calls(hass).map((c) => c[1])).toEqual(['turn_on', 'turn_off']);
    expect(await done).toEqual({ status: 'cancelled', restored: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls(hass)).toHaveLength(2);
  });

  it('puts the state back even when aborted before the first switch call has returned', async () => {
    vi.useFakeTimers();
    const hass = world();
    let release: () => void = () => undefined;
    (hass.callService as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const all = new CheckAll(hass, linkedHome());
    const done = all.run(stepFor(all.steps(), 'switch.sw_2'));
    const aborted = all.abort();
    release();
    await aborted;
    expect(calls(hass).map((c) => c[1])).toEqual(['turn_on', 'turn_off']);
    expect((await done).status).toBe('cancelled');
  });

  it('is a no-op to abort when nothing runs', async () => {
    const hass = world();
    await new CheckAll(hass, linkedHome()).abort();
    expect(calls(hass)).toHaveLength(0);
  });

  it('still tries to put the state back when switching failed, and reports the failure', async () => {
    vi.useFakeTimers();
    const hass = world();
    (hass.callService as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ message: 'Boom' });
    const all = new CheckAll(hass, linkedHome());
    const done = all.run(stepFor(all.steps(), 'switch.sw_2'));
    await vi.advanceTimersByTimeAsync(0);
    expect(await done).toEqual({ status: 'failed', message: 'Boom', restored: true });
    expect(calls(hass).map((c) => c[1])).toEqual(['turn_on', 'turn_off']);
  });

  it('reports that the state could not be put back', async () => {
    vi.useFakeTimers();
    const hass = world();
    (hass.callService as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ message: 'Offline' });
    const all = new CheckAll(hass, linkedHome());
    const done = all.run(stepFor(all.steps(), 'switch.sw_2'));
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    expect(await done).toEqual({ status: 'done', restored: false });
  });

  it('reads the state when the step runs, not when it was listed', async () => {
    vi.useFakeTimers();
    const hass = world();
    const all = new CheckAll(hass, linkedHome());
    const step = stepFor(all.steps(), 'switch.sw_2'); // off when listed
    hass.states['switch.sw_2'] = { state: 'on', attributes: {} };
    const done = all.run(step);
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    await done;
    expect(calls(hass).map((c) => c[1])).toEqual(['turn_off', 'turn_on']);
  });

  it('uses the hass it was last given', async () => {
    vi.useFakeTimers();
    const first = world();
    const second = world();
    const all = new CheckAll(first, linkedHome());
    const step = stepFor(all.steps(), 'switch.sw_2');
    all.hass = second;
    const done = all.run(step);
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    await done;
    expect(calls(first)).toHaveLength(0);
    expect(calls(second)).toHaveLength(2);
  });
});

/**
 * A Home Assistant whose states land late, as with Zigbee2MQTT: a service call is answered at once,
 * the entity reports `ms` later. A cover goes through `closing`/`opening` first and takes `travel` ms.
 */
function lagging(hass: HassLike, ms: number, travel = 0): void {
  const set = (id: string, state: string, attributes: Record<string, unknown> = {}) => {
    hass.states[id] = { state, attributes: { ...hass.states[id]?.attributes, ...attributes } };
  };
  hass.callService = vi.fn(async (domain: string, service: string, data?: Record<string, unknown>) => {
    const id = (data as { entity_id: string }).entity_id;
    if (domain === 'cover') {
      if (service === 'stop_cover') return undefined;
      const target = service === 'set_cover_position' ? (data as { position: number }).position : service === 'open_cover' ? 100 : 0;
      const current = hass.states[id]?.attributes['current_position'] as number;
      setTimeout(() => set(id, target > current ? 'opening' : 'closing'), ms);
      setTimeout(() => set(id, target === 0 ? 'closed' : 'open', { current_position: target }), ms + travel);
      return undefined;
    }
    const state = service === 'turn_on' ? 'on' : 'off';
    setTimeout(() => set(id, state), ms);
    return undefined;
  }) as never;
}

describe('CheckAll waits for the put-back to land', () => {
  it('does not finish until a lagging switch reports its old state again', async () => {
    vi.useFakeTimers();
    const hass = world();
    lagging(hass, 400);
    const all = new CheckAll(hass, linkedHome());
    let finished = false;
    const done = all.run(stepFor(all.steps(), 'switch.l1_gang1')).then((r) => ((finished = true), r)); // on
    await vi.advanceTimersByTimeAsync(CHECK_MS); // turn_on has been called again, but nothing has landed
    expect(calls(hass).map((c) => c[1])).toEqual(['turn_off', 'turn_on']);
    expect(hass.states['switch.l1_gang1']!.state).toBe('off');
    await vi.advanceTimersByTimeAsync(300);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(hass.states['switch.l1_gang1']!.state).toBe('on');
    expect(await done).toEqual({ status: 'done', restored: true });
  });

  it('gives up quietly after 3 s when a switch never reports back', async () => {
    vi.useFakeTimers();
    const hass = world();
    // It goes off at once, and never reports being on again.
    hass.callService = vi.fn(async (_d: string, service: string, data?: Record<string, unknown>) => {
      if (service === 'turn_off') hass.states[(data as { entity_id: string }).entity_id] = { state: 'off', attributes: {} };
    }) as never;
    const all = new CheckAll(hass, linkedHome());
    let finished = false;
    const done = all.run(stepFor(all.steps(), 'switch.l1_gang1')).then((r) => ((finished = true), r));
    await vi.advanceTimersByTimeAsync(CHECK_MS + 2800);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(await done).toEqual({ status: 'done', restored: true });
  });

  it('waits for a curtain to stop travelling and reach its position', async () => {
    vi.useFakeTimers();
    const hass = world();
    lagging(hass, 300, 4000);
    const all = new CheckAll(hass, linkedHome());
    let finished = false;
    const done = all.run(stepFor(all.steps(), 'cover.cur')).then((r) => ((finished = true), r)); // open, 100
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    expect(calls(hass).map((c) => c[1])).toEqual(['close_cover', 'stop_cover', 'set_cover_position']);
    // Closing finished at 4.3 s (the stop above does nothing in this fake) and the way back takes 4 s more.
    await vi.advanceTimersByTimeAsync(4000);
    expect(finished).toBe(false);
    expect(['opening', 'closed', 'closing']).toContain(hass.states['cover.cur']!.state);
    await vi.advanceTimersByTimeAsync(5000);
    expect(hass.states['cover.cur']).toMatchObject({ state: 'open', attributes: { current_position: 100 } });
    expect(await done).toEqual({ status: 'done', restored: true });
  });

  it('waits for a curtain that has no positions to reach its old end', async () => {
    vi.useFakeTimers();
    const hass = world();
    hass.states['cover.cur'] = { state: 'closed', attributes: { supported_features: 3, current_position: 0 } };
    lagging(hass, 100, 1000);
    const all = new CheckAll(hass, linkedHome());
    let finished = false;
    const done = all.run(stepFor(all.steps(), 'cover.cur')).then((r) => ((finished = true), r));
    await vi.advanceTimersByTimeAsync(CHECK_MS + 500);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect((await done).status).toBe('done');
    expect(hass.states['cover.cur']!.state).toBe('closed');
  });

  it('gives up quietly on a curtain after 60 s', async () => {
    vi.useFakeTimers();
    const hass = world();
    hass.callService = vi.fn(async () => undefined) as never;
    hass.states['cover.cur'] = { state: 'closing', attributes: { current_position: 50, supported_features: 15 } };
    const all = new CheckAll(hass, linkedHome());
    let finished = false;
    const done = all.run(stepFor(all.steps(), 'cover.cur')).then((r) => ((finished = true), r));
    await vi.advanceTimersByTimeAsync(CHECK_MS + 59_000);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await done).toEqual({ status: 'done', restored: true });
  });

  it('also waits after an abort, so nothing listens before the load is back', async () => {
    vi.useFakeTimers();
    const hass = world();
    lagging(hass, 400);
    const all = new CheckAll(hass, linkedHome());
    const done = all.run(stepFor(all.steps(), 'switch.l1_gang1'));
    await vi.advanceTimersByTimeAsync(500);
    let aborted = false;
    void all.abort().then(() => (aborted = true));
    await vi.advanceTimersByTimeAsync(300);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(aborted).toBe(true);
    expect(await done).toEqual({ status: 'cancelled', restored: true });
  });

  it('does not wait when told the element is gone', async () => {
    vi.useFakeTimers();
    const hass = world();
    lagging(hass, 400);
    const all = new CheckAll(hass, linkedHome());
    void all.run(stepFor(all.steps(), 'switch.l1_gang1'));
    await vi.advanceTimersByTimeAsync(500);
    let aborted = false;
    void all.abort(false).then(() => (aborted = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(aborted).toBe(true);
  });

  it('runs a step again from the state it remembered the first time, not from a load still on its way back', async () => {
    vi.useFakeTimers();
    const hass = world();
    const all = new CheckAll(hass, linkedHome());
    const step = stepFor(all.steps(), 'cover.cur'); // open at 100
    const first = all.run(step);
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    await first;
    (hass.callService as ReturnType<typeof vi.fn>).mockClear();

    // Again, while the curtain is still opening and at 85.
    hass.states['cover.cur'] = { state: 'opening', attributes: { current_position: 85, supported_features: 15 } };
    const second = all.run(step);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(hass)[0]).toEqual(['cover', 'close_cover', { entity_id: 'cover.cur' }]);
    hass.states['cover.cur'] = { state: 'open', attributes: { current_position: 100, supported_features: 15 } };
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    expect(calls(hass).at(-1)).toEqual(['cover', 'set_cover_position', { entity_id: 'cover.cur', position: 100 }]);
    await second;
  });
});

describe('CheckAll against the preview\'s simulated Home Assistant', () => {
  it('goes through every linked gang and curtain and leaves every state as it was', async () => {
    vi.useFakeTimers();
    const fake = createFakeHass(structuredClone(sampleHome), { admin: true, installerMode: true });
    const response = await fake.callWS<HomeResponse>({ type: 'maxsen/home', entry_id: 'preview-entry' });
    const all = new CheckAll(fake, response);
    const steps = all.steps();
    expect(steps.length).toBeGreaterThan(3);
    // Climate, locks, cameras and sensors are never among them.
    for (const id of steps.flatMap((s) => s.entityIds)) {
      expect(['switch', 'light', 'cover'], id).toContain(id.split('.')[0]);
    }
    const before = JSON.stringify(fake.states);
    const seen: string[] = [];
    for (const step of steps) {
      const during = new Set<string>();
      const stop = fake.onChange(() => during.add(JSON.stringify(fake.states)));
      const done = all.run(step);
      await vi.advanceTimersByTimeAsync(CHECK_MS);
      expect(await done).toEqual({ status: 'done', restored: true });
      stop();
      expect(during.size, step.label).toBeGreaterThan(1); // it changed, and changed back
      seen.push(...step.entityIds);
    }
    expect(JSON.stringify(fake.states)).toBe(before);
    expect(seen).toContain('cover.smart_curtain_track');
  });
});
