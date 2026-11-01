import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/maxsen-home-panel.ts';
import '../src/maxsen-floorplan-card.ts';
import { layoutFor, type MaxsenHomePanel } from '../src/maxsen-home-panel.ts';
import type { MaxsenFloorplanCard } from '../src/maxsen-floorplan-card.ts';
import type { HassLike, HomeResponse } from '../src/types.ts';
import { makeHass } from './helpers.ts';
import { homeResponse, settle } from './view-helpers.ts';

type Handler = (msg: { event: string }) => void;

type Entry = { entry_id: string; state: string };

interface Fake {
  hass: HassLike;
  /** Send a server event to every live `maxsen/subscribe`. */
  deliver(event: string): void;
  /** Called whenever the panel calls a subscription's unsubscribe function. */
  unsubscribe: ReturnType<typeof vi.fn<() => void>>;
  homeCalls(): number;
  entryCalls(): number;
  subscribeCalls(): number;
  setHome(home: HomeResponse): void;
  setEntries(entries: Entry[]): void;
  /** The websocket came back after a drop (home-assistant-js-websocket's "ready" event). */
  reconnect(): void;
  /** How many "ready" listeners are registered. */
  readyListeners(): number;
  /** The subscriptions the server holds right now. */
  liveSubscriptions(): number;
  /** The ids of every `unsubscribe_events` the panel caused, and those the server did not know (`not_found`). */
  unsubscribeIds(): number[];
  staleUnsubscribes(): number[];
}

interface Sub {
  callback: Handler;
  resubscribe: boolean;
  /** What the function the panel holds does right now: it first targets the id the subscription had when made. */
  unsubscribe: () => Promise<void>;
}

/**
 * A hass whose websocket answers the Maxsen commands. Its connection behaves like
 * home-assistant-js-websocket: after a reconnect it numbers commands from 1 again and
 * resubscribes every subscription not made with `resubscribe: false` itself, fires `ready`, and
 * only then points the subscription's unsubscribe at the new id. Until then (and for a
 * subscription that was not resubscribed) unsubscribing sends the old id, which the server
 * answers with `not_found` unless it happens to belong to another subscription.
 */
function fakeHass(entries: Entry[] = [{ entry_id: 'e1', state: 'loaded' }], first = homeResponse()): Fake {
  const hass = makeHass();
  let home = first;
  let currentEntries = entries;
  let nextId = 1;
  const server = new Map<number, Sub>();
  const unsubscribeIds: number[] = [];
  const stale: number[] = [];
  const unsubscribe = vi.fn<() => void>();
  const callWS = vi.spyOn(hass, 'callWS').mockImplementation((async (msg: { type: string }) => {
    if (msg.type === 'config_entries/get') return currentEntries;
    if (msg.type === 'maxsen/home') return structuredClone(home);
    throw new Error(`unexpected ${msg.type}`);
  }) as never);
  const sendUnsubscribe = async (id: number): Promise<void> => {
    unsubscribeIds.push(id);
    if (!server.delete(id)) {
      stale.push(id);
      throw { code: 'not_found', message: 'Subscription not found.' };
    }
  };
  vi.spyOn(hass.connection, 'subscribeMessage').mockImplementation((async (
    callback: Handler,
    _message: unknown,
    options?: { resubscribe?: boolean },
  ) => {
    const id = nextId++;
    const sub: Sub = {
      callback,
      resubscribe: options?.resubscribe !== false,
      unsubscribe: () => sendUnsubscribe(id),
    };
    server.set(id, sub);
    return () => {
      unsubscribe();
      return sub.unsubscribe();
    };
  }) as never);
  vi.spyOn(hass, 'fetchWithAuth').mockImplementation(
    async () => new Response(new Blob(['png']), { status: 200 }),
  );
  const ready = new Set<() => void>();
  hass.connection.addEventListener = (event, listener) => {
    if (event === 'ready') ready.add(listener);
  };
  hass.connection.removeEventListener = (event, listener) => {
    if (event === 'ready') ready.delete(listener);
  };
  return {
    hass,
    deliver: (event) => [...server.values()].forEach((sub) => sub.callback({ event })),
    unsubscribe,
    homeCalls: () => callWS.mock.calls.filter((c) => c[0].type === 'maxsen/home').length,
    entryCalls: () => callWS.mock.calls.filter((c) => c[0].type === 'config_entries/get').length,
    subscribeCalls: () => vi.mocked(hass.connection.subscribeMessage).mock.calls.length,
    setHome: (h) => (home = h),
    setEntries: (e) => (currentEntries = e),
    reconnect: () => {
      const before = [...server.values()];
      server.clear();
      nextId = 1;
      const again = before.filter((sub) => sub.resubscribe);
      const ids = again.map((sub) => {
        const id = nextId++;
        server.set(id, sub);
        return id;
      });
      for (const listener of [...ready]) listener();
      again.forEach((sub, i) => (sub.unsubscribe = () => sendUnsubscribe(ids[i]!)));
    },
    readyListeners: () => ready.size,
    liveSubscriptions: () => server.size,
    unsubscribeIds: () => [...unsubscribeIds],
    staleUnsubscribes: () => [...stale],
  };
}

