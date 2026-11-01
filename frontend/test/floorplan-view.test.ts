import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/floorplan-view.ts';
import type { HomePackage, HomeResponse, Link } from '../src/types.ts';
import { home, makeHass } from './helpers.ts';
import { group, homeResponse, mountView, pointer, root, settle, tap, wheel } from './view-helpers.ts';

const SWITCH_DEVICE: Link = { type: 'device', id: 'dev-hall' };
const LIGHT: Link = { type: 'entity', id: 'light.kitchen' };

function hassWithDevices() {
  return makeHass({
    devices: { 'dev-hall': { name: 'Hall switch' }, 'dev-gang': { name: 'Gang switch' } },
    entities: {
      'switch.hall': { device_id: 'dev-hall' },
      'switch.gang1': { device_id: 'dev-gang' },
      'switch.gang2': { device_id: 'dev-gang' },
      'sensor.gang_temp': { device_id: 'dev-gang' },
      'light.kitchen': {},
    },
    states: {
      'switch.hall': { state: 'off' },
      'switch.gang1': { state: 'on', attributes: { friendly_name: 'Left' } },
      'switch.gang2': { state: 'off', attributes: { friendly_name: 'Right' } },
      'sensor.gang_temp': { state: '21', attributes: { unit_of_measurement: '°C' } },
      'light.kitchen': { state: 'on' },
    },
  });
}

beforeEach(() => {
  // Images load through the (fake) authenticated fetch and become object URLs.
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:image-${++n}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function withImages(hass = hassWithDevices()) {
  vi.spyOn(hass, 'fetchWithAuth').mockImplementation(
    async () => new Response(new Blob(['png']), { status: 200 }),
  );
  return hass;
}

describe('drawing', () => {
  it('draws one group per scene item over one background, with the viewBox of the plan', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });

    const ids = [...root(view).querySelectorAll('g[data-element-id]')].map((g) =>
      g.getAttribute('data-element-id'),
    );
    // Level 1 draws the smart-home and the lighting scene together.
    expect(ids).toEqual(['sw1', 'sen1', 'cur1', 'note1', 'dl1', 'dl2', 'dl3', 'led1']);
    expect(root(view).querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 1000 1000');
    expect(root(view).querySelectorAll('image')).toHaveLength(1);
    expect(root(view).querySelector('image')?.getAttribute('href')).toMatch(/^blob:image-/);
  });

  it('gives an on light the class on, and an unlinked element its own class', async () => {
    const view = await mountView({
      hass: withImages(),
      home: homeResponse({ links: { dl1: LIGHT } }),
    });

    expect(group(view, 'dl1').classList.contains('on')).toBe(true);
    expect(group(view, 'dl1').querySelector('.glyph')?.getAttribute('filter')).toMatch(/^url\(#/);
    expect(group(view, 'dl2').classList.contains('unlinked')).toBe(true);
    expect(group(view, 'dl2').querySelector('.glyph')?.hasAttribute('filter')).toBe(false);
  });

  it('shows a sensor reading as a pill and an alert as a pulse ring', async () => {
    const hass = makeHass({
      devices: { d1: {}, d2: {} },
      entities: { 'sensor.t': { device_id: 'd1' }, 'binary_sensor.door': { device_id: 'd2' } },
      states: {
        'sensor.t': { state: '21.5', attributes: { unit_of_measurement: '°C' } },
        'binary_sensor.door': { state: 'on', attributes: { device_class: 'door' } },
      },
    });
    const view = await mountView({
      hass: withImages(hass),
      home: homeResponse({
        links: { sen1: { type: 'device', id: 'd1' }, sw1: { type: 'device', id: 'd2' } },
      }),
    });

    expect(group(view, 'sen1').querySelector('.pill text')?.textContent).toBe('21.5 °C');
    expect(group(view, 'sw1').classList.contains('alert')).toBe(true);
    expect(group(view, 'sw1').querySelector('.alert-ring')).not.toBeNull();
    expect(group(view, 'dl1').querySelector('.alert-ring')).toBeNull();
  });

  it('makes every marker at least 44 CSS px to hit', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    const hit = group(view, 'dl1').querySelector('circle.hit');
    // The stage is 600 px high in tests, so 1000 plan units are 600 px.
    expect(Number(hit?.getAttribute('r')) * 0.6).toBeGreaterThanOrEqual(22);
  });

  it('gives lines (strips, curtains) a hit twin at least 44 CSS px wide', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    for (const id of ['led1', 'cur1']) {
      const twin = group(view, id).querySelector('path.hit');
      expect(twin, id).not.toBeNull();
      expect(twin?.getAttribute('fill')).toBe('none');
      // 600 px stage for 1000 plan units: 0.6 px per unit.
      expect(Number(twin?.getAttribute('stroke-width')) * 0.6).toBeGreaterThanOrEqual(44 - 0.01);
    }
  });

  it('renders staff text only as text, never as markup', async () => {
    const nasty = '<script>alert(1)</script>&"';
    const edited = structuredClone(homeResponse());
    const marker = edited.package!.levels[0]!.plans[0]!.scene.items.find((i) => i.type === 'marker');
    if (marker?.type !== 'marker') throw new Error('fixture has a marker');
    marker.label = { text: nasty, x: 10, y: 10, fontSize: 12 };
    marker.badge.text = nasty;

    const view = await mountView({ hass: withImages(), home: edited });

    expect(root(view).querySelector('script')).toBeNull();
    const texts = [...root(view).querySelectorAll(`g[data-element-id="${marker.elementId}"] text`)].map(
      (t) => t.textContent,
    );
    expect(texts).toEqual([nasty, nasty]);
    // The whole drawing is only SVG, no stray HTML elements from the text.
    expect(root(view).querySelectorAll('svg img, svg iframe, svg foreignObject')).toHaveLength(0);
  });

  it('shows a calm message instead of failing when no home is loaded', async () => {
    const view = await mountView({ hass: makeHass(), home: homeResponse({ package: null }) });
    expect(root(view).textContent).toContain('No home loaded yet');
    expect(root(view).querySelector('svg')).toBeNull();

    const none = await mountView({ hass: makeHass(), home: undefined });
    expect(root(none).textContent).toContain('No home loaded yet');
  });
});

