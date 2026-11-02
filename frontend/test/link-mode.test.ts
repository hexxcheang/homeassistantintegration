import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/link-mode.ts';
import type { MaxsenLinkMode } from '../src/link-mode.ts';
import type { HassLike, HomeResponse, Link, RefreshSummary } from '../src/types.ts';
import { element, makeHass } from './helpers.ts';
import { homeResponse, root, settle } from './view-helpers.ts';

const GANG2: Link = { type: 'entity', id: 'switch.l1_gang2' };
const HALL: Link = { type: 'device', id: 'dev-hall' };
const REVOKED = {
  code: 'revoked',
  message: 'Connection revoked: ask Maxsen for a new pairing code, then use Reconfigure on the Maxsen Home integration.',
};

function makeWorld() {
  return makeHass({
    areas: { hall: 'Hall', kitchen: 'Kitchen' },
    devices: {
      'dev-hall': { name: 'Hall switch', area_id: 'hall' },
      'dev-motion': { name: 'Motion puck', area_id: 'kitchen' },
    },
    entities: {
      'switch.hall': { device_id: 'dev-hall' },
      'sensor.motion_temp': { device_id: 'dev-motion' },
      'switch.l1_gang1': { name: 'Level 1 gang 1', area_id: 'hall' },
      'switch.l1_gang2': { name: 'Level 1 gang 2', area_id: 'hall' },
      'light.kitchen': { name: 'Kitchen light', area_id: 'kitchen' },
    },
    states: {
      'switch.hall': { state: 'on' },
      'sensor.motion_temp': { state: '20' },
      'switch.l1_gang1': { state: 'on' },
      'switch.l1_gang2': { state: 'off' },
      'light.kitchen': { state: 'off' },
    },
  });
}

interface Mounted {
  el: MaxsenLinkMode;
  hass: HassLike;
  callWS: ReturnType<typeof vi.fn>;
  selections: string[][];
}

async function mount(
  home: HomeResponse = homeResponse({ installer_mode: true }),
  reply: (msg: { type: string; [k: string]: unknown }) => unknown = () => ({}),
): Promise<Mounted> {
  const hass = makeWorld();
  const callWS = vi.fn(async (msg: { type: string }) => reply(msg));
  hass.callWS = callWS as never;
  const el = document.createElement('maxsen-link-mode') as MaxsenLinkMode;
  el.hass = hass;
  el.home = home;
  el.entryId = 'e1';
  const selections: string[][] = [];
  el.addEventListener('maxsen-selection', (e) => selections.push((e as CustomEvent).detail.selected));
  document.body.append(el);
  await settle(el);
  return { el, hass, callWS, selections };
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
const tapElement = async (el: MaxsenLinkMode, id: string) => {
  el.tap(id);
  await settle(el);
};
const candidateIds = (el: Element): (string | null)[] =>
  all(el, '.candidate').map((c) => c.getAttribute('data-link-id'));

const summary = (extra: Partial<RefreshSummary> = {}): RefreshSummary => ({
  preview_id: 'p1',
  added: [
    { id: 'n1', productName: 'Luna Downlight', label: '', levelName: 'Level 1' },
    { id: 'n2', productName: 'Ark Series', label: 'Porch switch', levelName: 'Level 2' },
  ],
  removed: [{ id: 'r1', productName: 'Motion Sensor', label: 'Hall motion', levelName: 'Level 1' }],
  changed_drawings: [{ planId: 'plan-1-lt', levelName: 'Level 1', type: 'lighting' }],
  ...extra,
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('toolbar', () => {
  it('has Done, Select several, Create starter scenes, Refresh from planner and a home file option', async () => {
    const { el } = await mount();
    expect(text(q(el, '.done'))).toBe('Done');
    expect(text(q(el, '.multi'))).toBe('Select several');
    expect(text(q(el, '.starter'))).toBe('Create starter scenes');
    expect(text(q(el, '.refresh'))).toBe('Refresh from planner');
    // A paired home can still be refreshed from a file, e.g. while the connection is revoked.
    expect(text(q(el, '.choose-file'))).toBe('Use a home file instead');
  });

  it('tells the panel when the installer is Done', async () => {
    const { el } = await mount();
    const done = vi.fn();
    el.addEventListener('maxsen-link-done', done);
    click(q(el, '.done'));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('has buttons that are at least 44 px tall', () => {
    const css = (customElements.get('maxsen-link-mode') as unknown as { styles: { cssText: string } })
      .styles.cssText;
    for (const selector of [
      '.toolbar button',
      '.candidate',
      '.dialog button',
      '.not-drawn-row',
      '.walk button',
      '.check button',
      '.include-other',
      '.listen',
      '.press-relink',
      '.press-undo',
    ]) {
      const escaped = selector.replace(/\./g, '\\.');
      expect(css, selector).toMatch(new RegExp(`${escaped}[^{]*\\{[^}]*min-height:\\s*(4[4-9]|[5-9]\\d)px`));
    }
  });
});

describe('original background switch', () => {
  const sw = (el: Element) => q<HTMLButtonElement>(el, '.original-background');

  it('is a labelled switch, off while the background is soft', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true, display: { background: 'soft' } }));
    expect(text(sw(el))).toBe('Original background');
    expect(sw(el).getAttribute('role')).toBe('switch');
    expect(sw(el).getAttribute('aria-checked')).toBe('false');
  });

  it('is on while the background is original', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true, display: { background: 'original' } }));
    expect(sw(el).getAttribute('aria-checked')).toBe('true');
  });

  it('turns the original background on by calling setDisplay', async () => {
    const { el, callWS } = await mount(homeResponse({ installer_mode: true }), () => ({
      display: { background: 'original' },
    }));
    click(sw(el));
    await settle(el);
    expect(callWS).toHaveBeenCalledWith({ type: 'maxsen/display/set', entry_id: 'e1', background: 'original' });
  });

  it('turns it off again by asking for the soft background', async () => {
    const { el, callWS } = await mount(
      homeResponse({ installer_mode: true, display: { background: 'original' } }),
      () => ({ display: { background: 'soft' } }),
    );
    click(sw(el));
    await settle(el);
    expect(callWS).toHaveBeenCalledWith({ type: 'maxsen/display/set', entry_id: 'e1', background: 'soft' });
  });

  it('shows the server message when it is refused, and can be pressed again', async () => {
    const { el, callWS } = await mount(homeResponse({ installer_mode: true }), () => {
      throw { code: 'not_allowed', message: 'Changing the display needs an administrator and installer mode' };
    });
    click(sw(el));
    await settle(el);
    expect(text(q(el, '.notice.error'))).toBe('Changing the display needs an administrator and installer mode');
    expect(sw(el).getAttribute('aria-checked')).toBe('false');
    expect(sw(el).disabled).toBe(false);
    click(sw(el));
    expect(callWS).toHaveBeenCalledTimes(2);
  });

  it('cannot be pressed twice while it works', async () => {
    let finish: (v: unknown) => void = () => undefined;
    const { el, callWS } = await mount(homeResponse({ installer_mode: true }), () => new Promise((r) => (finish = r)));
    click(sw(el));
    await settle(el);
    expect(sw(el).disabled).toBe(true);
    click(sw(el));
    expect(callWS).toHaveBeenCalledTimes(1);
    finish({ display: { background: 'original' } });
    await settle(el);
    expect(sw(el).disabled).toBe(false);
  });
});

describe('selecting', () => {
  it('asks for a tap when nothing is selected', async () => {
    const { el } = await mount();
    expect(text(q(el, '.hint'))).toBe('Tap an element on the drawing to link it to a device.');
    expect(all(el, '.candidate')).toHaveLength(0);
  });

  it('selects one element at a time, and tapping it again deselects it', async () => {
    const { el, selections } = await mount();
    await tapElement(el, 'dl1');
    await tapElement(el, 'dl2');
    expect(selections).toEqual([['dl1'], ['dl2']]);
    expect(text(q(el, '.selection .title'))).toBe('Luna Downlight');

    await tapElement(el, 'dl2');
    expect(selections.at(-1)).toEqual([]);
    expect(all(el, '.candidate')).toHaveLength(0);
  });

  it('adds and removes elements with Select several', async () => {
    const { el, selections } = await mount();
    click(q(el, '.multi'));
    await settle(el);
    expect(q(el, '.multi').getAttribute('aria-pressed')).toBe('true');
    for (const id of ['dl1', 'dl2', 'dl3']) await tapElement(el, id);
    expect(selections.at(-1)).toEqual(['dl1', 'dl2', 'dl3']);
    expect(text(q(el, '.selection .title'))).toBe('3 selected');

    await tapElement(el, 'dl2');
    expect(selections.at(-1)).toEqual(['dl1', 'dl3']);

    click(q(el, '.multi'));
    await settle(el);
    expect(selections.at(-1)).toEqual(['dl1']);
  });

  it('does not mix lights with other devices', async () => {
    const { el, selections } = await mount();
    click(q(el, '.multi'));
    await tapElement(el, 'dl1');
    await tapElement(el, 'sw1');

    expect(selections.at(-1)).toEqual(['dl1']);
    expect(text(q(el, '.notice'))).toBe('Select lights together, or other devices together, not both.');
  });

  it('ignores a tap on something that is not an element of this home', async () => {
    const { el, selections } = await mount();
    await tapElement(el, 'note1');
    expect(selections).toEqual([]);
  });

  it('drops a selected element that a refresh removed', async () => {
    const { el, selections } = await mount();
    await tapElement(el, 'dl1');

    const next = structuredClone(homeResponse({ installer_mode: true }));
    next.package!.levels[0]!.plans[1]!.elements = next.package!.levels[0]!.plans[1]!.elements.filter(
      (e) => e.id !== 'dl1',
    );
    el.home = next;
    await settle(el);

    expect(selections.at(-1)).toEqual([]);
  });
});

describe('choosing what to link to', () => {
  it('lists the candidates of the first selected element: lights link to entities', async () => {
    const { el } = await mount();
    await tapElement(el, 'dl1');
    expect(candidateIds(el)).toEqual(['switch.l1_gang1', 'switch.l1_gang2', 'switch.hall', 'light.kitchen']);
  });

  it('lists devices for a smart switch', async () => {
    const { el } = await mount();
    await tapElement(el, 'sw1');
    expect(candidateIds(el)).toEqual(['dev-hall']);
    expect(text(q(el, '.candidate'))).toContain('Hall switch');
    expect(text(q(el, '.candidate'))).toContain('Hall');
  });

  it('filters by what is typed, in the name, the area or the entity id', async () => {
    const { el } = await mount();
    await tapElement(el, 'dl1');
    const search = q<HTMLInputElement>(el, '.search');

    search.value = 'gang 2';
    search.dispatchEvent(new Event('input'));
    await settle(el);
    expect(candidateIds(el)).toEqual(['switch.l1_gang2']);

    search.value = 'kitchen';
    search.dispatchEvent(new Event('input'));
    await settle(el);
    expect(candidateIds(el)).toEqual(['light.kitchen']);

    search.value = 'nothing like this';
    search.dispatchEvent(new Event('input'));
    await settle(el);
    expect(text(q(el, '.none'))).toBe('Nothing matches.');
  });

  it('links all the selected elements to the one picked', async () => {
    const { el, callWS, selections } = await mount();
    click(q(el, '.multi'));
    for (const id of ['dl1', 'dl2', 'dl3']) await tapElement(el, id);

    click(q(el, '.candidate[data-link-id="switch.l1_gang2"]'));
    await settle(el);

    expect(callWS).toHaveBeenCalledTimes(1);
    expect(callWS).toHaveBeenCalledWith({
      type: 'maxsen/links/set',
      entry_id: 'e1',
      updates: { dl1: GANG2, dl2: GANG2, dl3: GANG2 },
    });
    expect(selections.at(-1)).toEqual([]);
    expect(text(q(el, '.notice'))).toBe('Linked 3 elements.');
  });

  it('links one element and says so', async () => {
    const { el, callWS } = await mount();
    await tapElement(el, 'sw1');
    click(q(el, '.candidate[data-link-id="dev-hall"]'));
    await settle(el);

    // A device picked by hand is named after its marker, like one found by a press.
    expect(callWS).toHaveBeenCalledWith({
      type: 'maxsen/links/set',
      entry_id: 'e1',
      updates: { sw1: HALL },
      name_device: true,
    });
    expect(text(q(el, '.notice'))).toBe('Linked.');
  });

  it('asks for no naming when it links lights to an entity or unlinks', async () => {
    const { el, callWS } = await mount(homeResponse({ installer_mode: true, links: { sw1: HALL } }));
    await tapElement(el, 'dl1');
    click(q(el, '.candidate[data-link-id="switch.l1_gang2"]'));
    await settle(el);
    await tapElement(el, 'sw1');
    click(q(el, '.unlink'));
    await settle(el);
    expect(callWS.mock.calls.map((c) => c[0])).toEqual([
      { type: 'maxsen/links/set', entry_id: 'e1', updates: { dl1: GANG2 } },
      { type: 'maxsen/links/set', entry_id: 'e1', updates: { sw1: null } },
    ]);
  });

  it('shows what the element is linked to now, and marks that candidate', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true, links: { dl1: GANG2 } }));
    await tapElement(el, 'dl1');

    expect(text(q(el, '.selection .status'))).toBe('Linked to Level 1 gang 2');
    expect(q(el, '.candidate[data-link-id="switch.l1_gang2"]').classList.contains('current')).toBe(true);
  });

  it('unlinks every selected element that has a link', async () => {
    const { el, callWS } = await mount(
      homeResponse({ installer_mode: true, links: { dl1: GANG2, dl2: GANG2 } }),
    );
    click(q(el, '.multi'));
    for (const id of ['dl1', 'dl2', 'dl3']) await tapElement(el, id);

    click(q(el, '.unlink'));
    await settle(el);

    expect(callWS).toHaveBeenCalledWith({
      type: 'maxsen/links/set',
      entry_id: 'e1',
      updates: { dl1: null, dl2: null },
    });
    expect(text(q(el, '.notice'))).toBe('Unlinked 2 elements.');
  });

  it('offers Unlink only when something selected is linked', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true, links: { dl1: GANG2 } }));
    await tapElement(el, 'dl2');
    expect(root(el).querySelector('.unlink')).toBeNull();
    await tapElement(el, 'dl1');
    expect(root(el).querySelector('.unlink')).not.toBeNull();
  });

  it('shows the message the server sent when linking is refused', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true }), () => {
      throw { code: 'not_allowed', message: 'Linking needs an administrator and installer mode' };
    });
    await tapElement(el, 'sw1');
    click(q(el, '.candidate'));
    await settle(el);

    expect(text(q(el, '.notice.error'))).toBe('Linking needs an administrator and installer mode');
    // The selection is kept so the installer can try again.
    expect(all(el, '.candidate').length).toBeGreaterThan(0);
  });
});