/** Let pending promises and zero-delay timers run while timers are faked. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
}

const UNKNOWN_COMMAND = { code: 'unknown_command', message: 'Unknown command.' };
const NOT_FOUND = { code: 'not_found', message: 'Unknown home' };

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
    expect(fake.hass.connection.subscribeMessage).toHaveBeenCalledWith(
      expect.any(Function),
      { type: 'maxsen/subscribe', entry_id: 'e1' },
      { resubscribe: false },
    );
    // The quick panel sits in the slot beside (or under) the drawing.
    const slot = panel.shadowRoot!.querySelector('.quick-panel-slot');
    expect(slot).not.toBeNull();
    const quick = slot!.querySelector('maxsen-quick-panel')!;
    expect(quick.hass).toBe(fake.hass);
    expect(quick.home?.package?.project.title).toBe('Test House');
    expect(quick.entryId).toBe('e1');
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

  it('says "not set up yet" only when no maxsen entry exists on a fresh start', async () => {
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

describe('<maxsen-home-panel> after Home Assistant restarts', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads and subscribes again when the connection is back, retrying while Maxsen is still starting', async () => {
    const fake = fakeHass();
    const panel = await mountPanel({ hass: fake.hass });
    expect(fake.subscribeCalls()).toBe(1);
    vi.useFakeTimers();
    // Right after the restart the maxsen commands are not registered yet.
    vi.mocked(fake.hass.connection.subscribeMessage).mockRejectedValueOnce(UNKNOWN_COMMAND);

    fake.reconnect();
    await flush();

    // home-assistant-js-websocket dropped the old subscription itself; the handle is not used.
    expect(fake.unsubscribe).not.toHaveBeenCalled();
    expect(fake.homeCalls()).toBe(2);
    expect(fake.subscribeCalls()).toBe(2);
    // The home stays on screen while it retries.
    expect(panel.shadowRoot!.querySelector('maxsen-floorplan-view')).not.toBeNull();
    expect(panel.shadowRoot!.textContent).not.toContain('Could not load the home');

    await vi.advanceTimersByTimeAsync(1999);
    expect(fake.subscribeCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(fake.subscribeCalls()).toBe(3);

    // Events flow again.
    fake.setHome(homeResponse({ links: { dl1: { type: 'entity', id: 'light.a' } } }));
    fake.deliver('links');
    await flush();
    expect(panel.shadowRoot!.querySelector('maxsen-floorplan-view')!.home?.links).toHaveProperty('dl1');

    // Once it works it stops retrying.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fake.subscribeCalls()).toBe(3);
  });

  it('does not say "not set up yet" for an entry that is listed but still loading on a fresh start', async () => {
    vi.useFakeTimers();
    const fake = fakeHass([{ entry_id: 'e1', state: 'setup_in_progress' }]);
    const panel = document.createElement('maxsen-home-panel') as MaxsenHomePanel;
    panel.hass = fake.hass;
    document.body.append(panel);
    await flush();
    expect(panel.shadowRoot!.textContent).not.toContain('not set up');
    expect(fake.subscribeCalls()).toBe(0);

    fake.setEntries([{ entry_id: 'e1', state: 'loaded' }]);
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    expect(panel.shadowRoot!.querySelector('maxsen-floorplan-view')).not.toBeNull();
    expect(fake.subscribeCalls()).toBe(1);
  });

  it('stays on the home and retries while the entry is still loading after a reconnect', async () => {
    const fake = fakeHass();
    const panel = await mountPanel({ hass: fake.hass });
    vi.useFakeTimers();
    // The websocket accepts clients before Maxsen has finished loading.
    fake.setEntries([{ entry_id: 'e1', state: 'setup_in_progress' }]);
    const seen: string[] = [];
    const watch = (): void => void seen.push(panel.shadowRoot!.textContent ?? '');

    fake.reconnect();
    await flush();
    watch();

    expect(panel.shadowRoot!.querySelector('maxsen-floorplan-view')).not.toBeNull();
    expect(fake.subscribeCalls()).toBe(1); // nothing to subscribe to yet
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fake.entryCalls()).toBe(2);
    fake.setEntries([{ entry_id: 'e1', state: 'loaded' }]);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    watch();

    expect(fake.entryCalls()).toBe(3);
    expect(fake.subscribeCalls()).toBe(2);
    expect(fake.liveSubscriptions()).toBe(1);
    expect(panel.shadowRoot!.querySelector('maxsen-floorplan-view')).not.toBeNull();
    for (const text of seen) {
      expect(text).not.toContain('not set up');
      expect(text).not.toContain('Loading');
      expect(text).not.toContain('Could not load');
    }
    fake.setHome(homeResponse({ links: { dl1: { type: 'entity', id: 'light.a' } } }));
    fake.deliver('links');
    await flush();
    expect(panel.shadowRoot!.querySelector('maxsen-floorplan-view')!.home?.links).toHaveProperty('dl1');
  });

  it('leaves one subscription after three reconnects, never unsubscribing a previous connection', async () => {
    const fake = fakeHass();
    const panel = await mountPanel({ hass: fake.hass });
    expect(fake.liveSubscriptions()).toBe(1);

    for (let i = 0; i < 3; i++) {
      fake.reconnect();
      await settle(panel);
    }

    expect(fake.liveSubscriptions()).toBe(1);
    expect(fake.subscribeCalls()).toBe(4);
    for (const call of vi.mocked(fake.hass.connection.subscribeMessage).mock.calls) {
      expect(call[2]).toEqual({ resubscribe: false });
    }
    expect(fake.unsubscribeIds()).toEqual([]);
    expect(fake.staleUnsubscribes()).toEqual([]);
    // One server event is one reload, not one per leftover subscription.
    const loads = fake.homeCalls();
    fake.deliver('home');
    await settle(panel);
    expect(fake.homeCalls()).toBe(loads + 1);
  });

  it('does not flash Loading on a quiet reconnect, and looks the entry up once', async () => {
    const fake = fakeHass();
    const panel = await mountPanel({ hass: fake.hass, panel: { config: {} } });
    expect(fake.entryCalls()).toBe(1);
    const texts: string[] = [];
    const observer = new MutationObserver(() => texts.push(panel.shadowRoot!.textContent ?? ''));
    observer.observe(panel.shadowRoot!, { childList: true, subtree: true, characterData: true });
    const shown = panel.shadowRoot!.querySelector('maxsen-floorplan-view');

    fake.reconnect();
    // Home Assistant hands the panel a fresh `panel` object when it is back.
    panel.panel = { config: {} };
    await settle(panel);
    observer.disconnect();

    expect(fake.entryCalls()).toBe(2);
    expect(fake.homeCalls()).toBe(2);
    expect(texts.filter((t) => t.includes('Loading'))).toEqual([]);
    expect(panel.shadowRoot!.querySelector('maxsen-floorplan-view')).toBe(shown);
    expect(fake.liveSubscriptions()).toBe(1);
  });

  it('backs off 2 s, 5 s, 10 s, then tries every 30 s', async () => {
    const fake = fakeHass();
    await mountPanel({ hass: fake.hass });
    vi.useFakeTimers();
    vi.mocked(fake.hass.connection.subscribeMessage).mockRejectedValue(UNKNOWN_COMMAND);

    fake.reconnect();
    await flush();
    const tries = [fake.subscribeCalls()];
    for (const wait of [2_000, 5_000, 10_000, 30_000, 30_000]) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(fake.subscribeCalls()).toBe(tries[tries.length - 1]);
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      tries.push(fake.subscribeCalls());
    }
    expect(tries).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('retries a first load that fails while Maxsen is still loading', async () => {
    vi.useFakeTimers();
    const fake = fakeHass();
    // The entry is listed, but maxsen/home answers not_found until it has finished loading.
    const answer = vi.mocked(fake.hass.callWS).getMockImplementation()!;
    let loading = true;
    vi.mocked(fake.hass.callWS).mockImplementation((async (msg: { type: string }) => {
      if (msg.type === 'maxsen/home' && loading) {
        loading = false;
        throw NOT_FOUND;
      }
      return answer(msg);
    }) as never);
    const panel = document.createElement('maxsen-home-panel') as MaxsenHomePanel;
    panel.hass = fake.hass;
    document.body.append(panel);
    await flush();
    expect(panel.shadowRoot!.textContent).toContain('Could not load the home');

    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    expect(panel.shadowRoot!.querySelector('maxsen-floorplan-view')).not.toBeNull();
    expect(fake.subscribeCalls()).toBe(1);
  });

  it('stops retrying and stops listening for reconnects when removed', async () => {
    const fake = fakeHass();
    const panel = await mountPanel({ hass: fake.hass });
    expect(fake.readyListeners()).toBe(1);
    vi.useFakeTimers();
    vi.mocked(fake.hass.connection.subscribeMessage).mockRejectedValue(UNKNOWN_COMMAND);
    fake.reconnect();
    await flush();
    const calls = fake.subscribeCalls();

    panel.remove();
    await vi.advanceTimersByTimeAsync(120_000);
    fake.reconnect();
    await flush();

    expect(fake.readyListeners()).toBe(0);
    expect(fake.subscribeCalls()).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('listens once, however often Home Assistant hands it a new hass', async () => {
    const fake = fakeHass();
    const panel = await mountPanel({ hass: fake.hass });
    panel.hass = { ...fake.hass };
    await settle(panel);
    panel.hass = { ...fake.hass };
    await settle(panel);
    expect(fake.readyListeners()).toBe(1);
  });
});

describe('installer tools in the panel', () => {
  const linkable = () => homeResponse({ installer_mode: true });
  const installerButton = (panel: Element): HTMLButtonElement | null =>
    panel.shadowRoot!.querySelector<HTMLButtonElement>('button.installer');
  const viewOf = (panel: Element) => panel.shadowRoot!.querySelector('maxsen-floorplan-view')!;
  const linkModeOf = (panel: Element) => panel.shadowRoot!.querySelector('maxsen-link-mode');

  it('shows the Installer button to an administrator when installer mode is on', async () => {
    const fake = fakeHass(undefined, linkable());
    const panel = await mountPanel({ hass: fake.hass });
    expect(installerButton(panel)?.textContent?.trim()).toBe('Installer');
  });

  it('hides it from a user who is not an administrator', async () => {
    const fake = fakeHass(undefined, linkable());
    fake.hass.user = { is_admin: false };
    const panel = await mountPanel({ hass: fake.hass });
    expect(installerButton(panel)).toBeNull();
  });

  it('hides it when installer mode is off', async () => {
    const fake = fakeHass(undefined, homeResponse({ installer_mode: false }));
    const panel = await mountPanel({ hass: fake.hass });
    expect(installerButton(panel)).toBeNull();
    expect(panel.shadowRoot!.querySelector('maxsen-quick-panel')).not.toBeNull();
  });

  it('swaps the quick panel for the link tools, and the view into link mode, until Done', async () => {
    const fake = fakeHass(undefined, linkable());
    const panel = await mountPanel({ hass: fake.hass });
    expect(linkModeOf(panel)).toBeNull();

    installerButton(panel)!.click();
    await settle(panel);

    const tools = linkModeOf(panel)!;
    expect(tools).not.toBeNull();
    expect(tools.entryId).toBe('e1');
    expect(tools.home?.installer_mode).toBe(true);
    expect(panel.shadowRoot!.querySelector('maxsen-quick-panel')).toBeNull();
    expect(viewOf(panel).mode).toBe('link');

    tools.shadowRoot!.querySelector<HTMLButtonElement>('.done')!.click();
    await settle(panel);

    expect(linkModeOf(panel)).toBeNull();
    expect(panel.shadowRoot!.querySelector('maxsen-quick-panel')).not.toBeNull();
    expect(viewOf(panel).mode).toBe('use');
  });

  it('passes taps on the drawing to the link tools and the selection back to the drawing', async () => {
    const fake = fakeHass(undefined, linkable());
    const panel = await mountPanel({ hass: fake.hass });
    installerButton(panel)!.click();
    await settle(panel);

    viewOf(panel).dispatchEvent(
      new CustomEvent('maxsen-element-tap', { detail: { elementId: 'dl1' }, bubbles: true, composed: true }),
    );
    await settle(panel);

    expect(viewOf(panel).selected).toEqual(['dl1']);
    expect(linkModeOf(panel)!.shadowRoot!.textContent).toContain('Luna Downlight');

    linkModeOf(panel)!.shadowRoot!.querySelector<HTMLButtonElement>('.done')!.click();
    await settle(panel);
    expect(viewOf(panel).selected).toEqual([]);
  });

  it('leaves link mode when installer mode is switched off', async () => {
    const fake = fakeHass(undefined, linkable());
    const panel = await mountPanel({ hass: fake.hass });
    installerButton(panel)!.click();
    await settle(panel);
    expect(linkModeOf(panel)).not.toBeNull();

    fake.setHome(homeResponse({ installer_mode: false }));
    fake.deliver('home');
    await settle(panel);

    expect(linkModeOf(panel)).toBeNull();
    expect(viewOf(panel).mode).toBe('use');
    expect(installerButton(panel)).toBeNull();
  });

  it('leaves link mode when the user stops being an administrator', async () => {
    const fake = fakeHass(undefined, linkable());
    const panel = await mountPanel({ hass: fake.hass });
    installerButton(panel)!.click();
    await settle(panel);

    panel.hass = { ...fake.hass, user: { is_admin: false } };
    await settle(panel);

    expect(linkModeOf(panel)).toBeNull();
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
