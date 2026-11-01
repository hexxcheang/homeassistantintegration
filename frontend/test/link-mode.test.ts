import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/link-mode.ts';
import type { MaxsenLinkMode } from '../src/link-mode.ts';
import type { HassLike, HomeResponse, Link, RefreshSummary } from '../src/types.ts';
import { makeHass } from './helpers.ts';
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
    for (const selector of ['.toolbar button', '.candidate', '.dialog button', '.not-drawn-row']) {
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

    expect(callWS).toHaveBeenCalledWith({
      type: 'maxsen/links/set',
      entry_id: 'e1',
      updates: { sw1: HALL },
    });
    expect(text(q(el, '.notice'))).toBe('Linked.');
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
