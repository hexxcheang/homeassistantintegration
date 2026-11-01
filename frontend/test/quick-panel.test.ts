import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/quick-panel.ts';
import type { MaxsenQuickPanel } from '../src/quick-panel.ts';
import type { HassLike, HomeResponse, Link, QuickItem } from '../src/types.ts';
import { makeHass } from './helpers.ts';
import { homeResponse, pointer, root, settle } from './view-helpers.ts';

const HALL: Link = { type: 'device', id: 'dev-hall' };
const KITCHEN: Link = { type: 'entity', id: 'light.kitchen' };

function makeWorld() {
  return makeHass({
    devices: { 'dev-hall': { name: 'Hall switch' } },
    entities: { 'switch.hall': { device_id: 'dev-hall' }, 'light.kitchen': {} },
    states: {
      'switch.hall': { state: 'on' },
      'light.kitchen': { state: 'off' },
      'scene.all_off': { state: 'unknown', attributes: { friendly_name: 'All off' } },
      'scene.all_off_level_1': { state: 'unknown', attributes: { friendly_name: 'All off – Level 1' } },
      'scene.movie_night': { state: 'unknown', attributes: { friendly_name: 'Movie night' } },
      'scene.dinner': { state: 'unknown', attributes: { friendly_name: 'Dinner' } },
      'scene.all_lights_off': { state: 'unknown', attributes: { friendly_name: 'All lights off' } },
    },
  });
}

async function mount(
  props: { hass?: HassLike; home?: HomeResponse } = {},
): Promise<MaxsenQuickPanel> {
  const el = document.createElement('maxsen-quick-panel') as MaxsenQuickPanel;
  el.hass = props.hass ?? makeWorld();
  el.home = props.home ?? homeResponse({ links: { sw1: HALL, dl1: KITCHEN } });
  el.entryId = 'e1';
  document.body.append(el);
  await settle(el);
  return el;
}

const q = <T extends Element>(el: Element, selector: string): T => {
  const found = root(el as HTMLElement).querySelector<T>(selector);
  if (!found) throw new Error(`No ${selector}`);
  return found;
};
const all = (el: Element, selector: string): Element[] => [
  ...root(el as HTMLElement).querySelectorAll(selector),
];
const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const click = (el: Element) => (el as HTMLElement).click();

const withPanel = (items: QuickItem[], links: Record<string, Link> = { sw1: HALL, dl1: KITCHEN }) =>
  homeResponse({ links, quick_panel: items });