describe('levels and plan types', () => {
  it('has a tab per level in sortOrder and switches the drawing', async () => {
    const reversed = structuredClone(homeResponse());
    reversed.package!.levels.reverse();
    const view = await mountView({ hass: withImages(), home: reversed });

    const tabs = [...root(view).querySelectorAll<HTMLButtonElement>('.tabs button')];
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Level 1', 'Level 2']);

    tabs[1]?.click();
    await settle(view);
    expect([...root(view).querySelectorAll('g[data-element-id]')].map((g) => g.getAttribute('data-element-id'))).toEqual(['sen2']);
    expect(root(view).querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 1000 750');
  });

  it('has no toggle when a level draws the same background twice', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    expect(root(view).querySelector('.plan-toggle')).toBeNull();
  });

  it('has a Smart Home | Lighting toggle when the backgrounds differ', async () => {
    const different = structuredClone(homeResponse());
    different.package!.levels[0]!.plans[1]!.background.key = 'page-1|90|0,0,1,1';
    const view = await mountView({ hass: withImages(), home: different });

    const buttons = [...root(view).querySelectorAll<HTMLButtonElement>('.plan-toggle button')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Smart Home', 'Lighting']);
    // Smart Home first: only its elements are drawn.
    expect(group(view, 'sw1')).toBeTruthy();
    expect(root(view).querySelector('g[data-element-id="dl1"]')).toBeNull();

    buttons[1]?.click();
    await settle(view);
    expect(group(view, 'dl1')).toBeTruthy();
    expect(root(view).querySelector('g[data-element-id="sw1"]')).toBeNull();
  });
});

describe('use mode', () => {
  it('does nothing when an unlinked element is tapped', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse() });

    tap(group(view, 'dl2'));
    await settle(view);

    expect(call).not.toHaveBeenCalled();
  });

  it('does nothing for a link to something Home Assistant no longer has', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      home: homeResponse({ links: { dl2: { type: 'entity', id: 'light.gone' } } }),
    });

    tap(group(view, 'dl2'));
    expect(call).not.toHaveBeenCalled();
  });

  it('toggles the entity of a linked switch device', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ links: { sw1: SWITCH_DEVICE } }) });

    tap(group(view, 'sw1'));

    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', {
      entity_id: ['switch.hall'],
    });
  });

  it('opens and closes a cover instead of toggling it', async () => {
    const hass = makeHass({
      states: { 'cover.a': { state: 'closed' }, 'cover.b': { state: 'open' } },
    });
    withImages(hass);
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      home: homeResponse({
        links: { dl1: { type: 'entity', id: 'cover.a' }, dl2: { type: 'entity', id: 'cover.b' } },
      }),
    });

    tap(group(view, 'dl1'));
    tap(group(view, 'dl2'));

    expect(call.mock.calls).toEqual([
      ['cover', 'open_cover', { entity_id: ['cover.a'] }],
      ['cover', 'close_cover', { entity_id: ['cover.b'] }],
    ]);
  });

  it('opens more-info for a sensor, which cannot be toggled', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      home: homeResponse({ links: { sen1: { type: 'entity', id: 'sensor.gang_temp' } } }),
    });
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));

    tap(group(view, 'sen1'));

    expect(call).not.toHaveBeenCalled();
    expect(seen).toEqual([{ entityId: 'sensor.gang_temp' }]);
  });

  it('fires hass-more-info after a 600 ms hold, and does not toggle on release', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ links: { dl1: LIGHT } }) });
    vi.useFakeTimers();
    const seen: { entityId: string }[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));

    pointer(group(view, 'dl1'), 'pointerdown');
    vi.advanceTimersByTime(600);
    pointer(group(view, 'dl1'), 'pointerup');

    expect(seen).toEqual([{ entityId: 'light.kitchen' }]);
    expect(call).not.toHaveBeenCalled();
  });

  it('does not treat a drag that starts on an element as a tap or a hold', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ links: { dl1: LIGHT } }) });
    vi.useFakeTimers();
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push(e));

    pointer(group(view, 'dl1'), 'pointerdown', { x: 100, y: 100 });
    pointer(group(view, 'dl1'), 'pointermove', { x: 160, y: 100 });
    vi.advanceTimersByTime(700);
    pointer(group(view, 'dl1'), 'pointerup', { x: 160, y: 100 });

    expect(call).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('taps and holds on the hit twin of an LED strip act on the strip', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      home: homeResponse({ links: { led1: { type: 'entity', id: 'light.kitchen' } } }),
    });
    const twin = group(view, 'led1').querySelector('path.hit')!;
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));

    tap(twin);
    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', {
      entity_id: ['light.kitchen'],
    });

    vi.useFakeTimers();
    pointer(twin, 'pointerdown');
    vi.advanceTimersByTime(600);
    pointer(twin, 'pointerup');
    expect(seen).toEqual([{ entityId: 'light.kitchen' }]);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('opens a popup with a row per entity for a device with several controls', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      home: homeResponse({ links: { sw1: { type: 'device', id: 'dev-gang' } } }),
    });

    tap(group(view, 'sw1'));
    await settle(view);

    expect(call).not.toHaveBeenCalled();
    const rows = [...root(view).querySelectorAll('.popup .row')];
    // The sensor on the same device is not controllable and gets no row.
    expect(rows.map((r) => r.querySelector('.name')?.textContent)).toEqual(['Left', 'Right']);

    rows[1]?.querySelector<HTMLButtonElement>('button.switch')?.click();
    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', {
      entity_id: ['switch.gang2'],
    });

    root(view).querySelector<HTMLElement>('.popup-backdrop')?.click();
    await settle(view);
    expect(root(view).querySelector('.popup')).toBeNull();
  });
});