describe('what needs attention', () => {
  it('marks an element whose device is gone as Missing device', async () => {
    const { el } = await mount(
      homeResponse({ installer_mode: true, links: { dl1: { type: 'entity', id: 'light.deleted' } } }),
    );
    await tapElement(el, 'dl1');
    expect(text(q(el, '.selection .status'))).toBe('Missing device');
    expect(q(el, '.selection .status').classList.contains('missing')).toBe(true);
  });

  it('counts the elements still to link', async () => {
    const { el } = await mount(
      homeResponse({
        installer_mode: true,
        links: { dl1: GANG2, dl2: { type: 'entity', id: 'light.deleted' } },
      }),
    );
    expect(text(q(el, '.counts'))).toBe('6 not linked yet · 1 missing device');
  });

  it('lists the elements that are not on the drawing, and selects one when tapped', async () => {
    const home = structuredClone(homeResponse({ installer_mode: true, links: { sen2: HALL } }));
    const [sen2] = home.package!.levels[1]!.plans[0]!.elements;
    sen2!.drawn = false;
    home.package!.levels[0]!.plans[1]!.elements[3]!.drawn = false; // led1
    const { el, selections } = await mount(home);

    const rows = all(el, '.not-drawn-row');
    expect(text(q(el, '.not-drawn h4'))).toBe('Not on the drawing');
    expect(rows.map(text)).toEqual([
      'Lumi Cove Strip Level 1 · Not linked yet',
      'Motion Sensor Level 2 · Linked to Hall switch',
    ]);

    click(rows[0]!);
    await settle(el);
    expect(selections.at(-1)).toEqual(['led1']);
    expect(rows[0]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows no such list when everything is drawn', async () => {
    const { el } = await mount();
    expect(root(el).querySelector('.not-drawn')).toBeNull();
  });
});

describe('starter scenes', () => {
  it('creates them and says they are on the quick panel', async () => {
    const { el, callWS } = await mount(homeResponse({ installer_mode: true }), () => ({ scenes: [] }));
    click(q(el, '.starter'));
    await settle(el);

    expect(callWS).toHaveBeenCalledWith({ type: 'maxsen/scenes/create_starter', entry_id: 'e1' });
    expect(text(q(el, '.notice'))).toBe('Starter scenes are ready on the quick panel.');
    expect(q<HTMLButtonElement>(el, '.starter').disabled).toBe(false);
  });

  it('cannot be pressed twice while it works', async () => {
    let finish: (v: unknown) => void = () => undefined;
    const { el, callWS } = await mount(
      homeResponse({ installer_mode: true }),
      () => new Promise((r) => (finish = r)),
    );
    click(q(el, '.starter'));
    await settle(el);
    expect(q<HTMLButtonElement>(el, '.starter').disabled).toBe(true);
    click(q(el, '.starter'));
    expect(callWS).toHaveBeenCalledTimes(1);
    finish({ scenes: [] });
    await settle(el);
    expect(q<HTMLButtonElement>(el, '.starter').disabled).toBe(false);
  });

  it('shows the server message when it fails', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true }), () => {
      throw { code: 'not_allowed', message: 'Creating scenes needs an administrator and installer mode' };
    });
    click(q(el, '.starter'));
    await settle(el);
    expect(text(q(el, '.notice.error'))).toBe('Creating scenes needs an administrator and installer mode');
  });

  it('clears its confirmation after a few seconds', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true }), () => ({ scenes: [] }));
    vi.useFakeTimers();
    click(q(el, '.starter'));
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
    expect(root(el).querySelector('.notice')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(6000);
    await el.updateComplete;
    expect(root(el).querySelector('.notice')).toBeNull();
  });
});

describe('refresh from the planner', () => {
  const planner = (msg: { type: string }) => {
    if (msg.type === 'maxsen/refresh/preview') return summary();
    if (msg.type === 'maxsen/refresh/apply') return summary();
    return {};
  };

  it('shows what would change before anything is applied', async () => {
    const { el, callWS } = await mount(homeResponse({ installer_mode: true }), planner);
    click(q(el, '.refresh'));
    await settle(el);

    expect(callWS).toHaveBeenCalledTimes(1);
    expect(callWS).toHaveBeenCalledWith({ type: 'maxsen/refresh/preview', entry_id: 'e1' });
    expect(text(q(el, '.dialog .summary'))).toBe('2 new devices to link, 1 device removed, 1 drawing updated');
    const lists = all(el, '.dialog .changes');
    expect(lists.map((l) => text(l.querySelector('h4')!))).toEqual([
      'New devices',
      'Removed devices',
      'Updated drawings',
    ]);
    expect([...lists[0]!.querySelectorAll('li')].map(text)).toEqual([
      'Luna Downlight · Level 1',
      'Porch switch · Level 2',
    ]);
    expect([...lists[1]!.querySelectorAll('li')].map(text)).toEqual(['Hall motion · Level 1']);
    expect([...lists[2]!.querySelectorAll('li')].map(text)).toEqual(['Level 1 · Lighting']);
  });

  it('does not reopen the dialog when the answer arrives after it was closed', async () => {
    let answer: (v: unknown) => void = () => undefined;
    const { el } = await mount(homeResponse({ installer_mode: true }), () => new Promise((r) => (answer = r)));
    click(q(el, '.refresh'));
    await settle(el);
    click(q(el, '.dialog .cancel'));
    await settle(el);
    answer(summary());
    await settle(el);
    expect(root(el).querySelector('.dialog')).toBeNull();
  });

  it('says "Checking" while it asks the planner', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true }), () => new Promise(() => undefined));
    click(q(el, '.refresh'));
    await settle(el);
    expect(text(q(el, '.dialog'))).toContain('Checking the planner…');
    expect(root(el).querySelector('.apply')).toBeNull();
  });

  it('writes the counts as the brief words them', async () => {
    const counts = async (added: number, removed: number, drawings: number) => {
      const make = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ id: `x${i}`, productName: 'P', label: '', levelName: 'L' }));
      const { el } = await mount(homeResponse({ installer_mode: true }), () =>
        summary({
          added: make(added),
          removed: make(removed),
          changed_drawings: Array.from({ length: drawings }, (_, i) => ({
            planId: `p${i}`,
            levelName: 'L',
            type: 'lighting' as const,
          })),
        }),
      );
      click(q(el, '.refresh'));
      await settle(el);
      const line = text(q(el, '.dialog .summary'));
      el.remove();
      return line;
    };
    expect(await counts(5, 3, 2)).toBe('5 new devices to link, 3 devices removed, 2 drawings updated');
    expect(await counts(1, 1, 1)).toBe('1 new device to link, 1 device removed, 1 drawing updated');
  });

  it('moves the keyboard into the dialog when it opens', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true }), planner);
    click(q(el, '.refresh'));
    await settle(el);
    expect(root(el).activeElement).toBe(q(el, '.dialog .cancel'));
  });

  it('applies the previewed refresh when Apply is tapped', async () => {
    const { el, callWS } = await mount(homeResponse({ installer_mode: true }), planner);
    click(q(el, '.refresh'));
    await settle(el);
    click(q(el, '.apply'));
    await settle(el);

    expect(callWS).toHaveBeenLastCalledWith({
      type: 'maxsen/refresh/apply',
      entry_id: 'e1',
      preview_id: 'p1',
    });
    expect(root(el).querySelector('.dialog')).toBeNull();
    expect(text(q(el, '.notice'))).toBe('Home updated.');
  });

  it('applies nothing when cancelled', async () => {
    const { el, callWS } = await mount(homeResponse({ installer_mode: true }), planner);
    click(q(el, '.refresh'));
    await settle(el);
    click(q(el, '.dialog .cancel'));
    await settle(el);

    expect(callWS).toHaveBeenCalledTimes(1);
    expect(root(el).querySelector('.dialog')).toBeNull();
  });

  it('says so when nothing changed, and offers only Close', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true }), () =>
      summary({ added: [], removed: [], changed_drawings: [] }),
    );
    click(q(el, '.refresh'));
    await settle(el);

    expect(text(q(el, '.dialog .summary'))).toBe('0 new devices to link, 0 devices removed, 0 drawings updated');
    expect(text(q(el, '.dialog .nothing'))).toBe('Nothing has changed.');
    expect(root(el).querySelector('.apply')).toBeNull();
    expect(text(q(el, '.dialog .cancel'))).toBe('Close');
  });

  it('shows a revoked connection in the words the server used', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true }), () => {
      throw REVOKED;
    });
    click(q(el, '.refresh'));
    await settle(el);

    expect(text(q(el, '.dialog .error'))).toBe(REVOKED.message);
    expect(root(el).querySelector('.apply')).toBeNull();
    expect(root(el).querySelector('.dialog .summary')).toBeNull();
    expect(text(q(el, '.dialog .cancel'))).toBe('Close');
  });

  it('shows an expired preview and lets the installer look again', async () => {
    let applies = 0;
    const { el } = await mount(homeResponse({ installer_mode: true }), (msg) => {
      if (msg.type === 'maxsen/refresh/apply') {
        applies++;
        throw { code: 'preview_expired', message: 'The preview expired. Preview again.' };
      }
      return summary();
    });
    click(q(el, '.refresh'));
    await settle(el);
    click(q(el, '.apply'));
    await settle(el);

    expect(applies).toBe(1);
    expect(text(q(el, '.dialog .error'))).toBe('The preview expired. Preview again.');
    expect(root(el).querySelector('.dialog .summary')).not.toBeNull();
  });

  it('renders names from the planner only as text', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true }), () =>
      summary({ added: [{ id: 'x', productName: '<b>bold</b>', label: '', levelName: '<i>L</i>' }] }),
    );
    click(q(el, '.refresh'));
    await settle(el);
    expect(root(el).querySelector('.dialog b, .dialog i')).toBeNull();
    expect(text(q(el, '.dialog .changes li'))).toBe('<b>bold</b> · <i>L</i>');
  });
});

