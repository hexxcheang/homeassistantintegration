import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/maxsen-home-panel.ts';
import '../src/maxsen-floorplan-card.ts';
import { layoutFor, type MaxsenHomePanel } from '../src/maxsen-home-panel.ts';
import type { MaxsenFloorplanCard } from '../src/maxsen-floorplan-card.ts';
import type { HassLike, HomeResponse } from '../src/types.ts';
import { makeHass } from './helpers.ts';
import { homeResponse, settle } from './view-helpers.ts';

type Handler = (msg: { event: string }) => void;

interface Fake {
  hass: HassLike;
  deliver(event: string): void;
  unsubscribe: ReturnType<typeof vi.fn<() => void>>;
  homeCalls(): number;
  setHome(home: HomeResponse): void;
}

/** A hass whose websocket answers the Maxsen commands. */
function fakeHass(entries = [{ entry_id: 'e1', state: 'loaded' }], first = homeResponse()): Fake {
  const hass = makeHass();
  let home = first;
  let handler: Handler = () => undefined;
  const unsubscribe = vi.fn<() => void>();
  const callWS = vi.spyOn(hass, 'callWS').mockImplementation((async (msg: { type: string }) => {
    if (msg.type === 'config_entries/get') return entries;
    if (msg.type === 'maxsen/home') return structuredClone(home);
    throw new Error(`unexpected ${msg.type}`);
  }) as never);
  vi.spyOn(hass.connection, 'subscribeMessage').mockImplementation((async (cb: Handler) => {
    handler = cb;
    return unsubscribe;
  }) as never);
  vi.spyOn(hass, 'fetchWithAuth').mockImplementation(
    async () => new Response(new Blob(['png']), { status: 200 }),
  );
  return {
    hass,
    deliver: (event) => handler({ event }),
    unsubscribe,
    homeCalls: () => callWS.mock.calls.filter((c) => c[0].type === 'maxsen/home').length,
    setHome: (h) => (home = h),
  };
}

/** The text the view shows, one shadow root down from the panel. */
const viewText = (panel: Element): string =>
  panel.shadowRoot!.querySelector('maxsen-floorplan-view')!.shadowRoot!.textContent ?? '';

async function mountPanel(props: Partial<MaxsenHomePanel>): Promise<MaxsenHomePanel> {
  const el = document.createElement('maxsen-home-panel') as MaxsenHomePanel;
  Object.assign(el, props);
  document.body.append(el);
  await settle(el);
  return el;
}

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('layoutFor', () => {
  it('is side by side only when landscape and at least 900 px wide', () => {
    expect(layoutFor(1200, 800)).toBe('side');
    expect(layoutFor(900, 600)).toBe('side');
    expect(layoutFor(899, 500)).toBe('stacked');
    expect(layoutFor(1000, 1200)).toBe('stacked');
    expect(layoutFor(0, 0)).toBe('stacked');
  });
});