describe('link mode', () => {
  it('emits maxsen-element-tap when the hit twin of a line is tapped', async () => {
    const view = await mountView({ hass: withImages(), mode: 'link', home: homeResponse() });
    const taps: unknown[] = [];
    view.addEventListener('maxsen-element-tap', (e) => taps.push((e as CustomEvent).detail));

    tap(group(view, 'cur1').querySelector('path.hit')!);

    expect(taps).toEqual([{ elementId: 'cur1' }]);
  });

  it('emits maxsen-element-tap for any element and calls no service', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      mode: 'link',
      home: homeResponse({ links: { sw1: SWITCH_DEVICE } }),
    });
    const taps: unknown[] = [];
    view.addEventListener('maxsen-element-tap', (e) => taps.push((e as CustomEvent).detail));

    tap(group(view, 'sw1'));
    tap(group(view, 'dl2'));

    expect(taps).toEqual([{ elementId: 'sw1' }, { elementId: 'dl2' }]);
    expect(call).not.toHaveBeenCalled();
  });

  it('ignores notes, which are not elements', async () => {
    const view = await mountView({ hass: withImages(), mode: 'link', home: homeResponse() });
    const taps: unknown[] = [];
    view.addEventListener('maxsen-element-tap', (e) => taps.push(e));

    tap(group(view, 'note1'));

    expect(taps).toEqual([]);
  });

  it('outlines the selected elements with a halo, markers and lines alike', async () => {
    const view = await mountView({
      hass: withImages(),
      mode: 'link',
      selected: ['dl1', 'cur1'],
      home: homeResponse({ links: { dl1: LIGHT, dl2: LIGHT } }),
    });

    for (const id of ['dl1', 'cur1']) {
      expect(group(view, id).classList.contains('selected'), id).toBe(true);
      expect(group(view, id).querySelector('.halo'), id).not.toBeNull();
    }
    expect(group(view, 'dl2').classList.contains('selected')).toBe(false);
    expect(group(view, 'dl2').querySelector('.halo')).toBeNull();

    view.selected = ['dl2'];
    await settle(view);
    expect(group(view, 'dl1').querySelector('.halo')).toBeNull();
    expect(group(view, 'dl2').querySelector('.halo')).not.toBeNull();
  });

  it('draws a dashed ring on unlinked elements, and a red one on a missing device', async () => {
    const view = await mountView({
      hass: withImages(),
      mode: 'link',
      home: homeResponse({ links: { dl1: LIGHT, dl2: { type: 'entity', id: 'light.gone' } } }),
    });

    expect(group(view, 'dl1').querySelector('.link-ring')).toBeNull();
    expect(group(view, 'dl3').querySelector('.link-ring')).not.toBeNull();
    expect(group(view, 'cur1').querySelector('.link-ring')).not.toBeNull();
    const missing = group(view, 'dl2').querySelector('.link-ring');
    expect(missing?.classList.contains('missing')).toBe(true);
    expect(group(view, 'dl3').querySelector('.link-ring')?.classList.contains('missing')).toBe(false);
  });

  it('shows no halo and no rings in use mode', async () => {
    const view = await mountView({
      hass: withImages(),
      mode: 'use',
      selected: ['dl1'],
      home: homeResponse(),
    });

    expect(root(view).querySelector('.halo')).toBeNull();
    expect(root(view).querySelector('.link-ring')).toBeNull();
  });
});

