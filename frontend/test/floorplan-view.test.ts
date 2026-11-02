import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaxsenFloorplanView } from '../src/floorplan-view.ts';
import type { HomePackage, HomeResponse, Link, ScenePath, StoredHomePackage } from '../src/types.ts';
import { contentBox } from '../src/view-geometry.ts';
import { home, makeHass } from './helpers.ts';
import { STAGE, group, homeResponse, mountView, planPoint, pointer, elementPoint, pressElement, releaseElement, root, settle, stageOf, tap, tapElement, wheel } from './view-helpers.ts';

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

  it('makes every marker at least 44 CSS px to hit, and no wider than that at 1x', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ links: { dl1: LIGHT } }) });

    tapElement(view, 'dl1', 0, 21);
    expect(call).toHaveBeenCalledTimes(1);
    tapElement(view, 'dl1', 23, 0);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('draws no hit areas of its own: touch is resolved from the geometry', async () => {
    const view = await mountView({ hass: withImages(), home: homeResponse() });
    expect(root(view).querySelectorAll('.hit')).toHaveLength(0);
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

    tapElement(view, 'dl2');
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

    tapElement(view, 'dl2');
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

    tapElement(view, 'dl2');
    expect(call).not.toHaveBeenCalled();
  });

  it('toggles the entity of a linked switch device', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ links: { sw1: SWITCH_DEVICE } }) });

    tapElement(view, 'sw1');

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

    tapElement(view, 'dl1');
    tapElement(view, 'dl2');

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

    tapElement(view, 'sen1');

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

    pressElement(view, 'dl1');
    vi.advanceTimersByTime(600);
    releaseElement(view, 'dl1');

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

    pressElement(view, 'dl1');
    const at = elementPoint(view, 'dl1');
    pointer(stageOf(view), 'pointermove', { x: at.x + 60, y: at.y });
    vi.advanceTimersByTime(700);
    pointer(stageOf(view), 'pointerup', { x: at.x + 60, y: at.y });

    expect(call).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('taps and holds anywhere along the hit stroke of an LED strip act on the strip', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      home: homeResponse({ links: { led1: { type: 'entity', id: 'light.kitchen' } } }),
    });
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));

    tapElement(view, 'led1');
    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', {
      entity_id: ['light.kitchen'],
    });
    // Within the 22 px half-width beside the line, not 30 px away.
    tapElement(view, 'led1', 0, 20);
    expect(call).toHaveBeenCalledTimes(2);
    tapElement(view, 'led1', 0, 30);
    expect(call).toHaveBeenCalledTimes(2);

    vi.useFakeTimers();
    pressElement(view, 'led1');
    vi.advanceTimersByTime(600);
    releaseElement(view, 'led1');
    expect(seen).toEqual([{ entityId: 'light.kitchen' }]);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('opens a popup with a row per entity for a device with several controls', async () => {
    const hass = withImages();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      home: homeResponse({ links: { sw1: { type: 'device', id: 'dev-gang' } } }),
    });

    tapElement(view, 'sw1');
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
      tapElement(view, 'sw1');
      await settle(view);
      const rows = [...root(view).querySelectorAll('.popup .row')];
      expect(rows.map((r) => r.querySelector('.name')?.textContent)).toEqual(['Left', 'Right']);
    });

    it('opens a gang, not the child lock, on a hold', async () => {
      const view = await mountView({ hass: tuyaHass(), home: homeResponse({ links: TUYA }) });
      vi.useFakeTimers();
      const seen: { entityId: string }[] = [];
      view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
      pressElement(view, 'sw1');
      vi.advanceTimersByTime(600);
      releaseElement(view, 'sw1');
      expect(seen).toEqual([{ entityId: 'switch.gang1' }]);
    });
  });
});