function chooseFile(el: MaxsenLinkMode, file: File): void {
  const input = q<HTMLInputElement>(el, 'input[type="file"]');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('a home paired with the planner, refreshed from a file', () => {
  it('uploads the file and previews it by its id, saying it reads the file', async () => {
    let answer!: (value: RefreshSummary) => void;
    const { el, hass, callWS } = await mount(
      homeResponse({ installer_mode: true }),
      () => new Promise<RefreshSummary>((resolve) => (answer = resolve)),
    );
    vi.spyOn(hass, 'fetchWithAuth').mockResolvedValue(
      new Response(JSON.stringify({ file_id: 'abc123' }), { status: 200 }),
    );

    chooseFile(el, new File(['{}'], 'house home.json', { type: 'application/json' }));
    await settle(el);

    expect(text(q(el, '.dialog .working'))).toBe('Reading the file…');
    expect(callWS).toHaveBeenCalledWith({
      type: 'maxsen/refresh/preview',
      entry_id: 'e1',
      file_id: 'abc123',
    });
    answer(summary());
    await settle(el);
    expect(text(q(el, '.dialog .summary'))).toContain('2 new devices to link');
  });

  it('still says it checks the planner for Refresh from planner', async () => {
    const { el } = await mount(homeResponse({ installer_mode: true }), () => new Promise(() => undefined));
    click(q(el, '.refresh'));
    await settle(el);
    expect(text(q(el, '.dialog .working'))).toBe('Checking the planner…');
  });
});

describe('a home loaded from a file', () => {
  const fileHome = () => homeResponse({ installer_mode: true, source: 'file' });

  it('offers to choose a newer file instead of the planner', async () => {
    const { el } = await mount(fileHome());
    expect(text(q(el, '.choose-file'))).toBe('Choose a newer home file');
    expect(root(el).querySelector('.refresh')).toBeNull();
  });

  it('uploads the file to Home Assistant, then previews it by its id', async () => {
    const { el, hass, callWS } = await mount(fileHome(), () => summary());
    const fetch = vi
      .spyOn(hass, 'fetchWithAuth')
      .mockResolvedValue(new Response(JSON.stringify({ file_id: 'abc123' }), { status: 200 }));
    const file = new File(['{}'], 'house home.json', { type: 'application/json' });

    chooseFile(el, file);
    await settle(el);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe('/api/file_upload');
    expect(init?.method).toBe('POST');
    expect(((init?.body as FormData).get('file') as File).name).toBe('house home.json');
    expect(callWS).toHaveBeenCalledWith({
      type: 'maxsen/refresh/preview',
      entry_id: 'e1',
      file_id: 'abc123',
    });
    expect(text(q(el, '.dialog .summary'))).toContain('2 new devices to link');
  });

  it('applies the preview of an uploaded file', async () => {
    const { el, hass, callWS } = await mount(fileHome(), () => summary());
    vi.spyOn(hass, 'fetchWithAuth').mockResolvedValue(
      new Response(JSON.stringify({ file_id: 'abc123' }), { status: 200 }),
    );
    chooseFile(el, new File(['{}'], 'h.json'));
    await settle(el);
    click(q(el, '.apply'));
    await settle(el);
    expect(callWS).toHaveBeenLastCalledWith({
      type: 'maxsen/refresh/apply',
      entry_id: 'e1',
      preview_id: 'p1',
    });
  });

  it('shows the server message when the file is rejected', async () => {
    const { el, hass } = await mount(fileHome(), () => {
      throw { code: 'invalid_package', message: 'This home file is for a different project.' };
    });
    vi.spyOn(hass, 'fetchWithAuth').mockResolvedValue(
      new Response(JSON.stringify({ file_id: 'abc123' }), { status: 200 }),
    );
    chooseFile(el, new File(['{}'], 'h.json'));
    await settle(el);
    expect(text(q(el, '.dialog .error'))).toBe('This home file is for a different project.');
  });

  it('says so when Home Assistant refuses the upload', async () => {
    const { el, hass, callWS } = await mount(fileHome());
    vi.spyOn(hass, 'fetchWithAuth').mockResolvedValue(new Response('no', { status: 413 }));
    chooseFile(el, new File(['{}'], 'h.json'));
    await settle(el);
    expect(text(q(el, '.dialog .error'))).toBe('Could not upload that file. Try again.');
    expect(callWS).not.toHaveBeenCalled();
  });
});


// ---- the linking walk and press to identify ----

const GANG1: Link = { type: 'entity', id: 'switch.l1_gang1' };
const MOTION: Link = { type: 'device', id: 'dev-motion' };

interface Sub {
  msg: Record<string, unknown>;
  options: unknown;
  deliver: (m: unknown) => void;
  unsub: ReturnType<typeof vi.fn>;
}

/**
 * A link mode on a home whose links are kept by the fake server below: `links/set` changes them and
 * answers with all of them, and `pushHome()` hands the home to the element as the panel would after
 * the server's push. Identify subscriptions are recorded in `subs`, newest last.
 */
async function mountWalk(
  options: { links?: Record<string, Link>; extra?: (home: HomeResponse) => void; hass?: (h: HassLike) => void } = {},
) {
  const links: Record<string, Link> = { ...(options.links ?? {}) };
  const homeNow = (): HomeResponse => {
    const home = structuredClone(homeResponse({ installer_mode: true })); // `extra` must not touch the shared fixture
    options.extra?.(home);
    return { ...home, links: { ...links } };
  };
  const m = await mount(homeNow(), (msg) => {
    if (msg.type !== 'maxsen/links/set') return {};
    for (const [id, link] of Object.entries(msg['updates'] as Record<string, Link | null>)) {
      if (link) links[id] = link;
      else delete links[id];
    }
    return { links: { ...links } };
  });
  options.hass?.(m.hass);
  const subs: Sub[] = [];
  m.hass.connection.subscribeMessage = vi.fn(async (deliver: (m: unknown) => void, msg: Sub['msg'], opts: unknown) => {
    const sub: Sub = { msg, options: opts, deliver, unsub: vi.fn(async () => undefined) };
    subs.push(sub);
    return sub.unsub;
  }) as never;
  /** The websocket came back after a drop (home-assistant-js-websocket's `ready`). */
  const ready = new Set<() => void>();
  m.hass.connection.addEventListener = (event, listener) => {
    if (event === 'ready') ready.add(listener);
  };
  m.hass.connection.removeEventListener = (event, listener) => {
    if (event === 'ready') ready.delete(listener);
  };
  // The element bound to the connection when it was added, before these methods existed: bind again.
  m.el.remove();
  document.body.append(m.el);
  await settle(m.el);
  const reconnect = () => ready.forEach((listener) => listener());
  const current: (string | undefined)[] = [];
  m.el.addEventListener('maxsen-current', (e) => current.push((e as CustomEvent).detail.elementId));
  vi.useFakeTimers();
  const tick = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
    await m.el.updateComplete;
  };
  /** The server's push arrives and the panel loads the home again. */
  const pushHome = async () => {
    m.el.home = homeNow();
    await tick();
  };
  return { ...m, subs, current, tick, pushHome, links, ready, reconnect };
}

type Walking = Awaited<ReturnType<typeof mountWalk>>;
const startWalk = async (w: Walking) => {
  click(q(w.el, '.start-walk'));
  await w.tick();
};
const latest = (w: Walking): Sub => {
  const sub = w.subs.at(-1);
  if (!sub) throw new Error('No identify subscription');
  return sub;
};
const prompt = (w: Walking) => text(q(w.el, '.walk-prompt'));
const identifyMessage = (extra: Record<string, unknown>) => ({
  type: 'maxsen/identify/subscribe',
  entry_id: 'e1',
  include_other: false,
  ...extra,
});
const linkCalls = (w: Walking) => w.callWS.mock.calls.map((c) => c[0]).filter((m) => m.type === 'maxsen/links/set');
/** Press the device the server reports and let the link and the toast appear. */
const press = async (w: Walking, result: Record<string, unknown>) => {
  latest(w).deliver(result);
  await w.tick();
};