describe('zoom and pan', () => {
  const canvasOf = (view: HTMLElement) => root(view).querySelector<HTMLElement>('.canvas')!;
  const stageOf = (view: HTMLElement) => root(view).querySelector<HTMLElement>('.stage')!;

  it('pinches to zoom, clamped between 1x and 6x', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    const stage = stageOf(view);

    pointer(stage, 'pointerdown', { id: 1, x: 390, y: 300 });
    pointer(stage, 'pointerdown', { id: 2, x: 410, y: 300 });
    pointer(stage, 'pointermove', { id: 2, x: 450, y: 300 });
    expect(canvasOf(view).style.transform).toMatch(/scale\(3\)/);

    pointer(stage, 'pointermove', { id: 2, x: 4000, y: 300 });
    expect(canvasOf(view).style.transform).toMatch(/scale\(6\)/);

    pointer(stage, 'pointermove', { id: 2, x: 395, y: 300 });
    expect(canvasOf(view).style.transform).toMatch(/scale\(1\)/);
    pointer(stage, 'pointerup', { id: 2 });
    pointer(stage, 'pointerup', { id: 1 });
  });

  it('zooms with the wheel and pans by dragging when zoomed in', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    const stage = stageOf(view);

    wheel(stage, -300);
    const zoomed = canvasOf(view).style.transform;
    expect(zoomed).not.toMatch(/scale\(1\)/);

    const before = canvasOf(view).style.transform;
    pointer(stage, 'pointerdown', { x: 400, y: 300 });
    pointer(stage, 'pointermove', { x: 380, y: 300 });
    pointer(stage, 'pointerup', { x: 380, y: 300 });
    expect(canvasOf(view).style.transform).not.toBe(before);
  });

  it('cannot pan when not zoomed in', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    const stage = stageOf(view);

    pointer(stage, 'pointerdown', { x: 400, y: 300 });
    pointer(stage, 'pointermove', { x: 300, y: 200 });
    pointer(stage, 'pointerup', { x: 300, y: 200 });

    expect(canvasOf(view).style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('resets on a double tap of the background', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    const stage = stageOf(view);
    wheel(stage, -500);
    expect(canvasOf(view).style.transform).not.toMatch(/scale\(1\)/);

    tap(stage, 50, 50);
    tap(stage, 52, 51);

    expect(canvasOf(view).style.transform).toBe('translate(0px, 0px) scale(1)');
  });
});

