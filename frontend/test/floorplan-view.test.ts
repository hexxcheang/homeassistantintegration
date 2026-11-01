import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/floorplan-view.ts';
import type { HomePackage, HomeResponse, Link } from '../src/types.ts';
import { contentBox } from '../src/view-geometry.ts';
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

const viewBoxOf = (view: HTMLElement): string | null => root(view).querySelector('svg')?.getAttribute('viewBox') ?? null;
const boxString = (b: { x: number; y: number; w: number; h: number }): string => `${b.x} ${b.y} ${b.w} ${b.h}`;
const ids = (view: HTMLElement): (string | null)[] =>
  [...root(view).querySelectorAll('g[data-element-id]')].map((g) => g.getAttribute('data-element-id'));
const buttonsOf = (view: HTMLElement, selector: string) => [...root(view).querySelectorAll<HTMLButtonElement>(selector)];
const buttonLabelled = (view: HTMLElement, label: string): HTMLButtonElement => {
  const found = buttonsOf(view, 'button').find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};
/** The fitted box of what a level draws, from the fixture's own scenes. */
function fittedBox(levelIndex: number, types?: string[]) {
  const level = home.levels[levelIndex]!;
  const plans = level.plans.filter((p) => !types || types.includes(p.type));
  return contentBox(plans.flatMap((p) => p.scene.items), plans[0]!.width, plans[0]!.height);
}