describe('linking walk', () => {
  it('starts at the first unlinked element, says what to press and listens for it', async () => {
    const w = await mountWalk();
    expect(text(q(w.el, '.start-walk'))).toBe('Start linking walk');
    expect(root(w.el as HTMLElement).querySelector('.walk')).toBeNull();

    await startWalk(w);

    expect(prompt(w)).toBe('Press open or close on the curtain switch');
    expect(w.current.at(-1)).toBe('cur1');
    expect(w.subs).toHaveLength(1);
    expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['cover'] }));
    expect(latest(w).options).toEqual({ resubscribe: false });
  });

  it('shows how many elements of the whole home are linked, so a resumed walk shows its real progress', async () => {
    const w = await mountWalk({ links: { dl1: GANG2, dl2: GANG2, sen2: MOTION } });
    await startWalk(w);
    expect(text(q(w.el, '.walk-progress'))).toBe('3 / 8 linked');
    expect(prompt(w)).toBe('Press open or close on the curtain switch');
  });

  it('says so, and starts nothing, when every element is linked', async () => {
    const all = Object.fromEntries(['cur1', 'sen1', 'sw1', 'dl1', 'dl2', 'dl3', 'led1', 'sen2'].map((id) => [id, HALL]));
    const w = await mountWalk({ links: all });
    await startWalk(w);
    expect(text(q(w.el, '.notice'))).toBe('Every element is linked.');
    expect(root(w.el as HTMLElement).querySelector('.walk')).toBeNull();
    expect(w.subs).toHaveLength(0);
  });

  it('asks for the gang count stated by a switch', async () => {
    const w = await mountWalk();
    await startWalk(w);
    w.el.tap('sw1');
    await w.tick();
    expect(prompt(w)).toBe('Press any button on the switch at Entrance switch');
    expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['switch'], gangs: 3 }));
  });

  describe('a device step', () => {
    it('links the device that was pressed, naming it, and shows Linked with Undo', async () => {
      const w = await mountWalk();
      await startWalk(w);
      const first = latest(w);

      await press(w, { device_id: 'dev-motion', name: 'Motion puck' });

      expect(linkCalls(w)).toEqual([
        { type: 'maxsen/links/set', entry_id: 'e1', updates: { cur1: MOTION }, name_device: true, only_if_unlinked: true },
      ]);
      expect(text(q(w.el, '.walk-toast'))).toContain('Linked: Motion puck');
      expect(text(q(w.el, '.walk-undo'))).toBe('Undo');
      expect(first.unsub).toHaveBeenCalledTimes(1);
      // Still on the same step while the toast shows.
      expect(w.current.at(-1)).toBe('cur1');
    });

    it('shows the name Home Assistant has now, so the name Maxsen wrote is the one shown', async () => {
      const w = await mountWalk();
      await startWalk(w);
      latest(w).deliver({ device_id: 'dev-motion', name: 'Motion puck' });
      w.hass.devices['dev-motion'] = { ...w.hass.devices['dev-motion']!, name_by_user: 'Level 1 – Curtain' };
      w.el.hass = { ...w.hass }; // Home Assistant hands out a new hass when the registry changes
      await w.tick();
      expect(text(q(w.el, '.walk-toast'))).toContain('Linked: Level 1 – Curtain');
    });

    it('moves on to the next element after 2 seconds, and listens for that one', async () => {
      const w = await mountWalk();
      await startWalk(w);
      await press(w, { device_id: 'dev-motion', name: 'Motion puck' });
      await w.pushHome();

      await w.tick(1900);
      expect(w.current.at(-1)).toBe('cur1');
      expect(w.subs).toHaveLength(1);

      await w.tick(200);
      expect(w.current.at(-1)).toBe('sen1');
      expect(root(w.el as HTMLElement).querySelector('.walk-toast')).toBeNull();
      expect(prompt(w)).toBe("Wave at the sensor, or open the door it's on");
      expect(w.subs).toHaveLength(2);
      expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['binary_sensor'] }));
      expect(text(q(w.el, '.walk-progress'))).toBe('1 / 8 linked');
    });

    it('unlinks on Undo within the 2 seconds and asks for the same element again', async () => {
      const w = await mountWalk();
      await startWalk(w);
      await press(w, { device_id: 'dev-motion', name: 'Motion puck' });

      await w.tick(1000);
      click(q(w.el, '.walk-undo'));
      await w.tick();

      expect(linkCalls(w).at(-1)).toEqual({ type: 'maxsen/links/set', entry_id: 'e1', updates: { cur1: null } });
      expect(w.links).toEqual({});
      expect(prompt(w)).toBe('Press open or close on the curtain switch');
      expect(root(w.el as HTMLElement).querySelector('.walk-toast')).toBeNull();
      expect(w.subs).toHaveLength(2);
      expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['cover'] }));

      await w.tick(5000); // the 2 s timer was cancelled: no moving on
      expect(w.current.at(-1)).toBe('cur1');
      expect(w.subs).toHaveLength(2);
    });

    it('says "Two devices reacted. Press once more." and keeps listening', async () => {
      const w = await mountWalk();
      await startWalk(w);
      const sub = latest(w);
      sub.deliver({ ambiguous: true });
      await w.tick();
      expect(text(q(w.el, '.walk-warning'))).toBe('Two devices reacted. Press once more.');
      expect(sub.unsub).not.toHaveBeenCalled();
      expect(linkCalls(w)).toEqual([]);

      await press(w, { device_id: 'dev-motion', name: 'Motion puck' });
      expect(root(w.el as HTMLElement).querySelector('.walk-warning')).toBeNull();
      expect(linkCalls(w)).toHaveLength(1);
    });

    it('shows the server message and listens again when the link cannot be saved', async () => {
      const w = await mountWalk();
      await startWalk(w);
      w.callWS.mockImplementationOnce(async () => {
        throw { code: 'naming_failed', message: 'Could not name the device' };
      });
      await press(w, { device_id: 'dev-motion', name: 'Motion puck' });
      expect(text(q(w.el, '.notice.error'))).toBe('Could not name the device');
      expect(prompt(w)).toBe('Press open or close on the curtain switch');
      expect(root(w.el as HTMLElement).querySelector('.walk-toast')).toBeNull();
      expect(w.subs).toHaveLength(2);
    });

    it('ignores a push it does not know', async () => {
      const w = await mountWalk();
      await startWalk(w);
      await press(w, { event: 'home' });
      expect(linkCalls(w)).toEqual([]);
      expect(prompt(w)).toBe('Press open or close on the curtain switch');
    });

    it('does not take a second press while the first is being saved', async () => {
      const w = await mountWalk();
      await startWalk(w);
      const sub = latest(w);
      sub.deliver({ device_id: 'dev-motion', name: 'Motion puck' });
      sub.deliver({ device_id: 'dev-hall', name: 'Hall switch' });
      await w.tick();
      expect(linkCalls(w)).toHaveLength(1);
    });
  });

  describe('moving through the walk', () => {
    it('Skip moves to the next element and listens for that one instead', async () => {
      const w = await mountWalk();
      await startWalk(w);
      const first = latest(w);
      click(q(w.el, '.walk-skip'));
      await w.tick();
      expect(text(q(w.el, '.walk-skip'))).toBe('Skip');
      expect(w.current.at(-1)).toBe('sen1');
      expect(first.unsub).toHaveBeenCalledTimes(1);
      expect(w.subs).toHaveLength(2);
      expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['binary_sensor'] }));
    });

    it('Back goes to the step before, and listens for that one', async () => {
      const w = await mountWalk();
      await startWalk(w);
      w.el.tap('sw1'); // jump: cur1, sen1, then sw1
      await w.tick();
      expect(w.current.at(-1)).toBe('sw1');
      const sw = latest(w);

      expect(text(q(w.el, '.walk-back'))).toBe('Back');
      click(q(w.el, '.walk-back'));
      await w.tick();
      expect(w.current.at(-1)).toBe('sen1');
      expect(sw.unsub).toHaveBeenCalledTimes(1);
      expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['binary_sensor'] }));
    });

    it('a tap on an element that is still to link jumps to it; any other tap does nothing', async () => {
      const w = await mountWalk({ links: { sen1: HALL } });
      await startWalk(w);
      w.el.tap('dl2');
      await w.tick();
      expect(w.current.at(-1)).toBe('dl2');
      expect(prompt(w)).toBe('Turn its gangs off, then press the gang that turns this on');

      w.el.tap('sen1'); // already linked
      w.el.tap('note1'); // not an element
      await w.tick();
      expect(w.current.at(-1)).toBe('dl2');
    });

    it('Stop ends the walk, releases the subscription and clears the highlight', async () => {
      const w = await mountWalk();
      await startWalk(w);
      const sub = latest(w);
      click(q(w.el, '.walk-stop'));
      await w.tick();
      expect(root(w.el as HTMLElement).querySelector('.walk')).toBeNull();
      expect(sub.unsub).toHaveBeenCalledTimes(1);
      expect(w.current.at(-1)).toBeUndefined();
      expect(text(q(w.el, '.start-walk'))).toBe('Start linking walk');
    });

    it('releases the subscription when the element is removed', async () => {
      const w = await mountWalk();
      await startWalk(w);
      const sub = latest(w);
      w.el.remove();
      await w.tick();
      expect(sub.unsub).toHaveBeenCalledTimes(1);
    });

    it('does not move on after the element is removed while Linked shows', async () => {
      const w = await mountWalk();
      await startWalk(w);
      await press(w, { device_id: 'dev-motion', name: 'Motion puck' });
      const timers = vi.getTimerCount();
      w.el.remove();
      expect(vi.getTimerCount()).toBeLessThan(timers);
      await w.tick(5000);
      expect(w.subs).toHaveLength(1);
    });

    it('releases a subscription that arrives after the step has changed', async () => {
      const w = await mountWalk();
      const unsub = vi.fn(async () => undefined);
      const resolvers: ((u: () => void) => void)[] = [];
      w.hass.connection.subscribeMessage = vi.fn(
        () => new Promise<() => void>((r) => resolvers.push(r)),
      ) as never;
      await startWalk(w);
      click(q(w.el, '.walk-skip'));
      await w.tick();
      expect(resolvers).toHaveLength(2);
      resolvers[0]!(unsub); // the answer to the first step's subscription, now out of date
      await w.tick();
      expect(unsub).toHaveBeenCalledTimes(1);
    });

    it('does not act on a press delivered after its prompt was left', async () => {
      const w = await mountWalk();
      await startWalk(w);
      const old = latest(w);
      click(q(w.el, '.walk-skip'));
      await w.tick();
      old.deliver({ device_id: 'dev-motion', name: 'Motion puck' });
      await w.tick();
      expect(linkCalls(w)).toEqual([]);
    });

    it('shows the server message when listening is refused', async () => {
      const w = await mountWalk();
      w.hass.connection.subscribeMessage = vi.fn(async () => {
        throw { code: 'not_allowed', message: 'Identifying needs an administrator and installer mode' };
      }) as never;
      await startWalk(w);
      expect(text(q(w.el, '.notice.error'))).toBe('Identifying needs an administrator and installer mode');
      expect(prompt(w)).toBe('Press open or close on the curtain switch');
    });
  });

  describe('Include other devices', () => {
    it('is a switch, off by default, that listens again with include_other and stays on for the next steps', async () => {
      const w = await mountWalk();
      await startWalk(w);
      const sw = () => q<HTMLButtonElement>(w.el, '.include-other');
      expect(text(sw())).toBe('Include other devices');
      expect(sw().getAttribute('role')).toBe('switch');
      expect(sw().getAttribute('aria-checked')).toBe('false');
      const before = latest(w);

      click(sw());
      await w.tick();
      expect(sw().getAttribute('aria-checked')).toBe('true');
      expect(before.unsub).toHaveBeenCalledTimes(1);
      expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['cover'], include_other: true }));

      click(q(w.el, '.walk-skip'));
      await w.tick();
      expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['binary_sensor'], include_other: true }));
    });
  });

  describe('a lights step', () => {
    const startAtLight = async (w: Walking) => {
      await startWalk(w);
      w.el.tap('dl1');
      await w.tick();
    };

    it('listens for a gang, and links the highlighted light to the entity that came on without naming anything', async () => {
      const w = await mountWalk();
      await startAtLight(w);
      expect(prompt(w)).toBe('Turn its gangs off, then press the gang that turns this on');
      expect(latest(w).msg).toEqual(identifyMessage({ mode: 'entity', kinds: ['light_gang'] }));
      const sub = latest(w);

      await press(w, { entity_id: 'switch.l1_gang2', name: 'Level 1 gang 2' });

      expect(linkCalls(w)).toEqual([{ type: 'maxsen/links/set', entry_id: 'e1', updates: { dl1: GANG2 } }]);
      expect(sub.unsub).toHaveBeenCalledTimes(1);
      expect(prompt(w)).toBe('Tap the other lights that came on');
      expect(text(q(w.el, '.walk-done'))).toBe('Link these lights');
      // The toolbar's Done would close link mode and drop the tapped lights: it is not offered meanwhile.
      expect(root(w.el as HTMLElement).querySelector('.toolbar .done')).toBeNull();
      expect(w.current.at(-1)).toBe('dl1');
    });

    it('adds the lights that are tapped to the same gang, in one save on Done', async () => {
      const w = await mountWalk();
      await startAtLight(w);
      await press(w, { entity_id: 'switch.l1_gang2', name: 'Level 1 gang 2' });

      w.el.tap('dl2');
      w.el.tap('dl3');
      await w.tick();
      expect(w.selections.at(-1)).toEqual(['dl2', 'dl3']);
      expect(linkCalls(w)).toHaveLength(1); // nothing saved yet

      w.el.tap('dl3'); // tapped by mistake: tap again to take it out
      await w.tick();
      expect(w.selections.at(-1)).toEqual(['dl2']);
      w.el.tap('dl3');
      await w.tick();

      click(q(w.el, '.walk-done'));
      await w.tick();

      expect(linkCalls(w).slice(1)).toEqual([
        { type: 'maxsen/links/set', entry_id: 'e1', updates: { dl2: GANG2, dl3: GANG2 } },
      ]);
      expect(text(q(w.el, '.walk-toast'))).toContain('Linked: Level 1 gang 2');
      expect(w.selections.at(-1)).toEqual([]);
    });

    it('moves on after the toast: the whole group has left the walk', async () => {
      const w = await mountWalk();
      await startAtLight(w);
      await press(w, { entity_id: 'switch.l1_gang2', name: 'Level 1 gang 2' });
      w.el.tap('dl2');
      click(q(w.el, '.walk-done'));
      await w.tick();
      await w.pushHome();
      await w.tick(2100);

      expect(w.current.at(-1)).toBe('dl3');
      expect(prompt(w)).toBe('Turn its gangs off, then press the gang that turns this on');
      expect(latest(w).msg).toEqual(identifyMessage({ mode: 'entity', kinds: ['light_gang'] }));
    });

    it('with no other lights tapped, Done saves nothing more', async () => {
      const w = await mountWalk();
      await startAtLight(w);
      await press(w, { entity_id: 'switch.l1_gang2', name: 'Level 1 gang 2' });
      click(q(w.el, '.walk-done'));
      await w.tick();
      expect(linkCalls(w)).toHaveLength(1);
      await w.pushHome();
      await w.tick(2100);
      expect(w.current.at(-1)).toBe('dl2');
    });

    it('re-links a light that already has a gang to this one, asking nothing, and Undo gives it back its old gang', async () => {
      const w = await mountWalk({ links: { dl3: GANG1 } });
      await startAtLight(w);
      await press(w, { entity_id: 'switch.l1_gang2', name: 'Level 1 gang 2' });

      w.el.tap('dl3'); // already linked, to gang 1
      await w.tick();
      expect(w.selections.at(-1)).toEqual(['dl3']);
      click(q(w.el, '.walk-done'));
      await w.tick();
      expect(linkCalls(w).at(-1)).toEqual({
        type: 'maxsen/links/set',
        entry_id: 'e1',
        updates: { dl3: GANG2 },
      });

      click(q(w.el, '.walk-undo'));
      await w.tick();
      expect(linkCalls(w).at(-1)).toEqual({
        type: 'maxsen/links/set',
        entry_id: 'e1',
        updates: { dl1: null, dl3: GANG1 },
      });
      expect(w.links).toEqual({ dl3: GANG1 });
      expect(prompt(w)).toBe('Turn its gangs off, then press the gang that turns this on');
      expect(w.current.at(-1)).toBe('dl1');
    });

    it('ignores taps on things that are not lights while it waits for the other lights', async () => {
      const w = await mountWalk();
      await startAtLight(w);
      await press(w, { entity_id: 'switch.l1_gang2', name: 'Level 1 gang 2' });
      w.el.tap('sw1');
      await w.tick();
      expect(w.selections.at(-1)).toEqual([]);
      expect(w.current.at(-1)).toBe('dl1');
    });

    it('Undo before Done unlinks the light and listens for the gang again', async () => {
      const w = await mountWalk();
      await startAtLight(w);
      await press(w, { entity_id: 'switch.l1_gang2', name: 'Level 1 gang 2' });
      w.el.tap('dl2');
      await w.tick();

      click(q(w.el, '.walk-undo'));
      await w.tick();
      expect(linkCalls(w).at(-1)).toEqual({ type: 'maxsen/links/set', entry_id: 'e1', updates: { dl1: null } });
      expect(prompt(w)).toBe('Turn its gangs off, then press the gang that turns this on');
      expect(w.selections.at(-1)).toEqual([]);
      expect(latest(w).msg).toEqual(identifyMessage({ mode: 'entity', kinds: ['light_gang'] }));
    });

    it('cannot Skip or go Back while it waits for the other lights, or while Linked shows', async () => {
      const w = await mountWalk();
      await startAtLight(w);
      await press(w, { entity_id: 'switch.l1_gang2', name: 'Level 1 gang 2' });
      expect(q<HTMLButtonElement>(w.el, '.walk-skip').disabled).toBe(true);
      expect(q<HTMLButtonElement>(w.el, '.walk-back').disabled).toBe(true);
      click(q(w.el, '.walk-done'));
      await w.tick();
      expect(q<HTMLButtonElement>(w.el, '.walk-skip').disabled).toBe(true);
      expect(q<HTMLButtonElement>(w.el, '.walk-back').disabled).toBe(true);
    });

    it('says "Two devices reacted" for gangs too', async () => {
      const w = await mountWalk();
      await startAtLight(w);
      latest(w).deliver({ ambiguous: true });
      await w.tick();
      expect(text(q(w.el, '.walk-warning'))).toBe('Two devices reacted. Press once more.');
    });
  });

  describe('a step with nothing to press', () => {
    const withAircon = (home: HomeResponse) => {
      const plan = home.package!.levels[0]!.plans[0]!;
      plan.elements.push(element({ id: 'ac1', categoryId: 'aircon-controllers', productName: 'Aircon Controller' }));
    };
    const aircon = (h: HassLike) => {
      h.devices['dev-ac'] = { id: 'dev-ac', name: 'Hall aircon', area_id: 'hall' };
      h.entities['climate.hall'] = { entity_id: 'climate.hall', device_id: 'dev-ac' };
      h.states['climate.hall'] = { state: 'cool', attributes: {} };
    };

    it('shows the candidate list and listens for nothing', async () => {
      const w = await mountWalk({ extra: withAircon, hass: aircon });
      await startWalk(w);
      w.el.tap('ac1');
      await w.tick();
      expect(prompt(w)).toBe('Pick it from the list');
      expect(candidateIds(w.el)).toEqual(['dev-ac']);
      expect(w.subs).toHaveLength(1); // the first step's, released
      expect(latest(w).unsub).toHaveBeenCalledTimes(1);
      expect(root(w.el as HTMLElement).querySelector('.press-hint')).toBeNull();
    });

    const pickAc = async (w: Walking) => {
      await startWalk(w);
      w.el.tap('ac1');
      await w.tick();
      click(q(w.el, '.candidate[data-link-id="dev-ac"]'));
      await w.tick();
    };

    it('links the one picked, naming the device, and shows Linked with Undo like any other step', async () => {
      const w = await mountWalk({ extra: withAircon, hass: aircon });
      await pickAc(w);
      expect(linkCalls(w)).toEqual([
        { type: 'maxsen/links/set', entry_id: 'e1', updates: { ac1: { type: 'device', id: 'dev-ac' } }, name_device: true },
      ]);
      expect(text(q(w.el, '.walk-toast'))).toContain('Linked: Hall aircon');
      expect(text(q(w.el, '.walk-undo'))).toBe('Undo');
      expect(w.current.at(-1)).toBe('ac1');
      expect(all(w.el, '.candidate')).toHaveLength(0);

      await w.pushHome();
      await w.tick(2100);
      expect(root(w.el as HTMLElement).querySelector('.walk-toast')).toBeNull();
      expect(w.current.at(-1)).not.toBe('ac1');
    });

    it('shows the name Home Assistant has now in that toast', async () => {
      const w = await mountWalk({ extra: withAircon, hass: aircon });
      await pickAc(w);
      w.hass.devices['dev-ac'] = { ...w.hass.devices['dev-ac']!, name_by_user: 'Level 1 – Aircon Controller' };
      w.el.hass = { ...w.hass };
      await w.tick();
      expect(text(q(w.el, '.walk-toast'))).toContain('Linked: Level 1 – Aircon Controller');
    });

    it('unlinks on Undo and shows the list again for the same element', async () => {
      const w = await mountWalk({ extra: withAircon, hass: aircon });
      await pickAc(w);
      click(q(w.el, '.walk-undo'));
      await w.tick();
      expect(linkCalls(w).at(-1)).toEqual({ type: 'maxsen/links/set', entry_id: 'e1', updates: { ac1: null } });
      expect(w.links).toEqual({});
      expect(prompt(w)).toBe('Pick it from the list');
      expect(candidateIds(w.el)).toEqual(['dev-ac']);
      await w.tick(5000);
      expect(w.current.at(-1)).toBe('ac1');
    });
  });

  describe('when the home changes under the walk', () => {
    it('does not put a linked element back from a home that was loaded before its link', async () => {
      const w = await mountWalk();
      await startWalk(w);
      await press(w, { device_id: 'dev-motion', name: 'Motion puck' });
      await w.tick(2100);
      expect(w.current.at(-1)).toBe('sen1');

      // A load that began before the link arrives late.
      const stale = homeResponse({ installer_mode: true });
      w.el.home = stale;
      await w.tick();
      expect(w.current.at(-1)).toBe('sen1');
      // The count does not flicker back either.
      expect(text(q(w.el, '.walk-progress'))).toBe('1 / 8 linked');

      await w.pushHome();
      expect(w.current.at(-1)).toBe('sen1');
      expect(text(q(w.el, '.walk-progress'))).toBe('1 / 8 linked');
    });

    it('moves on, and listens again, when the current element gets linked somewhere else', async () => {
      const w = await mountWalk();
      await startWalk(w);
      const sub = latest(w);
      w.links['cur1'] = HALL;
      await w.pushHome();
      expect(w.current.at(-1)).toBe('sen1');
      expect(sub.unsub).toHaveBeenCalledTimes(1);
      expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['binary_sensor'] }));
    });

    it('does not listen again when a refresh leaves the current step as it was', async () => {
      const w = await mountWalk();
      await startWalk(w);
      await w.pushHome();
      expect(w.subs).toHaveLength(1);
    });
  });

  describe('after the connection drops', () => {
    it('listens again for the step it is on: the server forgot the prompt', async () => {
      const w = await mountWalk();
      await startWalk(w);
      const before = latest(w);
      w.reconnect();
      await w.tick();
      expect(w.subs).toHaveLength(2);
      // The old subscription died with the socket: its unsubscribe would name a command id the new socket may reuse.
      expect(before.unsub).not.toHaveBeenCalled();
      expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['cover'] }));
      expect(prompt(w)).toBe('Press open or close on the curtain switch');

      click(q(w.el, '.walk-skip')); // the new subscription is ended as usual
      await w.tick();
      expect(w.subs[1]!.unsub).toHaveBeenCalledTimes(1);
    });

    it('leaves a step alone that is not waiting for a press, and a walk that is over', async () => {
      const w = await mountWalk();
      await startWalk(w);
      await press(w, { device_id: 'dev-motion', name: 'Motion puck' });
      w.reconnect(); // the Linked toast is showing
      await w.tick();
      expect(w.subs).toHaveLength(1);

      click(q(w.el, '.walk-stop'));
      await w.tick();
      w.reconnect();
      await w.tick();
      expect(w.subs).toHaveLength(1);
    });

    it('also listens again for a single marker, and stops being told when the element is removed', async () => {
      const w = await mountWalk();
      w.el.tap('sw1');
      await w.tick();
      const before = latest(w);
      w.reconnect();
      await w.tick();
      expect(w.subs).toHaveLength(2);
      expect(before.unsub).not.toHaveBeenCalled();
      expect(w.ready.size).toBe(1);
      w.el.remove();
      expect(w.ready.size).toBe(0);
    });
  });

  describe('when the server ends the prompt', () => {
    it('ends the walk with the reason and leaves link mode ready for normal use', async () => {
      const w = await mountWalk();
      await startWalk(w);
      const sub = latest(w);
      sub.deliver({ stopped: true });
      await w.tick();

      expect(root(w.el as HTMLElement).querySelector('.walk')).toBeNull();
      expect(text(q(w.el, '.notice.error'))).toBe('The walk stopped. Open Installer to carry on.');
      expect(w.current.at(-1)).toBeUndefined();
      expect(sub.unsub).toHaveBeenCalledTimes(1);
      expect(q<HTMLButtonElement>(w.el, '.start-walk').disabled).toBe(false);
      // Selecting still works.
      w.el.tap('dl1');
      await w.tick();
      expect(w.selections.at(-1)).toEqual(['dl1']);
    });
  });
});

