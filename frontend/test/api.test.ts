import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStarterScenes,
  findEntry,
  getHome,
  loadImage,
  refreshApply,
  refreshPreview,
  setDisplay,
  setLinks,
  setQuickPanel,
  subscribe,
  uploadHomeFile,
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
    await setDisplay(hass, 'e1', 'original');

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
      { type: 'maxsen/display/set', entry_id: 'e1', background: 'original' },
    ]);
  });

  it('finds the first loaded Maxsen entry, with its state', async () => {
    const hass = makeHass();
    vi.spyOn(hass, 'callWS').mockResolvedValue([
      { entry_id: 'broken', state: 'setup_error' },
      { entry_id: 'ok', state: 'loaded' },
    ] as never);
    expect(await findEntry(hass)).toEqual({ entryId: 'ok', state: 'loaded' });
    expect(hass.callWS).toHaveBeenCalledWith({ type: 'config_entries/get', domain: 'maxsen' });
  });

  it('reports an entry that is listed but not loaded, rather than none', async () => {
    const hass = makeHass();
    vi.spyOn(hass, 'callWS').mockResolvedValue([{ entry_id: 'e1', state: 'not_loaded' }] as never);
    expect(await findEntry(hass)).toEqual({ entryId: 'e1', state: 'not_loaded' });
  });

  it('finds nothing when no entry exists', async () => {
    const hass = makeHass();
    vi.spyOn(hass, 'callWS').mockResolvedValue([] as never);
    expect(await findEntry(hass)).toBeUndefined();
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

  it('passes { resubscribe: false }, so a reconnect does not bring the subscription back on its own', async () => {
    const hass = makeHass();
    const spy = vi.spyOn(hass.connection, 'subscribeMessage').mockResolvedValue(() => undefined);
    await subscribe(hass, 'e1', () => undefined);
    expect(spy.mock.calls[0]?.[2]).toEqual({ resubscribe: false });
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

describe('uploadHomeFile', () => {
  const file = new File(['{}'], 'home.json', { type: 'application/json' });

  it('posts the file as multipart to the upload endpoint and returns the file id', async () => {
    const hass = makeHass();
    const fetch = vi
      .spyOn(hass, 'fetchWithAuth')
      .mockResolvedValue(new Response(JSON.stringify({ file_id: 'f-1' }), { status: 200 }));

    expect(await uploadHomeFile(hass, file)).toBe('f-1');

    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe('/api/file_upload');
    expect(init?.method).toBe('POST');
    expect((init?.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('throws when Home Assistant refuses the file or answers without an id', async () => {
    const hass = makeHass();
    const fetch = vi.spyOn(hass, 'fetchWithAuth');
    fetch.mockResolvedValueOnce(new Response('no', { status: 413 }));
    await expect(uploadHomeFile(hass, file)).rejects.toThrow('413');
    fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(uploadHomeFile(hass, file)).rejects.toThrow('no file id');
  });
});