describe('drawing', () => {
  it('draws one group per scene item over one background, fitted to the items', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });

    const ids = [...root(view).querySelectorAll('g[data-element-id]')].map((g) =>
      g.getAttribute('data-element-id'),
    );
    // Level 1 draws the smart-home and the lighting scene together.
    expect(ids).toEqual(['sw1', 'sen1', 'cur1', 'note1', 'dl1', 'dl2', 'dl3', 'led1']);
    expect(viewBoxOf(view)).toBe(boxString(fittedBox(0)));
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
    // The stage is 800 x 600 px in tests; the fitted box sets how many px a plan unit is.
    const box = fittedBox(0);
    const pxPerUnit = Math.min(800 / box.w, 600 / box.h);
    expect(Number(hit?.getAttribute('r')) * pxPerUnit).toBeGreaterThanOrEqual(22 - 0.01);
  });

  it('gives lines (strips, curtains) a hit twin at least 44 CSS px wide', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    for (const id of ['led1', 'cur1']) {
      const twin = group(view, id).querySelector('path.hit');
      expect(twin, id).not.toBeNull();
      expect(twin?.getAttribute('fill')).toBe('none');
      const box = fittedBox(0);
      const pxPerUnit = Math.min(800 / box.w, 600 / box.h);
      expect(Number(twin?.getAttribute('stroke-width')) * pxPerUnit).toBeGreaterThanOrEqual(44 - 0.01);
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
    expect(ids(view)).toEqual(['sen2']);
    expect(viewBoxOf(view)).toBe(boxString(fittedBox(1)));
  });

  it('offers All, Smart Home and Lighting when a level draws one background twice, starting on All', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    const buttons = buttonsOf(view, '.plan-toggle button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['All', 'Smart Home', 'Lighting']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(ids(view)).toEqual(['sw1', 'sen1', 'cur1', 'note1', 'dl1', 'dl2', 'dl3', 'led1']);
  });

  it('has no layer control on a level with one plan', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    buttonLabelled(view, 'Level 2').click();
    await settle(view);
    expect(root(view).querySelector('.plan-toggle')).toBeNull();
  });

  it('draws only the chosen layer, and the other layer cannot be tapped', async () => {
    const view = await mountView({
      hass: withImages(),
      home: homeResponse({ links: { dl1: LIGHT }, installer_mode: true }),
      mode: 'link',
    });
    const taps: string[] = [];
    view.addEventListener('maxsen-element-tap', (e) => taps.push((e as CustomEvent).detail.elementId));

    buttonLabelled(view, 'Smart Home').click();
    await settle(view);
    expect(ids(view)).toEqual(['sw1', 'sen1', 'cur1', 'note1']);
    expect(root(view).querySelector('g[data-element-id="dl1"]')).toBeNull();
    expect(root(view).querySelector('g[data-element-id="led1"]')).toBeNull();
    // Hit areas of the hidden layer are gone too: nothing in the DOM answers to its ids.
    expect(root(view).querySelectorAll('[data-element-id="dl1"], [data-element-id="dl2"], [data-element-id="dl3"]')).toHaveLength(0);

    buttonLabelled(view, 'Lighting').click();
    await settle(view);
    expect(ids(view)).toEqual(['dl1', 'dl2', 'dl3', 'led1']);
    expect(buttonLabelled(view, 'Lighting').getAttribute('aria-pressed')).toBe('true');

    tap(group(view, 'dl2').querySelector('.hit')!);
    expect(taps).toEqual(['dl2']);

    buttonLabelled(view, 'All').click();
    await settle(view);
    expect(ids(view)).toHaveLength(8);
  });

  it('fits the view to the chosen layer', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    buttonLabelled(view, 'Smart Home').click();
    await settle(view);
    expect(viewBoxOf(view)).toBe(boxString(fittedBox(0, ['smart-home'])));
    buttonLabelled(view, 'Lighting').click();
    await settle(view);
    expect(viewBoxOf(view)).toBe(boxString(fittedBox(0, ['lighting'])));
    expect(fittedBox(0, ['smart-home'])).not.toEqual(fittedBox(0, ['lighting']));
  });

  it('has only Smart Home | Lighting when the backgrounds differ', async () => {
    const different = structuredClone(homeResponse());
    different.package!.levels[0]!.plans[1]!.background.key = 'page-1|90|0,0,1,1';
    const view = await mountView({ hass: withImages(), home: different });

    const buttons = buttonsOf(view, '.plan-toggle button');
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

describe('background', () => {
  const filterOf = (view: HTMLElement) => root(view).querySelector('image')?.getAttribute('filter') ?? null;
  const idOf = (reference: string | null) => /^url\(#(.+)\)$/.exec(reference ?? '')?.[1];

  it('softens the background image with an SVG filter when the display setting is soft', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse({ display: { background: 'soft' } }) });
    const image = root(view).querySelector('image')!;
    expect(image.classList.contains('soft')).toBe(true);
    // An SVG filter, not a CSS one: WebKit ignores CSS filter functions on SVG children.
    const id = idOf(filterOf(view));
    expect(id).toBeTruthy();
    const filter = root(view).querySelector(`filter[id="${id}"]`);
    expect(filter).not.toBeNull();
    expect(filter?.querySelector('feColorMatrix')?.getAttribute('type')).toBe('saturate');
    expect(filter?.querySelector('feColorMatrix')?.getAttribute('values')).toBe('0');
    expect(filter?.querySelector('feComponentTransfer feFuncR')?.getAttribute('type')).toBe('linear');
  });

  it('shows the background as drawn when the display setting is original', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse({ display: { background: 'original' } }) });
    expect(root(view).querySelector('image')).not.toBeNull();
    expect(root(view).querySelector('image')?.classList.contains('soft')).toBe(false);
    expect(root(view).querySelector('image')?.hasAttribute('filter')).toBe(false);
  });

  it('gives every view its own filter id, so several cards on one dashboard do not clash', async () => {
    const a = await mountView({ hass: withImages(), home: homeResponse() });
    const b = await mountView({ hass: withImages(), home: homeResponse() });
    expect(idOf(filterOf(a))).toBeTruthy();
    expect(idOf(filterOf(a))).not.toBe(idOf(filterOf(b)));
  });
});