describe('link mode', () => {
  it('emits maxsen-element-tap when a line is tapped', async () => {
    const view = await mountView({ hass: withImages(), mode: 'link', home: homeResponse() });
    const taps: unknown[] = [];
    view.addEventListener('maxsen-element-tap', (e) => taps.push((e as CustomEvent).detail));

    tapElement(view, 'cur1');

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

    tapElement(view, 'sw1');
    tapElement(view, 'dl2');

    expect(taps).toEqual([{ elementId: 'sw1' }, { elementId: 'dl2' }]);
    expect(call).not.toHaveBeenCalled();
  });

  it('ignores notes, which are not elements', async () => {
    const view = await mountView({ hass: withImages(), mode: 'link', home: homeResponse() });
    const taps: unknown[] = [];
    view.addEventListener('maxsen-element-tap', (e) => taps.push(e));

    tapElement(view, 'note1');

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

  it('draws a pulsing ring on the current element, a marker or a line, and on no other', async () => {
    const view = await mountView({
      hass: withImages(),
      mode: 'link',
      current: 'dl1',
      home: homeResponse({ links: { dl1: LIGHT } }),
    });
    const ring = group(view, 'dl1').querySelector('.current-ring');
    expect(ring?.tagName.toLowerCase()).toBe('circle');
    expect(group(view, 'dl1').classList.contains('current')).toBe(true);
    expect(group(view, 'dl2').querySelector('.current-ring')).toBeNull();

    view.current = 'led1';
    await settle(view);
    expect(group(view, 'dl1').querySelector('.current-ring')).toBeNull();
    expect(group(view, 'led1').querySelector('.current-ring')?.tagName.toLowerCase()).toBe('path');

    view.current = undefined;
    await settle(view);
    expect(root(view).querySelector('.current-ring')).toBeNull();
  });

  it('does not pulse when the user prefers reduced motion', () => {
    const css = (customElements.get('maxsen-floorplan-view') as unknown as { styles: { cssText: string } })
      .styles.cssText;
    expect(css).toMatch(/prefers-reduced-motion[^{]*\{[\s\S]*\.current-ring[\s\S]*animation:\s*none/);
  });

  it('shows the level and layer the current element is on', async () => {
    const view = await mountView({
      hass: withImages(),
      mode: 'link',
      home: homeResponse(),
    });
    buttonLabelled(view, 'Smart Home').click();
    await settle(view);
    expect(ids(view)).not.toContain('dl1');

    view.current = 'dl1'; // a light, while only Smart Home is shown
    await settle(view);
    expect(ids(view)).toContain('dl1');
    expect(buttonLabelled(view, 'All').getAttribute('aria-pressed')).toBe('true');

    view.current = 'sen2'; // on Level 2
    await settle(view);
    expect(buttonLabelled(view, 'Level 2').getAttribute('aria-selected')).toBe('true');
    expect(ids(view)).toEqual(['sen2']);

    // The installer going back to look at another level is not undone until the current element changes.
    buttonLabelled(view, 'Level 1').click();
    await settle(view);
    expect(buttonLabelled(view, 'Level 1').getAttribute('aria-selected')).toBe('true');
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

// ---- readings beside devices ----

const SENSOR_LINKS: Record<string, Link> = { sen1: { type: 'entity', id: 'sensor.temp' }, sw1: { type: 'entity', id: 'switch.hall' } };

function sensorHass() {
  return withImages(
    makeHass({
      states: {
        'sensor.temp': { state: '24', attributes: { unit_of_measurement: '°C' } },
        'switch.hall': { state: 'off' },
      },
    }),
  );
}

describe('readings and labels beside devices', () => {
  // sen1 is a sensor at (420, 150), 20 units across: its reading pill ("24 °C") runs from x 436 to
  // about 505, centred on y 150 and 24 units high. Its middle is far outside the marker's own 22 px.
  const PILL_MIDDLE = { x: 470, y: 150 };

  it('I1: a tap on the reading pill operates the device, as a tap on the marker does', async () => {
    const hass = sensorHass();
    const view = await mountView({ hass, home: homeResponse({ links: SENSOR_LINKS }) });
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
    expect(group(view, 'sen1').querySelector('.pill text')?.textContent).toBe('24 °C');

    const at = planPoint(view, PILL_MIDDLE.x, PILL_MIDDLE.y);
    expect(Math.hypot(at.x - elementPoint(view, 'sen1').x, at.y - elementPoint(view, 'sen1').y)).toBeGreaterThan(30);
    tap(stageOf(view), at.x, at.y);
    await settle(view);

    expect(seen).toEqual([{ entityId: 'sensor.temp' }]);
    expect(picker(view)).toBeNull();
  });

  it('I1: holding the reading pill opens the details, and a release afterwards does not tap', async () => {
    const view = await mountView({ hass: sensorHass(), home: homeResponse({ links: SENSOR_LINKS }) });
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
    const at = planPoint(view, PILL_MIDDLE.x, PILL_MIDDLE.y);
    vi.useFakeTimers();

    pointer(stageOf(view), 'pointerdown', at);
    vi.advanceTimersByTime(600);
    expect(seen).toEqual([{ entityId: 'sensor.temp' }]);
    pointer(stageOf(view), 'pointerup', at);

    expect(seen).toHaveLength(1);
  });

  it('I1: the pill stays tappable zoomed in, where the marker is far away', async () => {
    const view = await mountView({ hass: sensorHass(), home: homeResponse({ links: SENSOR_LINKS }) });
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
    const c = elementPoint(view, 'sen1');
    wheel(stageOf(view), -800, c.x, c.y);
    await settle(view);

    const at = planPoint(view, PILL_MIDDLE.x, PILL_MIDDLE.y);
    tap(stageOf(view), at.x, at.y);

    expect(seen).toEqual([{ entityId: 'sensor.temp' }]);
  });

  it('I1: just past the pill is still the empty drawing', async () => {
    const view = await mountView({ hass: sensorHass(), home: homeResponse({ links: SENSOR_LINKS }) });
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));

    // 30 units right of the pill's end and 40 units below it: nothing there.
    const at = planPoint(view, 540, 190);
    tap(stageOf(view), at.x, at.y);

    expect(seen).toEqual([]);
  });

  it('I1: a tap on the end of a marker\'s label operates its device', async () => {
    const hass = sensorHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ links: SENSOR_LINKS }) });

    // "Entrance switch" is centred under sw1 at (180, 240) and about 87 units wide: this is its left end,
    // well outside the marker's circle.
    const at = planPoint(view, 180 - 38, 240);
    expect(Math.hypot(at.x - elementPoint(view, 'sw1').x, at.y - elementPoint(view, 'sw1').y)).toBeGreaterThan(30);
    tap(stageOf(view), at.x, at.y);
    await settle(view);

    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['switch.hall'] });
  });

  describe('N2: a device drawn under another device\'s reading pill', () => {
    // The sensor's pill ("24 °C", sen1 stands in for the aircon) runs from x 436 to about 505 at y 150.
    // The switch sw1 (the camera) is moved to (490, 150): its drawn 20 units sit under the pill's end,
    // 70 units from the sensor's own marker, so that marker's touch circle does not reach it.
    const underPill = (): StoredHomePackage => {
      const pkg = structuredClone(homeResponse().package as StoredHomePackage);
      const sw1 = pkg.levels[0]!.plans[0]!.scene.items.find((i) => i.elementId === 'sw1')!;
      if (sw1.type !== 'marker') throw new Error('sw1 should be a marker');
      Object.assign(sw1, { x: 490, y: 150 });
      return pkg;
    };

    it('a tap on the camera icon acts on the camera directly, not on the aircon whose pill covers it', async () => {
      const hass = sensorHass();
      const call = vi.spyOn(hass, 'callService');
      const view = await mountView({ hass, home: homeResponse({ package: underPill(), links: SENSOR_LINKS }) });
      const seen: unknown[] = [];
      view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));

      tapElement(view, 'sw1');
      await settle(view);

      expect(picker(view)).toBeNull();
      expect(seen).toEqual([]);
      expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['switch.hall'] });
    });

    it('a tap on the pill away from the camera icon acts on the aircon', async () => {
      const hass = sensorHass();
      const call = vi.spyOn(hass, 'callService');
      const view = await mountView({ hass, home: homeResponse({ package: underPill(), links: SENSOR_LINKS }) });
      const seen: unknown[] = [];
      view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));

      const at = planPoint(view, 450, 150);
      tap(stageOf(view), at.x, at.y);
      await settle(view);

      expect(picker(view)).toBeNull();
      expect(seen).toEqual([{ entityId: 'sensor.temp' }]);
      expect(call).not.toHaveBeenCalled();
    });

    it('beside the camera icon, outside its drawing but inside its touch circle and the pill, it is still a choice, the pill\'s owner first', async () => {
      const view = await mountView({ hass: sensorHass(), home: homeResponse({ package: underPill(), links: SENSOR_LINKS }) });
      const c = elementPoint(view, 'sw1');
      // Marker radius 10 units = about 6 px here; 12 px along the pill is past it and inside 22 px.
      tap(stageOf(view), c.x - 12, c.y);
      await settle(view);

      expect(rowTexts(view).map((r) => r[0])).toEqual(['Door/Window Sensor', 'Entrance switch']);
    });

    it('holding the camera icon opens its details directly', async () => {
      const view = await mountView({ hass: sensorHass(), home: homeResponse({ package: underPill(), links: SENSOR_LINKS }) });
      const seen: unknown[] = [];
      view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
      vi.useFakeTimers();

      pressElement(view, 'sw1');
      vi.advanceTimersByTime(600);

      expect(picker(view)).toBeNull();
      expect(seen).toEqual([{ entityId: 'switch.hall' }]);
    });
  });
});