describe('press to identify', () => {
  it('with one marker selected, says to press the device and listens for it', async () => {
    const w = await mountWalk();
    expect(root(w.el as HTMLElement).querySelector('.press-hint')).toBeNull();
    w.el.tap('sw1');
    await w.tick();

    expect(text(q(w.el, '.press-hint'))).toContain('Press the device now');
    expect(w.subs).toHaveLength(1);
    expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['switch'], gangs: 3 }));
    expect(latest(w).options).toEqual({ resubscribe: false });
    expect(text(q(w.el, '.include-other'))).toBe('Include other devices');
  });

  it('links the marker to the device that was pressed, naming it, and lets go of the selection', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    const sub = latest(w);
    sub.deliver({ device_id: 'dev-hall', name: 'Hall switch' });
    await w.tick();

    expect(linkCalls(w)).toEqual([
      { type: 'maxsen/links/set', entry_id: 'e1', updates: { sw1: HALL }, name_device: true, only_if_unlinked: true },
    ]);
    expect(text(q(w.el, '.press-toast'))).toBe('Linked: Hall switch Undo');
    expect(w.selections.at(-1)).toEqual([]);
    expect(root(w.el as HTMLElement).querySelector('.press-hint')).toBeNull();
    expect(sub.unsub).toHaveBeenCalledTimes(1);
    expect(w.subs).toHaveLength(1);
  });

  it('links a light to the gang that was pressed, without naming anything', async () => {
    const w = await mountWalk();
    w.el.tap('dl1');
    await w.tick();
    expect(latest(w).msg).toEqual(identifyMessage({ mode: 'entity', kinds: ['light_gang'] }));
    latest(w).deliver({ entity_id: 'switch.l1_gang2', name: 'Level 1 gang 2' });
    await w.tick();
    expect(linkCalls(w)).toEqual([{ type: 'maxsen/links/set', entry_id: 'e1', updates: { dl1: GANG2 } }]);
    expect(text(q(w.el, '.press-toast'))).toBe('Linked: Level 1 gang 2 Undo');
  });

  it('shows the link for 2 seconds with Undo, which unlinks; the toast shows the name Home Assistant has now', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    latest(w).deliver({ device_id: 'dev-hall', name: 'Hall switch' });
    await w.tick();
    w.hass.devices['dev-hall'] = { ...w.hass.devices['dev-hall']!, name_by_user: 'Level 1 – Entrance switch' };
    w.el.hass = { ...w.hass };
    await w.tick(1000);
    expect(text(q(w.el, '.press-toast'))).toBe('Linked: Level 1 – Entrance switch Undo');

    click(q(w.el, '.press-undo'));
    await w.tick();
    expect(linkCalls(w).at(-1)).toEqual({ type: 'maxsen/links/set', entry_id: 'e1', updates: { sw1: null } });
    expect(w.links).toEqual({});
    expect(root(w.el as HTMLElement).querySelector('.press-toast')).toBeNull();
    await w.tick(5000);
    expect(root(w.el as HTMLElement).querySelector('.press-toast')).toBeNull();
  });

  it('lets the toast go after 2 seconds', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    latest(w).deliver({ device_id: 'dev-hall', name: 'Hall switch' });
    await w.tick(1900);
    expect(root(w.el as HTMLElement).querySelector('.press-toast')).not.toBeNull();
    await w.tick(200);
    expect(root(w.el as HTMLElement).querySelector('.press-toast')).toBeNull();
  });

  it('listens again when the link cannot be saved, and keeps the selection', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    w.callWS.mockImplementationOnce(async () => {
      throw { code: 'not_allowed', message: 'Linking needs an administrator and installer mode' };
    });
    latest(w).deliver({ device_id: 'dev-hall', name: 'Hall switch' });
    await w.tick();
    expect(text(q(w.el, '.notice.error'))).toBe('Linking needs an administrator and installer mode');
    expect(w.selections.at(-1)).toEqual(['sw1']);
    expect(w.subs).toHaveLength(2);
  });

  it('says "Two devices reacted. Press once more." and keeps listening', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    latest(w).deliver({ ambiguous: true });
    await w.tick();
    expect(text(q(w.el, '.press-warning'))).toBe('Two devices reacted. Press once more.');
    expect(latest(w).unsub).not.toHaveBeenCalled();
  });

  it('listens for the marker selected now: another marker, no marker or several markers change or end it', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    const first = latest(w);
    w.el.tap('sen1');
    await w.tick();
    expect(first.unsub).toHaveBeenCalledTimes(1);
    expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['binary_sensor'] }));

    const second = latest(w);
    w.el.tap('sen1'); // deselect
    await w.tick();
    expect(second.unsub).toHaveBeenCalledTimes(1);
    expect(root(w.el as HTMLElement).querySelector('.press-hint')).toBeNull();

    w.el.tap('dl1');
    await w.tick();
    const light = latest(w);
    expect(light.msg).toEqual(identifyMessage({ mode: 'entity', kinds: ['light_gang'] }));
    click(q(w.el, '.multi')); // Select several never listens
    await w.tick();
    expect(light.unsub).toHaveBeenCalledTimes(1);
    expect(root(w.el as HTMLElement).querySelector('.press-hint')).toBeNull();
    expect(root(w.el as HTMLElement).querySelector('.press-relink')).toBeNull();
    w.el.tap('dl1'); // off, then on again
    w.el.tap('dl1');
    w.el.tap('dl2');
    await w.tick();
    expect(w.subs).toHaveLength(3);
  });

  it('never listens in Select several, not even for the first marker tapped', async () => {
    const w = await mountWalk();
    click(q(w.el, '.multi'));
    await w.tick();
    w.el.tap('sw1');
    await w.tick();
    expect(w.subs).toHaveLength(0);
    expect(root(w.el as HTMLElement).querySelector('.press-hint')).toBeNull();
    expect(root(w.el as HTMLElement).querySelector('.press-tools')).toBeNull();
  });

  it('has a Listen switch, on for an unlinked marker, that stops and starts the listening', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    const listen = () => q<HTMLButtonElement>(w.el, '.listen');
    expect(text(listen())).toBe('Listen');
    expect(listen().getAttribute('role')).toBe('switch');
    expect(listen().getAttribute('aria-checked')).toBe('true');
    const first = latest(w);

    click(listen());
    await w.tick();
    expect(listen().getAttribute('aria-checked')).toBe('false');
    expect(first.unsub).toHaveBeenCalledTimes(1);
    expect(root(w.el as HTMLElement).querySelector('.press-hint')).toBeNull();

    click(listen());
    await w.tick();
    expect(w.subs).toHaveLength(2);
    expect(text(q(w.el, '.press-hint'))).toContain('Press the device now');

    // Another marker is listened for afresh, whatever the switch said.
    click(listen());
    await w.tick();
    w.el.tap('sen1');
    await w.tick();
    expect(listen().getAttribute('aria-checked')).toBe('true');
    expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['binary_sensor'] }));
  });

  it('does not listen for a marker that already has a link until Press to relink is tapped', async () => {
    const w = await mountWalk({ links: { sw1: MOTION } });
    w.el.tap('sw1');
    await w.tick();
    expect(w.subs).toHaveLength(0);
    expect(root(w.el as HTMLElement).querySelector('.press-hint')).toBeNull();
    expect(text(q(w.el, '.press-relink'))).toBe('Press to relink');

    click(q(w.el, '.press-relink'));
    await w.tick();
    expect(w.subs).toHaveLength(1);
    expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['switch'], gangs: 3 }));
    expect(text(q(w.el, '.press-hint'))).toContain('Press the device now');
    expect(root(w.el as HTMLElement).querySelector('.press-relink')).toBeNull();

    // The press relinks it, and Undo gives the old link back.
    latest(w).deliver({ device_id: 'dev-hall', name: 'Hall switch' });
    await w.tick();
    expect(linkCalls(w)).toEqual([
      { type: 'maxsen/links/set', entry_id: 'e1', updates: { sw1: HALL }, name_device: true, only_if_unlinked: true },
    ]);
    click(q(w.el, '.press-undo'));
    await w.tick();
    expect(linkCalls(w).at(-1)).toEqual({ type: 'maxsen/links/set', entry_id: 'e1', updates: { sw1: MOTION } });
    expect(w.links).toEqual({ sw1: MOTION });
  });

  it('asks again for Press to relink when another linked marker is selected', async () => {
    const w = await mountWalk({ links: { sw1: MOTION, sen1: HALL } });
    w.el.tap('sw1');
    await w.tick();
    click(q(w.el, '.press-relink'));
    await w.tick();
    w.el.tap('sen1');
    await w.tick();
    expect(root(w.el as HTMLElement).querySelector('.press-relink')).not.toBeNull();
    expect(latest(w).unsub).toHaveBeenCalledTimes(1);
  });

  it('listens again with include_other when the switch is turned on', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    const first = latest(w);
    click(q(w.el, '.include-other'));
    await w.tick();
    expect(first.unsub).toHaveBeenCalledTimes(1);
    expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['switch'], gangs: 3, include_other: true }));
  });

  it('has nothing to press for an element that is picked from a list', async () => {
    const w = await mountWalk({
      extra: (home) => {
        home.package!.levels[0]!.plans[0]!.elements.push(
          element({ id: 'ac1', categoryId: 'aircon-controllers', productName: 'Aircon Controller' }),
        );
      },
    });
    w.el.tap('ac1');
    await w.tick();
    expect(w.subs).toHaveLength(0);
    expect(root(w.el as HTMLElement).querySelector('.press-hint')).toBeNull();
  });

  it('is left to the walk while a walk is on', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    const single = latest(w);
    await startWalk(w);
    expect(single.unsub).toHaveBeenCalledTimes(1);
    expect(root(w.el as HTMLElement).querySelector('.press-hint')).toBeNull();
    expect(w.subs).toHaveLength(2); // the single press's, and the walk's first step
  });

  it('tells the installer when installer mode was switched off, and stops listening', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    latest(w).deliver({ stopped: true });
    await w.tick();
    expect(text(q(w.el, '.notice.error'))).toBe('Identifying stopped: installer mode was switched off, or another phone is listening.');
    expect(root(w.el as HTMLElement).querySelector('.press-hint')).toBeNull();
  });

  it('listens again when Listen is turned on after the server ended the prompt', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    latest(w).deliver({ stopped: true });
    await w.tick();
    expect(q(w.el, '.listen').getAttribute('aria-checked')).toBe('false');

    click(q(w.el, '.listen'));
    await w.tick();
    expect(w.subs).toHaveLength(2);
    expect(text(q(w.el, '.press-hint'))).toContain('Press the device now');
  });

  it('also for a linked marker: Press to relink listens again after the prompt was ended', async () => {
    const w = await mountWalk({ links: { sw1: MOTION } });
    w.el.tap('sw1');
    await w.tick();
    click(q(w.el, '.press-relink'));
    await w.tick();
    latest(w).deliver({ stopped: true });
    await w.tick();
    click(q(w.el, '.press-relink'));
    await w.tick();
    expect(w.subs).toHaveLength(2);
  });

  it('shows the server message when listening is refused, is not listening, and listens when asked again', async () => {
    const w = await mountWalk();
    const subscribe = w.hass.connection.subscribeMessage;
    w.hass.connection.subscribeMessage = vi.fn(async () => {
      throw { code: 'not_allowed', message: 'Identifying needs an administrator and installer mode' };
    }) as never;
    w.el.tap('sw1');
    await w.tick();
    expect(text(q(w.el, '.notice.error'))).toBe('Identifying needs an administrator and installer mode');
    expect(q(w.el, '.listen').getAttribute('aria-checked')).toBe('false');
    expect(root(w.el as HTMLElement).querySelector('.press-hint')).toBeNull();

    w.hass.connection.subscribeMessage = subscribe;
    click(q(w.el, '.listen'));
    await w.tick();
    expect(w.subs).toHaveLength(1);
    expect(text(q(w.el, '.press-hint'))).toContain('Press the device now');
  });

  it('releases the subscription when the element is removed', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    const sub = latest(w);
    w.el.remove();
    await w.tick();
    expect(sub.unsub).toHaveBeenCalledTimes(1);
  });
});