describe('fitted view', () => {
  it('switches to the whole drawing and back with one button', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    expect(viewBoxOf(view)).not.toBe('0 0 1000 1000');

    buttonLabelled(view, 'Whole drawing').click();
    await settle(view);
    expect(viewBoxOf(view)).toBe('0 0 1000 1000');

    buttonLabelled(view, 'Fit to rooms').click();
    await settle(view);
    expect(viewBoxOf(view)).toBe(boxString(fittedBox(0)));
    expect(buttonLabelled(view, 'Whole drawing')).toBeTruthy();
  });

  it('starts each level on its own fitted box', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    buttonLabelled(view, 'Whole drawing').click();
    await settle(view);
    buttonLabelled(view, 'Level 2').click();
    await settle(view);
    expect(viewBoxOf(view)).toBe(boxString(fittedBox(1)));
  });

  it('returns to the fitted box on a double tap, also from the whole drawing', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    buttonLabelled(view, 'Whole drawing').click();
    await settle(view);
    expect(viewBoxOf(view)).toBe('0 0 1000 1000');

    const stage = root(view).querySelector<HTMLElement>('.stage')!;
    tap(stage, 50, 50);
    tap(stage, 52, 51);
    await settle(view);
    expect(viewBoxOf(view)).toBe(boxString(fittedBox(0)));
    expect(root(view).querySelector<HTMLElement>('.canvas')!.style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('shows the whole drawing, never an empty box, for a level with nothing placed', async () => {
    const empty = structuredClone(homeResponse());
    for (const plan of empty.package!.levels[0]!.plans) {
      plan.scene.items = [];
      plan.elements = [];
    }
    const view = await mountView({ hass: withImages(), home: empty });
    expect(viewBoxOf(view)).toBe('0 0 1000 1000');
    // Nothing to fit, so no button to press.
    expect(buttonsOf(view, 'button').some((b) => b.textContent?.trim() === 'Whole drawing')).toBe(false);
  });

  it('keeps the 1x-6x zoom limits relative to the fitted box', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    const stage = root(view).querySelector<HTMLElement>('.stage')!;
    wheel(stage, -100000);
    expect(root(view).querySelector<HTMLElement>('.canvas')!.style.transform).toMatch(/scale\(6\)/);
    wheel(stage, 100000);
    expect(root(view).querySelector<HTMLElement>('.canvas')!.style.transform).toMatch(/scale\(1\)/);
    expect(viewBoxOf(view)).toBe(boxString(fittedBox(0)));
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

  describe('a 2-gang switch with a config backlight and child lock', () => {
    function tuyaHass() {
      return withImages(
        makeHass({
          devices: { 'dev-tuya': { name: 'Tuya switch' } },
          entities: {
            'switch.gang1': { device_id: 'dev-tuya' },
            'switch.gang2': { device_id: 'dev-tuya' },
            'switch.backlight': { device_id: 'dev-tuya', entity_category: 'config' },
            'lock.child_lock': { device_id: 'dev-tuya', entity_category: 'config' },
          },
          states: {
            'switch.gang1': { state: 'off', attributes: { friendly_name: 'Left' } },
            'switch.gang2': { state: 'off', attributes: { friendly_name: 'Right' } },
            'switch.backlight': { state: 'on', attributes: { friendly_name: 'Backlight' } },
            'lock.child_lock': { state: 'unlocked', attributes: { friendly_name: 'Child lock' } },
          },
        }),
      );
    }
    const TUYA = { sw1: { type: 'device', id: 'dev-tuya' } as Link };

    it('draws the switch off while only the backlight is on', async () => {
      const view = await mountView({ hass: tuyaHass(), home: homeResponse({ links: TUYA }) });
      expect(group(view, 'sw1').classList.contains('off')).toBe(true);
      expect(group(view, 'sw1').classList.contains('on')).toBe(false);
    });

    it('lists only the gangs in the popup', async () => {
      const view = await mountView({ hass: tuyaHass(), home: homeResponse({ links: TUYA }) });
      tap(group(view, 'sw1'));
      await settle(view);
      const rows = [...root(view).querySelectorAll('.popup .row')];
      expect(rows.map((r) => r.querySelector('.name')?.textContent)).toEqual(['Left', 'Right']);
    });

    it('opens a gang, not the child lock, on a hold', async () => {
      const view = await mountView({ hass: tuyaHass(), home: homeResponse({ links: TUYA }) });
      vi.useFakeTimers();
      const seen: { entityId: string }[] = [];
      view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
      pointer(group(view, 'sw1'), 'pointerdown');
      vi.advanceTimersByTime(600);
      pointer(group(view, 'sw1'), 'pointerup');
      expect(seen).toEqual([{ entityId: 'switch.gang1' }]);
    });
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