// ---- overlapping devices ----

/**
 * The fixture's Level 1 with a cluster drawn at (cx, cy): switch `sw1`, a second switch `sw2` 30
 * units to its right, a downlight `dl1` drawn over the first switch (6 units from its centre, inside its 20-unit
 * drawing) and an LED strip `led1` running 20 units below it. The two markers are drawn over each
 * other and the strip's touch area (22 px, about 26 units) reaches them, as in the system test
 * where lighting sat on top of the smart-home devices.
 */
function clusterPackage(cx = 180, cy = 220): StoredHomePackage {
  const pkg = structuredClone(homeResponse().package as StoredHomePackage);
  const [sh, lt] = pkg.levels[0]!.plans;
  const sw1 = sh!.scene.items.find((i) => i.elementId === 'sw1')!;
  if (sw1.type !== 'marker') throw new Error('sw1 should be a marker');
  Object.assign(sw1, { x: cx, y: cy });
  sh!.scene.items.push({ ...sw1, elementId: 'sw2', x: cx + 30, label: { ...sw1.label!, text: 'Hall switch', x: cx + 30 } });
  sh!.elements.push({ ...sh!.elements.find((e) => e.id === 'sw1')!, id: 'sw2', label: 'Hall switch' });
  const dl1 = lt!.scene.items.find((i) => i.elementId === 'dl1')!;
  Object.assign(dl1, { x: cx + 5, y: cy + 3 });
  const led1 = lt!.scene.items.find((i) => i.elementId === 'led1') as ScenePath;
  led1.points = [{ x: cx - 80, y: cy + 20 }, { x: cx + 80, y: cy + 20 }];
  led1.d = `M${cx - 80} ${cy + 20} L${cx + 80} ${cy + 20}`;
  return pkg;
}

const CLUSTER_LINKS: Record<string, Link> = {
  sw1: { type: 'entity', id: 'switch.hall' },
  sw2: { type: 'entity', id: 'switch.gang1' },
  dl1: { type: 'entity', id: 'light.kitchen' },
  led1: { type: 'entity', id: 'light.strip' },
};