// ---- one identify subscription per home ----

describe('a device that is already linked elsewhere', () => {
  const ALREADY = { code: 'already_linked', message: 'That device is already linked to another element' };
  const refuseOnce = (w: Walking) => w.callWS.mockRejectedValueOnce(ALREADY);

  it('is refused on a walk step: the installer is told, nothing is linked and the step listens again', async () => {
    const w = await mountWalk();
    refuseOnce(w);
    await startWalk(w);
    await press(w, { device_id: 'dev-motion', name: 'Motion puck' });

    expect(text(q(w.el, '.notice.error'))).toBe('That device is already linked to another element. Press a different one.');
    expect(w.links).toEqual({});
    expect(w.current.at(-1)).toBe('cur1');
    expect(w.subs).toHaveLength(2);
    expect(latest(w).msg).toEqual(identifyMessage({ mode: 'device', kinds: ['cover'] }));
    expect(root(w.el as HTMLElement).querySelector('.walk-toast')).toBeNull();

    // Another press works.
    await press(w, { device_id: 'dev-hall', name: 'Hall switch' });
    expect(w.links).toEqual({ cur1: HALL });
  });

  it('is refused for a single marker: the installer is told and it listens again', async () => {
    const w = await mountWalk();
    refuseOnce(w);
    w.el.tap('sw1');
    await w.tick();
    latest(w).deliver({ device_id: 'dev-hall', name: 'Hall switch' });
    await w.tick();

    expect(text(q(w.el, '.notice.error'))).toBe('That device is already linked to another element. Press a different one.');
    expect(w.links).toEqual({});
    expect(w.selections.at(-1)).toEqual(['sw1']);
    expect(w.subs).toHaveLength(2);
    expect(text(q(w.el, '.press-hint'))).toContain('Press the device now');
  });
});

describe('when the same home is listened to twice', () => {
  it('ignores the stopped the server sends to a subscription this element already replaced (step change)', async () => {
    const w = await mountWalk();
    await startWalk(w);
    const old = latest(w);
    click(q(w.el, '.walk-skip'));
    await w.tick();
    // The server stops the older subscription when the new one arrives.
    old.deliver({ stopped: true });
    await w.tick();

    expect(root(w.el as HTMLElement).querySelector('.walk')).not.toBeNull();
    expect(root(w.el as HTMLElement).querySelector('.notice.error')).toBeNull();
    expect(w.subs).toHaveLength(2);
    // The walk still hears its presses.
    await press(w, { device_id: 'dev-motion', name: 'Motion puck' });
    expect(linkCalls(w)).toHaveLength(1);
  });

  it('ignores it after a reconnect and after Include other devices', async () => {
    const w = await mountWalk();
    await startWalk(w);
    const first = latest(w);
    w.reconnect();
    await w.tick();
    const second = latest(w);
    first.deliver({ stopped: true });
    await w.tick();
    expect(root(w.el as HTMLElement).querySelector('.walk')).not.toBeNull();

    click(q(w.el, '.include-other'));
    await w.tick();
    second.deliver({ stopped: true });
    await w.tick();
    expect(root(w.el as HTMLElement).querySelector('.walk')).not.toBeNull();
    expect(root(w.el as HTMLElement).querySelector('.notice.error')).toBeNull();
  });

  it('ignores it when Listen is switched off and on again for a single marker', async () => {
    const w = await mountWalk();
    w.el.tap('sw1');
    await w.tick();
    const first = latest(w);
    click(q(w.el, '.listen'));
    await w.tick();
    click(q(w.el, '.listen'));
    await w.tick();
    first.deliver({ stopped: true });
    await w.tick();
    expect(root(w.el as HTMLElement).querySelector('.notice.error')).toBeNull();
    expect(q(w.el, '.listen').getAttribute('aria-checked')).toBe('true');
    expect(text(q(w.el, '.press-hint'))).toContain('Press the device now');
  });

  it('ends the walk when the subscription in use is the one that was stopped (another phone took over)', async () => {
    const w = await mountWalk();
    await startWalk(w);
    latest(w).deliver({ stopped: true });
    await w.tick();
    expect(root(w.el as HTMLElement).querySelector('.walk')).toBeNull();
    expect(text(q(w.el, '.notice.error'))).toBe('The walk stopped. Open Installer to carry on.');
  });
});

// ---- Check all ----

const CURTAIN: Link = { type: 'device', id: 'dev-cur' };

/**
 * A link mode with a linked curtain (cur1) and the downlights (dl1 and dl2 on the first gang, dl3
 * on the second), which Check all goes through in that order. `services` records every service call.
 */
async function mountCheck(
  options: { links?: Record<string, Link>; without?: string[]; hass?: (h: HassLike) => void } = {},
) {
  const services = vi.fn(async (..._args: unknown[]) => undefined);
  const w = await mountWalk({
    links: Object.fromEntries(
      Object.entries({ cur1: CURTAIN, dl1: GANG1, dl2: GANG1, dl3: GANG2, ...options.links }).filter(
        ([id]) => !options.without?.includes(id),
      ),
    ),
    hass: (h) => {
      h.devices['dev-cur'] = { id: 'dev-cur', name: 'Curtain' };
      h.entities['cover.cur'] = { entity_id: 'cover.cur', device_id: 'dev-cur' };
      h.states['cover.cur'] = { state: 'open', attributes: { current_position: 100, supported_features: 15 } };
      h.callService = services as never;
      options.hass?.(h);
    },
  });
  return { ...w, services };
}
type Checking = Awaited<ReturnType<typeof mountCheck>>;