describe('<maxsen-home-panel>', () => {
  it('finds the first loaded Maxsen entry, loads the home and gives it to the view', async () => {
    const fake = fakeHass([
      { entry_id: 'broken', state: 'setup_error' },
      { entry_id: 'e1', state: 'loaded' },
    ]);
    const panel = await mountPanel({ hass: fake.hass, narrow: false });

    const view = panel.shadowRoot!.querySelector('maxsen-floorplan-view')!;
    expect(view.home?.package?.project.title).toBe('Test House');
    expect(view.mode).toBe('use');
    expect(view.hass).toBe(fake.hass);
    expect(fake.hass.connection.subscribeMessage).toHaveBeenCalledWith(expect.any(Function), {
      type: 'maxsen/subscribe',
      entry_id: 'e1',
    });
    // The quick panel (a later task) drops into an empty slot.
    const slot = panel.shadowRoot!.querySelector('.quick-panel-slot');
    expect(slot).not.toBeNull();
    expect(slot!.childElementCount).toBe(0);
  });

  it('uses the entry id from the panel config without looking one up', async () => {
    const fake = fakeHass([]);
    await mountPanel({ hass: fake.hass, panel: { config: { entry_id: 'chosen' } } });

    expect(fake.hass.callWS).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'config_entries/get' }),
    );
    expect(fake.hass.callWS).toHaveBeenCalledWith({ type: 'maxsen/home', entry_id: 'chosen' });
  });

  it('reloads the home when the server says something changed', async () => {
    const fake = fakeHass();
    const panel = await mountPanel({ hass: fake.hass });
    expect(fake.homeCalls()).toBe(1);

    fake.setHome(homeResponse({ links: { dl1: { type: 'entity', id: 'light.a' } } }));
    fake.deliver('links');
    await settle(panel);

    expect(fake.homeCalls()).toBe(2);
    expect(panel.shadowRoot!.querySelector('maxsen-floorplan-view')!.home?.links).toHaveProperty('dl1');
  });

  it('shows a message, not an error, when the home has no package yet', async () => {
    const fake = fakeHass(undefined, homeResponse({ package: null }));
    const panel = await mountPanel({ hass: fake.hass });

    expect(viewText(panel)).toContain('No home loaded yet. An installer adds it from the Maxsen Planner.');
  });

  it('says so when no Maxsen home is set up', async () => {
    const fake = fakeHass([]);
    const panel = await mountPanel({ hass: fake.hass });

    expect(panel.shadowRoot!.textContent).toContain('Maxsen Home is not set up');
    expect(fake.hass.connection.subscribeMessage).not.toHaveBeenCalled();
  });

  it('shows a retry button when the home cannot be loaded', async () => {
    const fake = fakeHass();
    const callWS = vi.mocked(fake.hass.callWS);
    callWS.mockRejectedValueOnce(new Error('offline'));
    const panel = await mountPanel({ hass: fake.hass });
    expect(panel.shadowRoot!.textContent).toContain('Could not load the home');

    panel.shadowRoot!.querySelector<HTMLButtonElement>('button.retry')!.click();
    await settle(panel);

    expect(panel.shadowRoot!.querySelector('maxsen-floorplan-view')).not.toBeNull();
  });

  it('stops listening when removed, even if it was removed before the subscription arrived', async () => {
    const fake = fakeHass();
    const panel = await mountPanel({ hass: fake.hass });
    panel.remove();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);

    const early = fakeHass();
    let resolve: (u: () => void) => void = () => undefined;
    vi.mocked(early.hass.connection.subscribeMessage).mockReturnValue(new Promise((r) => (resolve = r)));
    const p2 = document.createElement('maxsen-home-panel') as MaxsenHomePanel;
    p2.hass = early.hass;
    document.body.append(p2);
    await new Promise((r) => setTimeout(r, 0));
    p2.remove();
    resolve(early.unsubscribe);
    await new Promise((r) => setTimeout(r, 0));
    expect(early.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('<maxsen-floorplan-card>', () => {
  const mountCard = async (hass: HassLike, config: object = {}): Promise<MaxsenFloorplanCard> => {
    const card = document.createElement('maxsen-floorplan-card') as MaxsenFloorplanCard;
    card.setConfig(config);
    card.hass = hass;
    document.body.append(card);
    await settle(card);
    await settle(card.shadowRoot!.querySelector('maxsen-home-panel')!);
    return card;
  };

  it('is a Lovelace card of size 8, listed in customCards', () => {
    const card = document.createElement('maxsen-floorplan-card') as MaxsenFloorplanCard;
    expect(card.getCardSize()).toBe(8);
    const cards = (window as unknown as { customCards: { type: string }[] }).customCards;
    expect(cards.map((c) => c.type)).toContain('maxsen-floorplan-card');
  });

  it('rejects a config with a bad entry_id', () => {
    const card = document.createElement('maxsen-floorplan-card') as MaxsenFloorplanCard;
    expect(() => card.setConfig({ entry_id: 5 } as never)).toThrow('entry_id');
    expect(() => card.setConfig({})).not.toThrow();
  });

  it('draws the same layout as the panel, for the configured entry', async () => {
    const fake = fakeHass([]);
    const card = await mountCard(fake.hass, { entry_id: 'e9' });

    const inner = card.shadowRoot!.querySelector('maxsen-home-panel')!;
    expect(fake.hass.callWS).toHaveBeenCalledWith({ type: 'maxsen/home', entry_id: 'e9' });
    expect(inner.shadowRoot!.querySelector('maxsen-floorplan-view')).not.toBeNull();
    expect(inner.shadowRoot!.querySelector('.quick-panel-slot')).not.toBeNull();
    // A card has no sidebar toolbar of its own.
    expect(inner.shadowRoot!.querySelector('.header')).toBeNull();
  });

  it('shows the no-home message when the package is null', async () => {
    const fake = fakeHass(undefined, homeResponse({ package: null }));
    const card = await mountCard(fake.hass);
    const inner = card.shadowRoot!.querySelector('maxsen-home-panel')!;
    expect(viewText(inner)).toContain('No home loaded yet');
  });
});