function clusterHass(extra: Record<string, { state: string; attributes?: Record<string, unknown> }> = {}) {
  return withImages(
    makeHass({
      states: {
        'switch.hall': { state: 'off' },
        'switch.gang1': { state: 'on' },
        'light.kitchen': { state: 'on' },
        'light.strip': { state: 'off' },
        ...extra,
      },
    }),
  );
}

const picker = (view: HTMLElement) => root(view).querySelector<HTMLElement>('.picker');
const pickRows = (view: HTMLElement) => [...root(view).querySelectorAll<HTMLButtonElement>('.picker .pick')];
const rowTexts = (view: HTMLElement) =>
  pickRows(view).map((r) => [r.querySelector('.pick-name')?.textContent, r.querySelector('.pick-state')?.textContent]);
const rowNamed = (view: HTMLElement, name: string): HTMLButtonElement => {
  const row = pickRows(view).find((r) => r.querySelector('.pick-name')?.textContent === name);
  if (!row) throw new Error(`No picker row "${name}"`);
  return row;
};
/**
 * Taps the cluster's downlight and LED strip where neither is drawn (the point is 11 units from the
 * downlight's centre, past its 10-unit drawing, and 6 from the strip, past its 3-unit stroke) but
 * both touch circles reach: a choice, not a direct tap.
 */
function tapBetweenLights(view: MaxsenFloorplanView): void {
  const at = planPoint(view, 185, 234);
  tap(stageOf(view), at.x, at.y);
}
const key = (target: EventTarget, k: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true }));