describe('images', () => {
  it('fetches each background with auth and revokes the object URLs on disconnect', async () => {
    const hass = withImages();
    const fetchWithAuth = vi.spyOn(hass, 'fetchWithAuth');
    const view = await mountView({ hass, home: homeResponse() });

    // Only the shown level is loaded.
    expect(fetchWithAuth.mock.calls.map((c) => c[0])).toEqual(['/api/maxsen/image/e1/file-l1']);

    view.remove();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-1');
  });

  it('fetches nothing more when removed, and loads the background again when re-attached', async () => {
    const hass = withImages();
    const fetchWithAuth = vi.spyOn(hass, 'fetchWithAuth');
    const view = await mountView({ hass, home: homeResponse() });
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);

    view.remove();
    await settle(view);
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);

    document.body.append(view);
    await settle(view);
    expect(fetchWithAuth).toHaveBeenCalledTimes(2);
    expect(root(view).querySelector('image')?.getAttribute('href')).toMatch(/^blob:image-/);
  });

  it('revokes an image that arrives after the view was removed', async () => {
    const hass = makeHass();
    let finish: (r: Response) => void = () => undefined;
    vi.spyOn(hass, 'fetchWithAuth').mockReturnValue(new Promise((r) => (finish = r)));
    const view = await mountView({ hass, home: homeResponse() });

    view.remove();
    finish(new Response(new Blob(['png']), { status: 200 }));
    await new Promise((r) => setTimeout(r, 0));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-1');
  });

  it('loads again, and revokes the old image, when the planner refreshed the home', async () => {
    const hass = withImages();
    const view = await mountView({ hass, home: homeResponse() });
    expect(hass.fetchWithAuth).toHaveBeenCalledTimes(1);

    const refreshed: HomeResponse = structuredClone(homeResponse());
    refreshed.package!.exportedAt = '2030-01-01T00:00:00Z';
    view.home = refreshed;
    await settle(view);

    expect(hass.fetchWithAuth).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-1');
  });

  it('does not reload images when only the links changed', async () => {
    const hass = withImages();
    const view = await mountView({ hass, home: homeResponse() });

    view.home = homeResponse({ links: { dl1: LIGHT } });
    await settle(view);

    expect(hass.fetchWithAuth).toHaveBeenCalledTimes(1);
  });

  it('still draws the elements when a background cannot be loaded', async () => {
    const view = await mountView({ hass: makeHass(), home: homeResponse() });
    expect(root(view).querySelectorAll('g[data-element-id]')).toHaveLength(8);
    expect(root(view).querySelector('image')).toBeNull();
  });
});

// Keep the fixture honest: the tests above rely on these ids.
describe('fixture', () => {
  it('has the elements the tests use', () => {
    const ids = (home as HomePackage).levels.flatMap((l) =>
      l.plans.flatMap((p) => p.scene.items.map((i) => i.elementId)),
    );
    expect(ids).toEqual(['sw1', 'sen1', 'cur1', 'note1', 'dl1', 'dl2', 'dl3', 'led1', 'sen2']);
  });
});
