import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStarterScenes,
  findEntryId,
  getHome,
  loadImage,
  refreshApply,
  refreshPreview,
  setLinks,
  setQuickPanel,
  subscribe,
} from '../src/api.ts';
import { makeHass } from './helpers.ts';

afterEach(() => vi.restoreAllMocks());

describe('websocket wrappers', () => {
  it('send the documented messages', async () => {
    const hass = makeHass();
    const callWS = vi.spyOn(hass, 'callWS').mockResolvedValue(undefined as never);

    await getHome(hass, 'e1');
    await setLinks(hass, 'e1', { dl1: { type: 'entity', id: 'light.a' }, dl2: null });
    await setQuickPanel(hass, 'e1', [{ type: 'element', id: 'dl1' }]);
    await refreshPreview(hass, 'e1');
    await refreshPreview(hass, 'e1', 'file-9');
    await refreshApply(hass, 'e1', 'p1');
    await createStarterScenes(hass, 'e1');

    expect(callWS.mock.calls.map((c) => c[0])).toEqual([
      { type: 'maxsen/home', entry_id: 'e1' },
      {
        type: 'maxsen/links/set',
        entry_id: 'e1',
        updates: { dl1: { type: 'entity', id: 'light.a' }, dl2: null },
      },
      { type: 'maxsen/quick_panel/set', entry_id: 'e1', items: [{ type: 'element', id: 'dl1' }] },
      { type: 'maxsen/refresh/preview', entry_id: 'e1' },
      { type: 'maxsen/refresh/preview', entry_id: 'e1', file_id: 'file-9' },
      { type: 'maxsen/refresh/apply', entry_id: 'e1', preview_id: 'p1' },
      { type: 'maxsen/scenes/create_starter', entry_id: 'e1' },
    ]);
  });

  it('finds the first loaded Maxsen entry', async () => {
    const hass = makeHass();
    vi.spyOn(hass, 'callWS').mockResolvedValue([
      { entry_id: 'broken', state: 'setup_error' },
      { entry_id: 'ok', state: 'loaded' },
    ] as never);
    expect(await findEntryId(hass)).toBe('ok');
    expect(hass.callWS).toHaveBeenCalledWith({ type: 'config_entries/get', domain: 'maxsen' });
  });

  it('finds nothing when no entry is loaded', async () => {
    const hass = makeHass();
    vi.spyOn(hass, 'callWS').mockResolvedValue([] as never);
    expect(await findEntryId(hass)).toBeUndefined();
  });
});

describe('subscribe', () => {
  it('passes each event name on and resolves to the unsubscribe function', async () => {
    const hass = makeHass();
    const unsub = vi.fn();
    let deliver: (m: { event: string }) => void = () => undefined;
    const spy = vi
      .spyOn(hass.connection, 'subscribeMessage')
      .mockImplementation(async (cb) => {
        deliver = cb as typeof deliver;
        return unsub;
      });
    const seen: string[] = [];

    const stop = await subscribe(hass, 'e1', (e) => seen.push(e));
    deliver({ event: 'links' });
    deliver({ event: 'home' });

    expect(spy.mock.calls[0]?.[1]).toEqual({ type: 'maxsen/subscribe', entry_id: 'e1' });
    expect(seen).toEqual(['links', 'home']);
    expect(stop).toBe(unsub);
  });
});

describe('loadImage', () => {
  it('fetches with auth and returns an object URL for the blob', async () => {
    const hass = makeHass();
    const blob = new Blob(['png'], { type: 'image/png' });
    const fetchWithAuth = vi
      .spyOn(hass, 'fetchWithAuth')
      .mockResolvedValue(new Response(blob, { status: 200 }));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:one');

    expect(await loadImage(hass, '/api/maxsen/image/e1/file-l1')).toBe('blob:one');
    expect(fetchWithAuth).toHaveBeenCalledWith('/api/maxsen/image/e1/file-l1');
    expect(create).toHaveBeenCalledOnce();
  });

  it('rejects and creates no URL when the image is not served', async () => {
    const hass = makeHass();
    const create = vi.spyOn(URL, 'createObjectURL');
    await expect(loadImage(hass, '/api/maxsen/image/e1/x')).rejects.toThrow('404');
    expect(create).not.toHaveBeenCalled();
  });
});