describe('overlapping devices (the picker)', () => {
  it('B3: a tap on a switch under a downlight and an LED strip lists all three, nearest first, and acts on none', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });
    expect(buttonLabelled(view, 'All').getAttribute('aria-pressed')).toBe('true');

    tapElement(view, 'sw1');
    await settle(view);

    expect(picker(view)?.getAttribute('role')).toBe('dialog');
    expect(rowTexts(view)).toEqual([
      ['Entrance switch', 'Off'],
      ['Luna Downlight', 'On'],
      ['Lumi Cove Strip', 'Off'],
    ]);
    expect(call).not.toHaveBeenCalled();
  });

  it('B3: the switch and the downlight drawn over each other head the list at their own centres, and nothing acts until one is chosen', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });
    const first = { sw1: 'Entrance switch', dl1: 'Luna Downlight' };

    for (const [id, name] of Object.entries(first)) {
      tapElement(view, id);
      await settle(view);
      expect(pickRows(view)[0]?.querySelector('.pick-name')?.textContent, id).toBe(name);
      // Both drawn markers hold the point, so they come first; the strip's touch circle reaches it too.
      expect(pickRows(view).slice(0, 2).map((r) => r.querySelector('.pick-name')?.textContent).sort(), id).toEqual([
        'Entrance switch',
        'Luna Downlight',
      ]);
      expect(pickRows(view).length, id).toBeGreaterThanOrEqual(3);
      key(window, 'Escape');
      await settle(view);
      expect(picker(view)).toBeNull();
    }
    expect(call).not.toHaveBeenCalled();
  });

  it('N2: the middle of the LED strip, where only its own stroke is drawn, acts on the strip directly', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });

    tapElement(view, 'led1');
    await settle(view);

    expect(picker(view)).toBeNull();
    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['light.strip'] });
  });

  it('choosing a row acts on that device only, as a tap would, and closes the picker', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });

    tapElement(view, 'sw1');
    await settle(view);
    rowNamed(view, 'Lumi Cove Strip').click();
    await settle(view);

    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['light.strip'] });
    expect(picker(view)).toBeNull();
  });

  it('N1: the click that follows the tap that opened the picker, landing on a row, chooses nothing; a fresh press on a row does', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });

    // The real touch sequence: pointerdown/pointerup on the stage open the picker ...
    tapElement(view, 'sw1');
    await settle(view);
    expect(picker(view)).not.toBeNull();
    // ... then the browser delivers the tap's click, at the same spot, to whatever is there now: a row.
    const ghost = new MouseEvent('click', { detail: 1, bubbles: true, composed: true, cancelable: true });
    rowNamed(view, 'Lumi Cove Strip').dispatchEvent(ghost);
    await settle(view);

    expect(picker(view)).not.toBeNull();
    expect(call).not.toHaveBeenCalled();

    // A new press that starts on a row, then its click, is a choice.
    const row = rowNamed(view, 'Lumi Cove Strip');
    pointer(row, 'pointerdown');
    pointer(row, 'pointerup');
    row.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true, composed: true, cancelable: true }));
    await settle(view);

    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['light.strip'] });
    expect(picker(view)).toBeNull();
  });

  it('N1: a press that started on one row and clicks another chooses neither', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });

    tapElement(view, 'sw1');
    await settle(view);
    pointer(rowNamed(view, 'Luna Downlight'), 'pointerdown');
    rowNamed(view, 'Lumi Cove Strip').dispatchEvent(
      new MouseEvent('click', { detail: 1, bubbles: true, composed: true, cancelable: true }),
    );
    await settle(view);

    expect(call).not.toHaveBeenCalled();
    expect(picker(view)).not.toBeNull();
  });

  it('N1: a stale press on a row does not carry over into the next picker', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });

    tapElement(view, 'sw1');
    await settle(view);
    pointer(rowNamed(view, 'Lumi Cove Strip'), 'pointerdown');
    key(window, 'Escape');
    await settle(view);
    tapElement(view, 'sw1');
    await settle(view);
    rowNamed(view, 'Lumi Cove Strip').dispatchEvent(
      new MouseEvent('click', { detail: 1, bubbles: true, composed: true, cancelable: true }),
    );
    await settle(view);

    expect(call).not.toHaveBeenCalled();
    expect(picker(view)).not.toBeNull();
  });

  it('N1: the keyboard (a click with no pointer, detail 0) still chooses a row', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });

    tapElement(view, 'sw1');
    await settle(view);
    rowNamed(view, 'Lumi Cove Strip').dispatchEvent(
      new MouseEvent('click', { detail: 0, bubbles: true, composed: true, cancelable: true }),
    );
    await settle(view);

    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['light.strip'] });
  });

  it('Review Focus 4: a tap exactly between two touching switches lists both, and choosing one toggles only that one', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });
    buttonLabelled(view, 'Smart Home').click();
    await settle(view);
    const a = elementPoint(view, 'sw1');
    const b = elementPoint(view, 'sw2');

    tap(stageOf(view), (a.x + b.x) / 2, (a.y + b.y) / 2);
    await settle(view);

    expect(pickRows(view).map((r) => r.querySelector('.pick-name')?.textContent).sort()).toEqual([
      'Entrance switch',
      'Hall switch',
    ]);
    expect(call).not.toHaveBeenCalled();
    rowNamed(view, 'Hall switch').click();
    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['switch.gang1'] });
  });

  it('Review Focus 4: a tap on one isolated marker acts directly, with no picker', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      home: homeResponse({ package: clusterPackage(), links: { ...CLUSTER_LINKS, dl2: { type: 'entity', id: 'light.kitchen' } } }),
    });

    tapElement(view, 'dl2');
    await settle(view);

    expect(picker(view)).toBeNull();
    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['light.kitchen'] });
  });

  it('a layer that is not shown is never hit: Smart Home acts on the switch alone, Lighting lists only lights', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });

    buttonLabelled(view, 'Smart Home').click();
    await settle(view);
    tapElement(view, 'sw1');
    await settle(view);
    expect(picker(view)).toBeNull();
    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['switch.hall'] });

    buttonLabelled(view, 'Lighting').click();
    await settle(view);
    tapBetweenLights(view);
    await settle(view);
    expect(rowTexts(view).map((r) => r[0]).sort()).toEqual(['Lumi Cove Strip', 'Luna Downlight']);
  });

  it('opens the picker on a hold of a cluster, and choosing a row opens more-info, not a toggle', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
    vi.useFakeTimers();

    pressElement(view, 'sw1');
    vi.advanceTimersByTime(600);
    releaseElement(view, 'sw1');
    await view.updateComplete;

    expect(rowTexts(view).map((r) => r[0])).toEqual(['Entrance switch', 'Luna Downlight', 'Lumi Cove Strip']);
    expect(seen).toEqual([]);
    rowNamed(view, 'Luna Downlight').click();
    await view.updateComplete;

    expect(seen).toEqual([{ entityId: 'light.kitchen' }]);
    expect(call).not.toHaveBeenCalled();
    expect(picker(view)).toBeNull();
  });

  it('M1: a finger that drifts after a hold has opened the picker does not pan the drawing under it', async () => {
    const view = await mountView({ hass: clusterHass(), home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });
    const c = elementPoint(view, 'sw1');
    wheel(stageOf(view), -300, c.x, c.y);
    await settle(view);
    const canvas = stageOf(view).querySelector<HTMLElement>('.canvas')!;
    const zoomed = canvas.style.transform;
    expect(zoomed).toMatch(/scale\(1\.[3-9]/);
    vi.useFakeTimers();

    const at = elementPoint(view, 'sw1');
    pointer(stageOf(view), 'pointerdown', at);
    vi.advanceTimersByTime(600);
    await view.updateComplete;
    expect(picker(view)).not.toBeNull();
    pointer(stageOf(view), 'pointermove', { x: at.x + 30, y: at.y + 20 });
    pointer(stageOf(view), 'pointermove', { x: at.x + 60, y: at.y + 40 });
    await view.updateComplete;

    expect(canvas.style.transform).toBe(zoomed);
    expect(picker(view)).not.toBeNull();
    pointer(stageOf(view), 'pointerup', { x: at.x + 60, y: at.y + 40 });
    expect(canvas.style.transform).toBe(zoomed);
  });

  it('M1: a drag that starts on empty drawing or before the hold still pans', async () => {
    const view = await mountView({ hass: clusterHass(), home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });
    const c = elementPoint(view, 'sw1');
    wheel(stageOf(view), -300, c.x, c.y);
    await settle(view);
    const canvas = stageOf(view).querySelector<HTMLElement>('.canvas')!;
    const zoomed = canvas.style.transform;
    vi.useFakeTimers();

    const at = elementPoint(view, 'sw1');
    pointer(stageOf(view), 'pointerdown', at);
    pointer(stageOf(view), 'pointermove', { x: at.x + 30, y: at.y });
    vi.advanceTimersByTime(600);
    await view.updateComplete;

    expect(canvas.style.transform).not.toBe(zoomed);
    expect(picker(view)).toBeNull();
  });

  it('in link mode, a tap on a cluster opens the picker and choosing emits maxsen-element-tap for that id', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      mode: 'link',
      home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }),
    });
    const taps: unknown[] = [];
    view.addEventListener('maxsen-element-tap', (e) => taps.push((e as CustomEvent).detail));

    tapElement(view, 'sw1');
    await settle(view);
    expect(taps).toEqual([]);
    rowNamed(view, 'Lumi Cove Strip').click();
    await settle(view);

    expect(taps).toEqual([{ elementId: 'led1' }]);
    expect(call).not.toHaveBeenCalled();
    expect(picker(view)).toBeNull();
  });

  it('I3: in use mode an unlinked device is not touchable: a switch beside one is operated at once, with no picker', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      home: homeResponse({ package: clusterPackage(), links: { sw1: CLUSTER_LINKS['sw1'] as Link } }),
    });
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push(e));

    // The downlight drawn over the switch and the LED strip under it are not linked; they do nothing.
    tapElement(view, 'sw1');
    await settle(view);

    expect(picker(view)).toBeNull();
    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['switch.hall'] });
    expect(seen).toEqual([]);
  });

  it('I3: nor is a device whose link points at something that is gone', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      home: homeResponse({
        package: clusterPackage(),
        links: { sw1: CLUSTER_LINKS['sw1'] as Link, dl1: { type: 'entity', id: 'light.deleted' }, led1: { type: 'device', id: 'dev-gone' } },
      }),
    });
    expect(group(view, 'dl1').classList.contains('missing')).toBe(true);

    tapElement(view, 'sw1');
    await settle(view);

    expect(picker(view)).toBeNull();
    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['switch.hall'] });
  });

  it('I3: a hold on a cluster lists only the devices that have details to show', async () => {
    const hass = clusterHass();
    const view = await mountView({
      hass,
      home: homeResponse({ package: clusterPackage(), links: { sw1: CLUSTER_LINKS['sw1'] as Link, dl1: CLUSTER_LINKS['dl1'] as Link } }),
    });
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
    vi.useFakeTimers();

    pressElement(view, 'sw1');
    vi.advanceTimersByTime(600);
    await view.updateComplete;

    // led1 is unlinked and left out: sw1 and dl1 remain.
    expect(rowTexts(view).map((r) => r[0])).toEqual(['Entrance switch', 'Luna Downlight']);
    expect(seen).toEqual([]);
  });

  it('I3: an unavailable device is skipped by a tap, so the working one beside it is operated; a hold still shows its details', async () => {
    const hass = clusterHass({ 'light.kitchen': { state: 'unavailable' } });
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      home: homeResponse({ package: clusterPackage(), links: { sw1: CLUSTER_LINKS['sw1'] as Link, dl1: CLUSTER_LINKS['dl1'] as Link } }),
    });
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
    expect(group(view, 'dl1').classList.contains('unavailable')).toBe(true);

    tapElement(view, 'sw1');
    await settle(view);
    expect(picker(view)).toBeNull();
    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['switch.hall'] });

    // Held, the pair is a choice again: the unavailable one has details (its last state) to open.
    vi.useFakeTimers();
    pressElement(view, 'sw1');
    vi.advanceTimersByTime(600);
    await view.updateComplete;
    expect(rowTexts(view)).toEqual([['Entrance switch', 'Off'], ['Luna Downlight', 'Unavailable']]);
    rowNamed(view, 'Luna Downlight').click();
    expect(seen).toEqual([{ entityId: 'light.kitchen' }]);
  });

  it('I3: a tap on an unavailable device alone does nothing, not even a double-tap reset', async () => {
    const hass = clusterHass({ 'light.kitchen': { state: 'unavailable' } });
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: { dl1: CLUSTER_LINKS['dl1'] as Link } }) });
    const seen: unknown[] = [];
    view.addEventListener('hass-more-info', (e) => seen.push(e));

    tapElement(view, 'dl1');
    await settle(view);

    expect(picker(view)).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('lets the installer pick an unlinked device in link mode', async () => {
    const view = await mountView({ hass: clusterHass(), mode: 'link', home: homeResponse({ package: clusterPackage() }) });
    const taps: unknown[] = [];
    view.addEventListener('maxsen-element-tap', (e) => taps.push((e as CustomEvent).detail));

    tapElement(view, 'sw1');
    await settle(view);

    expect(pickRows(view).map((r) => r.classList.contains('dim'))).toEqual([false, false, false]);
    expect(pickRows(view).map((r) => r.getAttribute('aria-disabled'))).toEqual(['false', 'false', 'false']);
    rowNamed(view, 'Luna Downlight').click();
    expect(taps).toEqual([{ elementId: 'dl1' }]);
  });

  it('closes on Escape, from a row or from anywhere in the window', async () => {
    const view = await mountView({ hass: clusterHass(), home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });

    tapElement(view, 'sw1');
    await settle(view);
    key(pickRows(view)[1] as HTMLElement, 'Escape');
    await settle(view);
    expect(picker(view)).toBeNull();

    tapElement(view, 'sw1');
    await settle(view);
    key(pickRows(view)[1] as HTMLElement, 'ArrowDown');
    await settle(view);
    expect(picker(view)).not.toBeNull();
    key(window, 'Escape');
    await settle(view);
    expect(picker(view)).toBeNull();
  });

  it('closes on a tap outside it without acting on what was tapped, and not on a tap inside it', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });

    tapElement(view, 'sw1');
    await settle(view);
    pointer(picker(view)!, 'pointerdown');
    await settle(view);
    expect(picker(view)).not.toBeNull();

    pointer(root(view).querySelector('.picker-backdrop')!, 'pointerdown');
    pointer(root(view).querySelector('.picker-backdrop')!, 'pointerup');
    await settle(view);

    expect(picker(view)).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('moves focus to the first row, and gives it back to where it was when the picker closes', async () => {
    const view = await mountView({ hass: clusterHass(), home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });
    const layerButton = buttonLabelled(view, 'Lighting');
    layerButton.focus();

    tapElement(view, 'sw1');
    await settle(view);
    expect(root(view).activeElement).toBe(pickRows(view)[0]);

    key(root(view).activeElement as HTMLElement, 'Escape');
    await settle(view);
    expect(root(view).activeElement).toBe(layerButton);

    // Nothing in particular was focused: focus returns to the drawing.
    (root(view).activeElement as HTMLElement).blur();
    tapElement(view, 'sw1');
    await settle(view);
    rowNamed(view, 'Luna Downlight').click();
    await settle(view);
    expect(root(view).activeElement).toBe(stageOf(view));
  });

  it('closes when the layer or the level changes, or the view is removed, and leaves no listener behind', async () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const view = await mountView({ hass: clusterHass(), home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });
    buttonLabelled(view, 'Lighting').click();
    await settle(view);

    tapBetweenLights(view);
    await settle(view);
    expect(picker(view)).not.toBeNull();
    buttonLabelled(view, 'Smart Home').click();
    await settle(view);
    expect(picker(view)).toBeNull();

    buttonLabelled(view, 'Lighting').click();
    await settle(view);
    tapBetweenLights(view);
    await settle(view);
    expect(picker(view)).not.toBeNull();
    buttonLabelled(view, 'Level 2').click();
    await settle(view);
    expect(picker(view)).toBeNull();

    buttonLabelled(view, 'Level 1').click();
    await settle(view);
    tapBetweenLights(view);
    await settle(view);
    expect(picker(view)).not.toBeNull();
    view.remove();
    // Every window listener the picker added has been taken off again.
    const handlers = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === 'keydown').map(([, fn]) => fn);
    expect(handlers(added).length).toBeGreaterThan(0);
    for (const fn of handlers(added)) expect(handlers(removed)).toContain(fn);
  });

  it('shows the live state of each device, and follows it as Home Assistant reports changes', async () => {
    const hass = clusterHass({ 'sensor.led_temp': { state: '21.5', attributes: { unit_of_measurement: '°C' } } });
    const view = await mountView({
      hass,
      home: homeResponse({
        package: clusterPackage(),
        links: { ...CLUSTER_LINKS, led1: { type: 'entity', id: 'sensor.led_temp' } },
      }),
    });

    tapElement(view, 'sw1');
    await settle(view);
    expect(rowTexts(view)).toEqual([
      ['Entrance switch', 'Off'],
      ['Luna Downlight', 'On'],
      ['Lumi Cove Strip', '21.5 °C'],
    ]);

    view.hass = clusterHass({
      'switch.hall': { state: 'on' },
      'light.kitchen': { state: 'unavailable' },
      'sensor.led_temp': { state: '22.0', attributes: { unit_of_measurement: '°C' } },
    });
    await settle(view);
    expect(rowTexts(view)).toEqual([
      ['Entrance switch', 'On'],
      ['Luna Downlight', 'Unavailable'],
      ['Lumi Cove Strip', '22.0 °C'],
    ]);
  });

  it('marks each row with a dot in the colour of the device\'s icon', async () => {
    const view = await mountView({ hass: clusterHass(), home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });

    tapElement(view, 'sw1');
    await settle(view);

    const dots = pickRows(view).map((r) => r.querySelector<HTMLElement>('.dot')!.getAttribute('style') ?? '');
    expect(dots[0]).toMatch(/#2f5fb3|rgb\(47, 95, 179\)/i);
    expect(dots[1]).toMatch(/#d28a00|rgb\(210, 138, 0\)/i);
    expect(dots[2]).toMatch(/#c99700|rgb\(201, 151, 0\)/i);
  });

  it('shows the label, else the product name, as text and never as markup', async () => {
    const pkg = clusterPackage();
    const evil = '<img src=x onerror="alert(1)">';
    pkg.levels[0]!.plans[0]!.elements.find((e) => e.id === 'sw1')!.label = evil;
    const view = await mountView({ hass: clusterHass(), home: homeResponse({ package: pkg, links: CLUSTER_LINKS }) });

    tapElement(view, 'sw1');
    await settle(view);

    expect(rowTexts(view)[0]?.[0]).toBe(evil);
    expect(rowTexts(view)[1]?.[0]).toBe('Luna Downlight');
    expect(picker(view)?.querySelector('img')).toBeNull();
  });

  it('keeps the picker, whose rows are at least 44 px high, inside the drawing wherever the tap is', async () => {
    const css = (MaxsenFloorplanView.styles as unknown as { cssText: string }).cssText;
    expect(Number(/\.pick\s*\{[^}]*min-height:\s*(\d+)px/.exec(css)?.[1])).toBeGreaterThanOrEqual(44);

    for (const [cx, cy] of [[950, 950], [60, 60], [950, 60], [60, 950]] as const) {
      const view = await mountView({
        hass: clusterHass(),
        home: homeResponse({ package: clusterPackage(cx, cy), links: CLUSTER_LINKS }),
      });
      tapElement(view, 'sw1');
      await settle(view);
      const at = picker(view)!;
      const left = parseFloat(at.style.left);
      const top = parseFloat(at.style.top);
      const width = parseFloat(at.style.width);
      const height = pickRows(view).length * 48 + 8;
      expect(left, `${cx},${cy}`).toBeGreaterThanOrEqual(0);
      expect(top, `${cx},${cy}`).toBeGreaterThanOrEqual(0);
      expect(left + width, `${cx},${cy}`).toBeLessThanOrEqual(STAGE.w);
      expect(top + height, `${cx},${cy}`).toBeLessThanOrEqual(STAGE.h);
      // Close to the tap, not in a corner of the drawing.
      const tapped = elementPoint(view, 'sw1');
      expect(Math.abs(top - tapped.y), `${cx},${cy}`).toBeLessThan(height + 40);
      view.remove();
    }
  });

  it('zooming in separates devices whose touch circles overlap at 1x: each is tapped at its own centre with no picker', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    // The downlight 12 units from the switch: drawn apart (neither drawing holds the other's centre),
    // but 22 px touch circles that reach each other at 1x.
    const pkg = clusterPackage();
    const dl1 = pkg.levels[0]!.plans[1]!.scene.items.find((i) => i.elementId === 'dl1')!;
    Object.assign(dl1, { x: 190, y: 226 });
    const view = await mountView({ hass, home: homeResponse({ package: pkg, links: CLUSTER_LINKS }) });
    // At 1x a tap 13 units to the side of both, past both drawings, is a choice.
    const beside = planPoint(view, 178.8, 233.3);
    tap(stageOf(view), beside.x, beside.y);
    await settle(view);
    expect(pickRows(view).length).toBeGreaterThanOrEqual(2);
    key(window, 'Escape');
    await settle(view);

    const a = elementPoint(view, 'sw1');
    wheel(stageOf(view), -800, a.x, a.y);
    await settle(view);
    expect(stageOf(view).querySelector<HTMLElement>('.canvas')!.style.transform).toMatch(/scale\((2|3)\./);

    tapElement(view, 'sw1');
    await settle(view);
    expect(picker(view)).toBeNull();
    expect(call).toHaveBeenLastCalledWith('homeassistant', 'toggle', { entity_id: ['switch.hall'] });
    tapElement(view, 'dl1');
    await settle(view);
    expect(picker(view)).toBeNull();
    expect(call).toHaveBeenLastCalledWith('homeassistant', 'toggle', { entity_id: ['light.kitchen'] });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('keeps a zoomed-in marker tappable over its whole drawn size, beyond 22 px of its centre', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({ hass, home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });
    buttonLabelled(view, 'Smart Home').click();
    await settle(view);
    const a = elementPoint(view, 'sw1');
    wheel(stageOf(view), -3000, a.x, a.y);
    await settle(view);

    // At 6x the 20-unit marker is more than 100 px across: its edge is 40 px from the centre.
    tapElement(view, 'sw1', 40, 0);
    await settle(view);
    expect(picker(view)).toBeNull();
    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['switch.hall'] });
  });

  it('opens the picker inside the drawing\'s own box, so the bar above it does not shift it', async () => {
    const view = await mountView({ hass: clusterHass(), home: homeResponse({ package: clusterPackage(), links: CLUSTER_LINKS }) });

    tapElement(view, 'sw1');
    await settle(view);

    // Stage-local coordinates only line up when the stage is the picker's containing block.
    const stage = stageOf(view);
    expect(root(view).querySelector('.picker-layer')?.parentElement).toBe(stage);
    expect(picker(view)?.closest('.stage')).toBe(stage);
    const css = (MaxsenFloorplanView.styles as unknown as { cssText: string }).cssText;
    expect(/\.stage\s*\{[^}]*position:\s*relative/.test(css)).toBe(true);
  });

  it('finds the devices where they are on screen when the drawing is zoomed and panned', async () => {
    const hass = clusterHass();
    const call = vi.spyOn(hass, 'callService');
    const view = await mountView({
      hass,
      home: homeResponse({ package: clusterPackage(), links: { ...CLUSTER_LINKS, dl2: { type: 'entity', id: 'light.kitchen' } } }),
    });
    wheel(stageOf(view), -500, 300, 200);
    await settle(view);
    expect(stageOf(view).querySelector<HTMLElement>('.canvas')!.style.transform).not.toContain('scale(1)');

    tapElement(view, 'sw1');
    await settle(view);
    expect(pickRows(view)[0]?.querySelector('.pick-name')?.textContent).toBe('Entrance switch');
    key(window, 'Escape');
    await settle(view);

    // A marker far from the cluster is alone under the finger, so it acts directly.
    tapElement(view, 'dl2');
    await settle(view);
    expect(picker(view)).toBeNull();
    expect(call).toHaveBeenCalledExactlyOnceWith('homeassistant', 'toggle', { entity_id: ['light.kitchen'] });
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