const startCheck = async (w: Checking) => {
  click(q(w.el, '.check-all'));
  await w.tick();
};
/** The 2 seconds are over; the state is back. */
const afterTwoSeconds = (w: Checking) => w.tick(2000);
const answer = async (w: Checking, which: 'ok' | 'wrong' | 'skip' | 'again') => {
  click(q(w.el, `.check-${which}`));
  await w.tick();
};
const serviceCalls = (w: Checking): unknown[][] => w.services.mock.calls as unknown[][];
const serviceNames = (w: Checking): string[] => serviceCalls(w).map((c) => `${c[0]}.${c[1]}`);
const checkPrompt = (w: Checking) => text(q(w.el, '.check-prompt'));
const gone = (w: Checking, selector: string) => root(w.el as HTMLElement).querySelector(selector) === null;

describe('Check all', () => {
  it('has a Check all button in the toolbar', async () => {
    const w = await mountCheck();
    expect(text(q(w.el, '.check-all'))).toBe('Check all');
    expect(q<HTMLButtonElement>(w.el, '.check-all').disabled).toBe(false);
  });

  it('says so when nothing linked can be checked', async () => {
    // The curtain is linked to a device without a cover, and no light is linked.
    const w = await mountCheck({ links: { cur1: HALL }, without: ['dl1', 'dl2', 'dl3'] });
    await startCheck(w);
    expect(text(q(w.el, '.notice'))).toBe('Nothing to check yet. Link a switch, light or curtain first.');
    expect(gone(w, '.check')).toBe(true);
    expect(serviceCalls(w)).toHaveLength(0);
  });

  describe('a step', () => {
    it('highlights the element, switches it and asks OK or Wrong after the 2 seconds', async () => {
      const w = await mountCheck();
      await startCheck(w);

      expect(text(q(w.el, '.check-for'))).toBe('Smart Curtain Track · Level 1');
      expect(text(q(w.el, '.check-progress'))).toBe('1 / 3');
      expect(checkPrompt(w)).toBe('Watch now. It switches for 2 seconds, then goes back.');
      expect(w.current.at(-1)).toBe('cur1');
      expect(w.selections.at(-1)).toEqual(['cur1']);
      expect(serviceCalls(w)).toEqual([['cover', 'close_cover', { entity_id: 'cover.cur' }]]);
      expect(gone(w, '.check-ok')).toBe(true);

      await afterTwoSeconds(w);
      expect(serviceNames(w)).toEqual(['cover.close_cover', 'cover.stop_cover', 'cover.set_cover_position']);
      expect(serviceCalls(w)[2]![2]).toEqual({ entity_id: 'cover.cur', position: 100 });
      expect(checkPrompt(w)).toBe('Was it the right one?');
      expect(text(q(w.el, '.check-ok'))).toBe('OK');
      expect(text(q(w.el, '.check-wrong'))).toBe('Wrong');
    });

    it('highlights every light of a gang, pulsing the first', async () => {
      const w = await mountCheck();
      await startCheck(w);
      await afterTwoSeconds(w);
      await answer(w, 'ok');
      expect(text(q(w.el, '.check-for'))).toBe('Luna Downlight and 1 more · Level 1');
      expect(w.selections.at(-1)).toEqual(['dl1', 'dl2']);
      expect(w.current.at(-1)).toBe('dl1');
    });

    it('switches a lit gang off and back on, and an unlit one on and back off', async () => {
      const w = await mountCheck();
      await startCheck(w);
      await afterTwoSeconds(w);
      await answer(w, 'ok');
      await afterTwoSeconds(w);
      await answer(w, 'ok');
      await afterTwoSeconds(w);
      expect(serviceCalls(w).slice(3)).toEqual([
        ['switch', 'turn_off', { entity_id: 'switch.l1_gang1' }],
        ['switch', 'turn_on', { entity_id: 'switch.l1_gang1' }],
        ['switch', 'turn_on', { entity_id: 'switch.l1_gang2' }],
        ['switch', 'turn_off', { entity_id: 'switch.l1_gang2' }],
      ]);
    });

    it('can run the step again', async () => {
      const w = await mountCheck();
      await startCheck(w);
      await afterTwoSeconds(w);
      await answer(w, 'again');
      expect(checkPrompt(w)).toBe('Watch now. It switches for 2 seconds, then goes back.');
      await afterTwoSeconds(w);
      expect(serviceNames(w).filter((n) => n === 'cover.close_cover')).toHaveLength(2);
      expect(text(q(w.el, '.check-progress'))).toBe('1 / 3');
    });

    it('does not accept OK or Wrong while the step is switching', async () => {
      const w = await mountCheck();
      await startCheck(w);
      expect(gone(w, '.check-ok')).toBe(true);
      expect(gone(w, '.check-wrong')).toBe(true);
    });
  });

  describe('the summary', () => {
    it('counts OK and to relink, and unlinks what was marked Wrong with no naming', async () => {
      const w = await mountCheck();
      await startCheck(w);
      await afterTwoSeconds(w);
      await answer(w, 'ok');
      await afterTwoSeconds(w);
      await answer(w, 'ok');
      await afterTwoSeconds(w);
      await answer(w, 'wrong');

      expect(linkCalls(w)).toEqual([{ type: 'maxsen/links/set', entry_id: 'e1', updates: { dl3: null } }]);
      expect(text(q(w.el, '.check-summary'))).toBe('2 OK, 1 to relink');
      expect(text(q(w.el, '.check-close'))).toBe('Relink now');
    });

    it('unlinks every light of the gang when it is Wrong', async () => {
      const w = await mountCheck();
      await startCheck(w);
      await afterTwoSeconds(w);
      await answer(w, 'ok');
      await afterTwoSeconds(w);
      await answer(w, 'wrong');
      expect(linkCalls(w)[0]).toEqual({
        type: 'maxsen/links/set',
        entry_id: 'e1',
        updates: { dl1: null, dl2: null },
      });
    });

    it('offers Close, and starts no walk, when everything was OK', async () => {
      const w = await mountCheck();
      await startCheck(w);
      for (let i = 0; i < 3; i++) {
        await afterTwoSeconds(w);
        await answer(w, 'ok');
      }
      expect(text(q(w.el, '.check-summary'))).toBe('3 OK, 0 to relink');
      expect(text(q(w.el, '.check-close'))).toBe('Close');
      expect(linkCalls(w)).toHaveLength(0);
      click(q(w.el, '.check-close'));
      await w.tick();
      expect(gone(w, '.check')).toBe(true);
      expect(gone(w, '.walk')).toBe(true);
      expect(w.subs).toHaveLength(0);
      expect(w.selections.at(-1)).toEqual([]);
      expect(w.current.at(-1)).toBeUndefined();
      expect(text(q(w.el, '.check-all'))).toBe('Check all');
    });

    it('cannot be stopped while the unlink is being saved, so the walk never misses it', async () => {
      let finish: (v: unknown) => void = () => undefined;
      const w = await mountCheck();
      await startCheck(w);
      await afterTwoSeconds(w);
      w.callWS.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
      click(q(w.el, '.check-wrong'));
      await w.tick();
      expect(q<HTMLButtonElement>(w.el, '.check-stop').disabled).toBe(true);
      expect(q<HTMLButtonElement>(w.el, '.check-ok').disabled).toBe(true);
      finish({ links: {} });
      await w.tick();
      expect(q<HTMLButtonElement>(w.el, '.check-stop').disabled).toBe(false);
    });

    it('does not move on, and says so, when the unlink is refused', async () => {
      const w = await mountCheck();
      await startCheck(w);
      await afterTwoSeconds(w);
      w.callWS.mockRejectedValueOnce({ code: 'not_allowed', message: 'Linking needs installer mode' });
      await answer(w, 'wrong');
      expect(text(q(w.el, '.notice.error'))).toBe('Linking needs installer mode');
      expect(checkPrompt(w)).toBe('Was it the right one?');
      expect(text(q(w.el, '.check-progress'))).toBe('1 / 3');
    });
  });

  describe('Wrong puts the elements back in the walk', () => {
    const wrongOnLastGang = async (w: Checking) => {
      await startCheck(w);
      await afterTwoSeconds(w);
      await answer(w, 'ok');
      await afterTwoSeconds(w);
      await answer(w, 'ok');
      await afterTwoSeconds(w);
      await answer(w, 'wrong');
    };

    it('starts a walk at the element when none is running, before the home has been reloaded', async () => {
      const w = await mountCheck();
      await wrongOnLastGang(w);
      expect(gone(w, '.walk')).toBe(true); // nothing listens while Check all is open
      expect(w.subs).toHaveLength(0);

      click(q(w.el, '.check-close'));
      await w.tick();
      expect(w.current.at(-1)).toBe('dl3');
      expect(text(q(w.el, '.walk-prompt'))).toBe('Turn its gangs off, then press the gang that turns this on');
      expect(text(q(w.el, '.walk-progress'))).toBe('3 / 8 linked');
      expect(latest(w).msg).toEqual(identifyMessage({ mode: 'entity', kinds: ['light_gang'] }));
    });

    it('adds them to a walk that is running and goes to them', async () => {
      const w = await mountCheck();
      await startWalk(w);
      expect(prompt(w)).toBe("Wave at the sensor, or open the door it's on");
      const walking = latest(w);

      await wrongOnLastGang(w);
      expect(w.subs).toHaveLength(1);
      expect(walking.unsub).toHaveBeenCalledTimes(1);

      click(q(w.el, '.check-close'));
      await w.tick();
      expect(w.subs).toHaveLength(2);
      expect(w.current.at(-1)).toBe('dl3');
      expect(prompt(w)).toBe('Turn its gangs off, then press the gang that turns this on');
      expect(text(q(w.el, '.walk-progress'))).toBe('3 / 8 linked');

      // The walk still has what it had: skipping the lights goes on to the rest.
      click(q(w.el, '.walk-skip'));
      await w.tick();
      expect(w.current.at(-1)).toBe('sen1');
    });

    it('does not put an element back that was already marked Wrong through another gang', async () => {
      // A 3-gang switch: Wrong on the first gang unlinks the switch, so its other gangs are not asked.
      const w = await mountCheck({
        links: { cur1: HALL, sw1: { type: 'device', id: 'dev-sw' } },
        without: ['dl1', 'dl2', 'dl3'],
        hass: (h) => {
          h.devices['dev-sw'] = { id: 'dev-sw', name: 'Entrance switch' };
          for (const n of [1, 2, 3]) {
            h.entities[`switch.sw_${n}`] = { entity_id: `switch.sw_${n}`, device_id: 'dev-sw' };
            h.states[`switch.sw_${n}`] = { state: 'off', attributes: {} };
          }
        },
      });
      await startCheck(w);
      expect(text(q(w.el, '.check-for'))).toBe('Entrance switch · gang 1 of 3 · Level 1');
      await afterTwoSeconds(w);
      await answer(w, 'wrong');
      expect(linkCalls(w)).toEqual([{ type: 'maxsen/links/set', entry_id: 'e1', updates: { sw1: null } }]);
      expect(text(q(w.el, '.check-summary'))).toBe('0 OK, 1 to relink');
      expect(serviceNames(w)).toEqual(['switch.turn_on', 'switch.turn_off']);
    });
  });

  describe('while Check all is open', () => {
    it('stops listening for a press first, and listens again only after everything is back', async () => {
      const w = await mountCheck();
      await startWalk(w);
      const walking = latest(w);
      w.subs.length = 0;
      const subscribe = w.hass.connection.subscribeMessage as ReturnType<typeof vi.fn>;
      subscribe.mockClear();

      await startCheck(w);
      expect(walking.unsub).toHaveBeenCalledTimes(1);
      expect(walking.unsub.mock.invocationCallOrder[0]!).toBeLessThan(w.services.mock.invocationCallOrder[0]!);
      expect(gone(w, '.walk')).toBe(true);

      for (let i = 0; i < 3; i++) {
        await afterTwoSeconds(w);
        await answer(w, 'ok');
      }
      expect(subscribe).not.toHaveBeenCalled();
      click(q(w.el, '.check-close'));
      await w.tick();
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(subscribe.mock.invocationCallOrder[0]!).toBeGreaterThan(w.services.mock.invocationCallOrder.at(-1)!);
    });

    it('waits for a subscription that is still being set up before it switches anything', async () => {
      const w = await mountCheck();
      let arrive: () => void = () => undefined;
      const unsub = vi.fn(async () => undefined);
      w.hass.connection.subscribeMessage = vi.fn(
        () => new Promise((resolve) => (arrive = () => resolve(unsub))),
      ) as never;
      await startWalk(w);

      await startCheck(w);
      expect(w.services).not.toHaveBeenCalled();

      arrive();
      await w.tick();
      expect(unsub).toHaveBeenCalledTimes(1);
      expect(w.services).toHaveBeenCalledTimes(1);
      expect(unsub.mock.invocationCallOrder[0]!).toBeLessThan(w.services.mock.invocationCallOrder[0]!);
    });

    it('does not listen for a single marker either, and ignores taps on the drawing', async () => {
      const w = await mountCheck();
      w.el.tap('sw1'); // an unlinked switch: its press is listened for
      await w.tick();
      const single = latest(w);

      await startCheck(w);
      expect(single.unsub).toHaveBeenCalledTimes(1);
      const before = w.subs.length;
      w.el.tap('sen1');
      await w.tick();
      expect(w.selections.at(-1)).toEqual(['cur1']);
      expect(w.subs).toHaveLength(before);
    });

    it('does not follow a new home or a reconnection into listening', async () => {
      const w = await mountCheck();
      await startWalk(w);
      await startCheck(w);
      const subs = w.subs.length;
      w.links['sen1'] = HALL;
      await w.pushHome();
      w.reconnect();
      await w.tick();
      expect(w.subs).toHaveLength(subs);
      // The walk does not move, or clear what Check all highlights, until Check all is over.
      expect(w.selections.at(-1)).toEqual(['cur1']);
      expect(w.current.at(-1)).toBe('cur1');
    });

    it('can only be started once, and the toolbar has nothing else to press but Done', async () => {
      const w = await mountCheck();
      const button = q<HTMLButtonElement>(w.el, '.check-all');
      button.click();
      button.click();
      await w.tick();
      expect(w.services).toHaveBeenCalledTimes(1);
      expect(gone(w, '.check-all')).toBe(true);
      expect(gone(w, '.start-walk')).toBe(true);
      expect(gone(w, '.refresh')).toBe(true);
      expect(text(q(w.el, '.done'))).toBe('Done');
    });

    it('cannot be started while a walk step is being saved or confirmed', async () => {
      const w = await mountCheck();
      await startWalk(w);
      await press(w, { device_id: 'dev-motion', name: 'Motion puck' }); // the Linked toast is showing
      expect(q<HTMLButtonElement>(w.el, '.check-all').disabled).toBe(true);
      await w.tick(2100);
      expect(q<HTMLButtonElement>(w.el, '.check-all').disabled).toBe(false);
    });
  });

  describe('a step that cannot be switched', () => {
    it('reports an unavailable entity, does not switch it, and lets the installer skip it', async () => {
      const w = await mountCheck({
        hass: (h) => {
          h.states['switch.l1_gang2'] = { state: 'unavailable', attributes: {} };
        },
      });
      await startCheck(w);
      await afterTwoSeconds(w);
      await answer(w, 'ok');
      await afterTwoSeconds(w);
      await answer(w, 'ok');

      expect(text(q(w.el, '.check-for'))).toBe('Luna Downlight · Level 1');
      expect(checkPrompt(w)).toBe('Luna Downlight is unavailable, so it was not switched.');
      expect(serviceCalls(w).some((c) => (c[2] as { entity_id: string }).entity_id === 'switch.l1_gang2')).toBe(false);
      expect(gone(w, '.check-ok')).toBe(true);
      expect(gone(w, '.check-wrong')).toBe(true);

      await answer(w, 'skip');
      expect(text(q(w.el, '.check-summary'))).toBe('2 OK, 0 to relink, 1 not tested');
    });

    it('shows the reason when switching fails, and can try again', async () => {
      const w = await mountCheck();
      w.services.mockRejectedValueOnce({ code: 'service_not_found', message: 'Service not found' });
      await startCheck(w);
      expect(checkPrompt(w)).toBe('Could not switch Smart Curtain Track: Service not found');
      w.services.mockClear();
      await answer(w, 'again');
      expect(serviceNames(w)[0]).toBe('cover.close_cover');
    });

    it('says, and keeps saying, when a load could not be put back, and can try again or skip', async () => {
      const w = await mountCheck();
      w.services.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce({ message: 'Offline' });
      await startCheck(w);
      await afterTwoSeconds(w);
      expect(checkPrompt(w)).toBe('Could not put Smart Curtain Track back. Check it by hand.');
      expect(root(w.el as HTMLElement).querySelector('.check-prompt.check-problem')).not.toBeNull();
      await w.tick(10_000); // not a notice that goes away
      expect(checkPrompt(w)).toBe('Could not put Smart Curtain Track back. Check it by hand.');
      expect(gone(w, '.check-ok')).toBe(true);
      expect(text(q(w.el, '.check-again'))).toBe('Again');
      await answer(w, 'skip');
      expect(text(q(w.el, '.check-progress'))).toBe('2 / 3');
    });
  });

  describe('leaving in the middle of a step', () => {
    it('Stop puts the load back at once, closes the bar and says what was done', async () => {
      const w = await mountCheck();
      await startCheck(w);
      await afterTwoSeconds(w);
      await answer(w, 'ok');
      await w.tick(500);
      expect(serviceNames(w).at(-1)).toBe('switch.turn_off');

      click(q(w.el, '.check-stop'));
      await w.tick();
      expect(serviceCalls(w).slice(-2)).toEqual([
        ['switch', 'turn_off', { entity_id: 'switch.l1_gang1' }],
        ['switch', 'turn_on', { entity_id: 'switch.l1_gang1' }],
      ]);
      expect(gone(w, '.check')).toBe(true);
      expect(text(q(w.el, '.notice'))).toBe('Check all stopped. 1 OK, 0 to relink.');
      expect(w.selections.at(-1)).toEqual([]);

      const count = serviceCalls(w).length;
      await w.tick(5000);
      expect(serviceCalls(w)).toHaveLength(count);
    });

    it('Stop goes back to a walk that was on, with its elements', async () => {
      const w = await mountCheck();
      await startWalk(w);
      await startCheck(w);
      await w.tick(300);
      click(q(w.el, '.check-stop'));
      await w.tick();
      expect(prompt(w)).toBe("Wave at the sensor, or open the door it's on");
      expect(w.subs).toHaveLength(2);
    });

    it('puts the load back when link mode is closed', async () => {
      const w = await mountCheck();
      await startCheck(w);
      await w.tick(500);
      expect(serviceNames(w)).toEqual(['cover.close_cover']);

      w.el.remove();
      await w.tick();
      expect(serviceNames(w)).toEqual(['cover.close_cover', 'cover.stop_cover', 'cover.set_cover_position']);
      const count = serviceCalls(w).length;
      await w.tick(5000);
      expect(serviceCalls(w)).toHaveLength(count);
    });

    it('puts the load back when Done is pressed, which closes link mode', async () => {
      const w = await mountCheck();
      await startCheck(w);
      await afterTwoSeconds(w);
      await answer(w, 'ok');
      await w.tick(700);
      const done = vi.fn(() => w.el.remove()); // the panel takes link mode away
      w.el.addEventListener('maxsen-link-done', done);
      click(q(w.el, '.done'));
      await w.tick();
      expect(done).toHaveBeenCalledTimes(1);
      expect(serviceCalls(w).slice(-2)).toEqual([
        ['switch', 'turn_off', { entity_id: 'switch.l1_gang1' }],
        ['switch', 'turn_on', { entity_id: 'switch.l1_gang1' }],
      ]);
    });

    it('does nothing more after it was removed between steps', async () => {
      const w = await mountCheck();
      await startCheck(w);
      await afterTwoSeconds(w);
      const count = serviceCalls(w).length;
      w.el.remove();
      await w.tick(5000);
      expect(serviceCalls(w)).toHaveLength(count);
    });
  });
});