async function openEditor(el: MaxsenQuickPanel): Promise<void> {
  click(q(el, '.edit'));
  await settle(el);
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('the buttons', () => {
  it('shows an element by its label, or its product name, with its live state', async () => {
    const el = await mount({
      home: withPanel([
        { type: 'element', id: 'sw1' },
        { type: 'element', id: 'dl1' },
        { type: 'entity', id: 'scene.movie_night' },
      ]),
    });

    const tiles = all(el, '.tile');
    expect(tiles.map((t) => text(t.querySelector('.name')!))).toEqual([
      'Entrance switch',
      'Luna Downlight',
      'Movie night',
    ]);
    expect(text(tiles[0]!.querySelector('.state')!)).toBe('On');
    expect(text(tiles[1]!.querySelector('.state')!)).toBe('Off');
    expect(text(tiles[2]!.querySelector('.state')!)).toBe('Scene');
  });

  it('follows the live state when Home Assistant changes it', async () => {
    const hass = makeWorld();
    const el = await mount({ hass, home: withPanel([{ type: 'element', id: 'dl1' }]) });
    expect(text(q(el, '.state'))).toBe('Off');

    hass.states['light.kitchen'] = { state: 'on', attributes: {} };
    el.hass = { ...hass };
    await settle(el);

    expect(text(q(el, '.state'))).toBe('On');
    expect(q(el, '.tile').classList.contains('on')).toBe(true);
  });

  it('shows a reading such as a cover position as the state', async () => {
    const hass = makeHass({
      devices: { 'dev-cur': { name: 'Curtain' } },
      entities: { 'cover.curtain': { device_id: 'dev-cur' } },
      states: { 'cover.curtain': { state: 'open', attributes: { current_position: 40 } } },
    });
    const el = await mount({
      hass,
      home: withPanel([{ type: 'element', id: 'cur1' }], { cur1: { type: 'device', id: 'dev-cur' } }),
    });
    expect(text(q(el, '.state'))).toBe('40%');
  });

  it('toggles the linked devices when an element is tapped', async () => {
    const hass = makeWorld();
    const call = vi.spyOn(hass, 'callService');
    const el = await mount({ hass, home: withPanel([{ type: 'element', id: 'sw1' }]) });

    click(q(el, '.tile'));
    await settle(el);

    expect(call).toHaveBeenCalledWith('homeassistant', 'toggle', { entity_id: ['switch.hall'] });
  });

  it('runs a scene with scene.turn_on, and says it is done', async () => {
    const hass = makeWorld();
    const call = vi.spyOn(hass, 'callService');
    const el = await mount({ hass, home: withPanel([{ type: 'entity', id: 'scene.all_off' }]) });

    click(q(el, '.tile'));
    await settle(el);

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.all_off' });
    expect(text(q(el, '.state'))).toBe('Done');
  });

  it('says so when a scene could not be run', async () => {
    const hass = makeWorld();
    vi.spyOn(hass, 'callService').mockRejectedValue(new Error('offline'));
    const el = await mount({ hass, home: withPanel([{ type: 'entity', id: 'scene.all_off' }]) });

    click(q(el, '.tile'));
    await settle(el);

    expect(text(q(el, '.state'))).toBe('Could not run it');
  });

  it('opens more-info for an element that cannot be toggled', async () => {
    const hass = makeHass({
      devices: { 'dev-sen': { name: 'Door sensor' } },
      entities: { 'sensor.door_temp': { device_id: 'dev-sen' } },
      states: { 'sensor.door_temp': { state: '21', attributes: { unit_of_measurement: '°C' } } },
    });
    const call = vi.spyOn(hass, 'callService');
    const el = await mount({
      hass,
      home: withPanel([{ type: 'element', id: 'sen1' }], { sen1: { type: 'device', id: 'dev-sen' } }),
    });
    const opened: unknown[] = [];
    el.addEventListener('hass-more-info', (e) => opened.push((e as CustomEvent).detail));

    expect(text(q(el, '.state'))).toBe('21 °C');
    click(q(el, '.tile'));

    expect(opened).toEqual([{ entityId: 'sensor.door_temp' }]);
    expect(call).not.toHaveBeenCalled();
  });

  it('greys out and ignores an element that is not linked', async () => {
    const hass = makeWorld();
    const call = vi.spyOn(hass, 'callService');
    const el = await mount({
      hass,
      home: withPanel([{ type: 'element', id: 'cur1' }], { sw1: HALL }),
    });

    const tile = q<HTMLButtonElement>(el, '.tile');
    expect(tile.disabled).toBe(true);
    expect(text(q(el, '.state'))).toBe('Not linked yet');
    click(tile);
    expect(call).not.toHaveBeenCalled();
  });

  it('shows a missing device and a removed scene as unavailable', async () => {
    const el = await mount({
      home: withPanel(
        [
          { type: 'element', id: 'dl2' },
          { type: 'entity', id: 'scene.deleted' },
          { type: 'element', id: 'gone-from-the-plan' },
        ],
        { dl2: { type: 'entity', id: 'light.deleted' } },
      ),
    });

    const tiles = all(el, '.tile') as HTMLButtonElement[];
    expect(tiles.every((t) => t.disabled)).toBe(true);
    expect(tiles.map((t) => text(t.querySelector('.state')!))).toEqual([
      'Missing device',
      'Not available',
      'Not available',
    ]);
  });

  it('shows how to start when the panel is empty', async () => {
    const el = await mount();
    expect(all(el, '.tile')).toHaveLength(0);
    expect(text(q(el, '.empty'))).toBe('Nothing here yet. Tap Edit to choose what goes on this panel.');
  });

  it('renders staff text only as text, never as markup', async () => {
    const home = structuredClone(withPanel([{ type: 'element', id: 'sw1' }]));
    home.package!.levels[0]!.plans[0]!.elements[0]!.label = '<img src=x onerror=alert(1)>';
    const el = await mount({ home });

    expect(root(el).querySelector('img')).toBeNull();
    expect(text(q(el, '.name'))).toBe('<img src=x onerror=alert(1)>');
  });

  it('has buttons that are at least 44 px tall', async () => {
    const css = (document.createElement('maxsen-quick-panel').constructor as unknown as {
      styles: { cssText: string };
    }).styles.cssText;
    expect(css).toMatch(/\.tile\s*\{[^}]*min-height:\s*(6\d|[7-9]\d|\d{3})px/);
    expect(css).toMatch(/\.edit\s*\{[^}]*min-height:\s*44px/);
  });
});

describe('the header', () => {
  it('has room for extra buttons, such as the installer\'s, beside Edit', async () => {
    const el = await mount();
    const slot = q<HTMLSlotElement>(el, 'slot[name="actions"]');
    expect(slot.closest('.head')).not.toBeNull();
    expect(text(q(el, '.edit'))).toBe('Edit');
  });

  it('wraps its buttons under the title rather than clipping them in a narrow column', () => {
    const css = (document.createElement('maxsen-quick-panel').constructor as unknown as {
      styles: { cssText: string };
    }).styles.cssText;
    expect(css).toMatch(/\.head\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.actions\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});

describe('Edit', () => {
  it('groups the choices: Scenes first (Maxsen starter scenes on top), then a group per level', async () => {
    const el = await mount({ home: withPanel([]) });
    await openEditor(el);

    const groups = all(el, '.group');
    expect(groups.map((g) => text(g.querySelector('h4')!))).toEqual(['Scenes', 'Level 1', 'Level 2']);
    const names = (group: Element) => [...group.querySelectorAll('.check-row .name')].map(text);
    expect(names(groups[0]!)).toEqual([
      'All off',
      'All off – Level 1',
      'All lights off',
      'Dinner',
      'Movie night',
    ]);
    // By label (or product name when there is none).
    expect(names(groups[1]!)).toEqual([
      'Door/Window Sensor',
      'Entrance switch',
      'Lumi Cove Strip',
      'Luna Downlight',
      'Luna Downlight',
      'Luna Downlight',
      'Smart Curtain Track',
    ]);
    expect(names(groups[2]!)).toEqual(['Motion Sensor']);
  });

  it('moves the keyboard into the sheet when it opens', async () => {
    const el = await mount();
    await openEditor(el);
    expect(root(el).activeElement).toBe(q(el, '.sheet .close'));
  });

  it('appends a ticked scene and saves with setQuickPanel', async () => {
    const hass = makeWorld();
    const callWS = vi.spyOn(hass, 'callWS').mockResolvedValue({ quick_panel: [] } as never);
    const el = await mount({ hass, home: withPanel([{ type: 'element', id: 'sw1' }]) });
    await openEditor(el);

    const box = q<HTMLInputElement>(el, 'input[data-key="entity:scene.movie_night"]');
    expect(box.checked).toBe(false);
    box.click();
    await settle(el);
    click(q(el, '.save'));
    await settle(el);

    expect(callWS).toHaveBeenCalledWith({
      type: 'maxsen/quick_panel/set',
      entry_id: 'e1',
      items: [
        { type: 'element', id: 'sw1' },
        { type: 'entity', id: 'scene.movie_night' },
      ],
    });
    expect(all(el, '.sheet')).toHaveLength(0);
  });

  it('starts with what is on the panel ticked, and unticking removes it', async () => {
    const hass = makeWorld();
    const callWS = vi.spyOn(hass, 'callWS').mockResolvedValue({ quick_panel: [] } as never);
    const el = await mount({
      hass,
      home: withPanel([
        { type: 'element', id: 'sw1' },
        { type: 'entity', id: 'scene.dinner' },
      ]),
    });
    await openEditor(el);
    expect(q<HTMLInputElement>(el, 'input[data-key="element:sw1"]').checked).toBe(true);

    q<HTMLInputElement>(el, 'input[data-key="element:sw1"]').click();
    await settle(el);
    click(q(el, '.save'));
    await settle(el);

    expect(callWS.mock.calls[0]![0]).toMatchObject({ items: [{ type: 'entity', id: 'scene.dinner' }] });
  });

  it('disables the checkbox of an element that is not linked, and says why', async () => {
    const el = await mount({ home: withPanel([]) });
    await openEditor(el);

    const unlinked = q<HTMLInputElement>(el, 'input[data-key="element:cur1"]');
    expect(unlinked.disabled).toBe(true);
    expect(text(unlinked.closest('.check-row')!)).toContain('Not linked yet');
    const linked = q<HTMLInputElement>(el, 'input[data-key="element:sw1"]');
    expect(linked.disabled).toBe(false);
    expect(text(linked.closest('.check-row')!)).not.toContain('Not linked yet');
  });

  it('lets an element that lost its link be taken off the panel', async () => {
    const el = await mount({ home: withPanel([{ type: 'element', id: 'cur1' }]) });
    await openEditor(el);
    const box = q<HTMLInputElement>(el, 'input[data-key="element:cur1"]');
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
  });

  it('moves an item with the up and down buttons', async () => {
    const hass = makeWorld();
    const callWS = vi.spyOn(hass, 'callWS').mockResolvedValue({ quick_panel: [] } as never);
    const el = await mount({
      hass,
      home: withPanel([
        { type: 'element', id: 'sw1' },
        { type: 'entity', id: 'scene.dinner' },
        { type: 'entity', id: 'scene.movie_night' },
      ]),
    });
    await openEditor(el);
    const order = () => all(el, '.order-row').map((r) => r.getAttribute('data-key'));
    expect(order()).toEqual(['element:sw1', 'entity:scene.dinner', 'entity:scene.movie_night']);
    expect(q<HTMLButtonElement>(el, '.order-row .up').disabled).toBe(true);

    click(q(el, '[data-key="entity:scene.movie_night"] .up'));
    await settle(el);
    click(q(el, '[data-key="element:sw1"] .down'));
    await settle(el);
    expect(order()).toEqual(['entity:scene.movie_night', 'element:sw1', 'entity:scene.dinner']);
    click(q(el, '.save'));
    await settle(el);

    expect(callWS.mock.calls[0]![0]).toMatchObject({
      items: [
        { type: 'entity', id: 'scene.movie_night' },
        { type: 'element', id: 'sw1' },
        { type: 'entity', id: 'scene.dinner' },
      ],
    });
  });

  it('moves an item by dragging its handle', async () => {
    const hass = makeWorld();
    const callWS = vi.spyOn(hass, 'callWS').mockResolvedValue({ quick_panel: [] } as never);
    const el = await mount({
      hass,
      home: withPanel([
        { type: 'element', id: 'sw1' },
        { type: 'entity', id: 'scene.dinner' },
        { type: 'entity', id: 'scene.movie_night' },
      ]),
    });
    await openEditor(el);
    // No layout in the test environment: three rows, 50 px apart.
    const rowRect = (row: Element): DOMRect => {
      const i = all(el, '.order-row').indexOf(row);
      return { top: i * 50, height: 50, bottom: i * 50 + 50 } as DOMRect;
    };
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.classList.contains('order-row') ? rowRect(this) : ({ top: 0, height: 0 } as DOMRect);
    });

    const handle = q(el, '[data-key="element:sw1"] .handle');
    pointer(handle, 'pointerdown', { id: 7, x: 10, y: 25 });
    await settle(el);
    expect(q(el, '[data-key="element:sw1"]').classList.contains('dragging')).toBe(true);
    pointer(handle, 'pointermove', { id: 7, x: 10, y: 80 });
    await settle(el);
    pointer(handle, 'pointermove', { id: 7, x: 10, y: 140 });
    await settle(el);
    pointer(handle, 'pointerup', { id: 7, x: 10, y: 140 });
    await settle(el);
    expect(all(el, '.dragging')).toHaveLength(0);

    click(q(el, '.save'));
    await settle(el);
    expect(callWS.mock.calls[0]![0]).toMatchObject({
      items: [
        { type: 'entity', id: 'scene.dinner' },
        { type: 'entity', id: 'scene.movie_night' },
        { type: 'element', id: 'sw1' },
      ],
    });
  });

  it('ignores pointer moves that did not start on a handle', async () => {
    const el = await mount({
      home: withPanel([
        { type: 'element', id: 'sw1' },
        { type: 'entity', id: 'scene.dinner' },
      ]),
    });
    await openEditor(el);
    const name = q(el, '[data-key="element:sw1"] .name');
    pointer(name, 'pointerdown', { y: 10 });
    pointer(name, 'pointermove', { y: 400 });
    await settle(el);
    expect(all(el, '.order-row').map((r) => r.getAttribute('data-key'))).toEqual([
      'element:sw1',
      'entity:scene.dinner',
    ]);
  });

  it('keeps everything as it was on Cancel', async () => {
    const hass = makeWorld();
    const callWS = vi.spyOn(hass, 'callWS');
    const el = await mount({ hass, home: withPanel([{ type: 'element', id: 'sw1' }]) });
    await openEditor(el);
    q<HTMLInputElement>(el, 'input[data-key="entity:scene.dinner"]').click();
    await settle(el);

    click(q(el, '.cancel'));
    await settle(el);

    expect(callWS).not.toHaveBeenCalled();
    expect(all(el, '.sheet')).toHaveLength(0);
    await openEditor(el);
    expect(q<HTMLInputElement>(el, 'input[data-key="entity:scene.dinner"]').checked).toBe(false);
  });

  it('shows the server message and stays open when saving fails', async () => {
    const hass = makeWorld();
    vi.spyOn(hass, 'callWS').mockRejectedValue({ code: 'unknown', message: 'Unknown home' });
    const el = await mount({ hass });
    await openEditor(el);

    click(q(el, '.save'));
    await settle(el);

    expect(text(q(el, '.error'))).toBe('Unknown home');
    expect(all(el, '.sheet')).toHaveLength(1);
    expect(q<HTMLButtonElement>(el, '.save').disabled).toBe(false);
  });

  it('shows items that are no longer available so they can be removed', async () => {
    const el = await mount({ home: withPanel([{ type: 'entity', id: 'scene.deleted' }]) });
    await openEditor(el);

    const row = q(el, '.order-row');
    expect(text(row)).toContain('Not available');
    click(row.querySelector('.remove')!);
    await settle(el);
    expect(all(el, '.order-row')).toHaveLength(0);
    expect(text(q(el, '.sheet'))).toContain('Nothing chosen yet');
  });

  it('has controls that are at least 44 px', async () => {
    const css = (document.createElement('maxsen-quick-panel').constructor as unknown as {
      styles: { cssText: string };
    }).styles.cssText;
    for (const selector of ['.check-row', '.order-row', '.handle', '.sheet button']) {
      const escaped = selector.replace('.', '\\.');
      expect(css, selector).toMatch(new RegExp(`${escaped}[^{]*\\{[^}]*min-(height|width):\\s*(4[4-9]|[5-9]\\d)px`));
    }
  });
});