describe('Check all: what it switches must not be heard as a press', () => {
  /** Zigbee reports 400 ms after the call. */
  const lag = (w: Checking) =>
    w.services.mockImplementation(async (...args: unknown[]) => {
      const [, service, data] = args as [string, string, { entity_id: string }];
      if (service !== 'turn_on' && service !== 'turn_off') return undefined;
      setTimeout(() => {
        w.hass.states[data.entity_id] = { state: service === 'turn_on' ? 'on' : 'off', attributes: {} };
      }, 400);
      return undefined;
    });

  it('listens again only after the load has reported being back', async () => {
    const w = await mountCheck();
    await startWalk(w);
    const subscribe = w.hass.connection.subscribeMessage as ReturnType<typeof vi.fn>;
    subscribe.mockClear();
    lag(w);
    await startCheck(w);
    await afterTwoSeconds(w);
    await answer(w, 'ok'); // the curtain; the first gang is switched off now
    await w.tick(1000);
    expect(w.hass.states['switch.l1_gang1']!.state).toBe('off');

    click(q(w.el, '.check-stop'));
    await w.tick(100);
    expect(serviceNames(w).at(-1)).toBe('switch.turn_on');
    expect(w.hass.states['switch.l1_gang1']!.state).toBe('off'); // the put-back has not landed
    expect(subscribe).not.toHaveBeenCalled();
    expect(text(q(w.el, '.check-progress'))).toBe('2 / 3'); // still closing

    await w.tick(500);
    expect(w.hass.states['switch.l1_gang1']!.state).toBe('on');
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(gone(w, '.check')).toBe(true);
  });

  it('waits in the same way when Relink now follows a Wrong while the load is coming back', async () => {
    const w = await mountCheck();
    lag(w);
    await startCheck(w);
    await afterTwoSeconds(w);
    await answer(w, 'ok');
    await afterTwoSeconds(w);
    await w.tick(500); // landed: asking
    expect(text(q(w.el, '.check-ok'))).toBe('OK');
    await answer(w, 'wrong'); // unlinks dl1, dl2
    await afterTwoSeconds(w);
    await w.tick(500);
    await answer(w, 'ok');
    const subscribe = w.hass.connection.subscribeMessage as ReturnType<typeof vi.fn>;
    expect(subscribe).not.toHaveBeenCalled();
    click(q(w.el, '.check-close'));
    await w.tick();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('puts the step back when the screen is turned off, and says so', async () => {
    const w = await mountCheck();
    await startCheck(w);
    await w.tick(500);
    const hide = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    hide('hidden');
    await w.tick();
    expect(serviceNames(w)).toEqual(['cover.close_cover', 'cover.stop_cover', 'cover.set_cover_position']);
    expect(checkPrompt(w)).toBe('Smart Curtain Track was put back when the screen turned off. Run it again.');
    hide('visible');
    await w.tick(5000);
    expect(serviceNames(w)).toHaveLength(3); // nothing more happens by itself
    await answer(w, 'again');
    expect(checkPrompt(w)).toBe('Watch now. It switches for 2 seconds, then goes back.');
    expect(serviceNames(w)).toHaveLength(4);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('ignores the screen turning off between steps, and stops listening for it when Check all is over', async () => {
    const w = await mountCheck();
    await startCheck(w);
    await afterTwoSeconds(w); // asking
    const hide = () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    hide();
    await w.tick();
    expect(checkPrompt(w)).toBe('Was it the right one?');
    click(q(w.el, '.check-stop'));
    await w.tick();
    const count = serviceCalls(w).length;
    hide();
    await w.tick();
    expect(serviceCalls(w)).toHaveLength(count);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('removes the screen listener when link mode is closed', async () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const w = await mountCheck();
    await startCheck(w);
    w.el.remove();
    await w.tick();
    expect(remove.mock.calls.some(([type]) => type === 'visibilitychange')).toBe(true);
  });

  it('highlights the switch too when a gang is also a gang of a linked switch, and names it', async () => {
    const w = await mountCheck({
      links: { sw1: { type: 'device', id: 'dev-sw' }, dl1: { type: 'entity', id: 'switch.sw_1' } },
      without: ['cur1', 'dl2', 'dl3'],
      hass: (h) => {
        h.devices['dev-sw'] = { id: 'dev-sw', name: 'Entrance switch' };
        for (const n of [1, 2, 3]) {
          h.entities[`switch.sw_${n}`] = { entity_id: `switch.sw_${n}`, device_id: 'dev-sw' };
          h.states[`switch.sw_${n}`] = { state: 'off', attributes: {} };
        }
      },
    });
    await startCheck(w);
    expect(text(q(w.el, '.check-for'))).toBe('Luna Downlight · via Entrance switch, gang 1 of 3 · Level 1');
    expect(w.selections.at(-1)).toEqual(['dl1', 'sw1']);
    expect(w.current.at(-1)).toBe('dl1');
    await afterTwoSeconds(w);
    await answer(w, 'wrong');
    expect(linkCalls(w)).toEqual([{ type: 'maxsen/links/set', entry_id: 'e1', updates: { dl1: null } }]);
  });
});
