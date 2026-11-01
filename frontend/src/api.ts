import type { HassLike, HomeResponse, Link, QuickItem, RefreshSummary } from './types.ts';

/** What changed on the server; the view reloads the home on any of them. */
export type HomeEvent = 'home' | 'links' | 'quick_panel';

/** The id of the first loaded Maxsen home, or `undefined` when none is set up. */
export async function findEntryId(hass: HassLike): Promise<string | undefined> {
  const entries = await hass.callWS<{ entry_id: string; state: string }[]>({
    type: 'config_entries/get',
    domain: 'maxsen',
  });
  return entries.find((e) => e.state === 'loaded')?.entry_id;
}

export function getHome(hass: HassLike, entryId: string): Promise<HomeResponse> {
  return hass.callWS<HomeResponse>({ type: 'maxsen/home', entry_id: entryId });
}

/** Calls `callback` when the home, links or quick panel change. Resolves to the unsubscribe function. */
export function subscribe(
  hass: HassLike,
  entryId: string,
  callback: (event: HomeEvent) => void,
): Promise<() => void> {
  return hass.connection.subscribeMessage<{ event: HomeEvent }>((msg) => callback(msg.event), {
    type: 'maxsen/subscribe',
    entry_id: entryId,
  });
}

/** Link or unlink elements; a `null` value removes that element's link. Installer mode only. */
export function setLinks(
  hass: HassLike,
  entryId: string,
  updates: Record<string, Link | null>,
): Promise<{ links: Record<string, Link> }> {
  return hass.callWS({ type: 'maxsen/links/set', entry_id: entryId, updates });
}

export function setQuickPanel(
  hass: HassLike,
  entryId: string,
  items: QuickItem[],
): Promise<{ quick_panel: QuickItem[] }> {
  return hass.callWS({ type: 'maxsen/quick_panel/set', entry_id: entryId, items });
}

/** Fetch the planner's current home and report what would change. `fileId` is for homes loaded from a file. */
export function refreshPreview(
  hass: HassLike,
  entryId: string,
  fileId?: string,
): Promise<RefreshSummary> {
  return hass.callWS({
    type: 'maxsen/refresh/preview',
    entry_id: entryId,
    ...(fileId === undefined ? {} : { file_id: fileId }),
  });
}

export function refreshApply(
  hass: HassLike,
  entryId: string,
  previewId: string,
): Promise<RefreshSummary> {
  return hass.callWS({ type: 'maxsen/refresh/apply', entry_id: entryId, preview_id: previewId });
}

export function createStarterScenes(hass: HassLike, entryId: string): Promise<unknown> {
  return hass.callWS({ type: 'maxsen/scenes/create_starter', entry_id: entryId });
}

/**
 * Fetch a protected image and return an object URL for it. The caller owns the URL and must
 * `URL.revokeObjectURL` it when the image is replaced or no longer shown.
 */
export async function loadImage(hass: HassLike, url: string): Promise<string> {
  const response = await hass.fetchWithAuth(url);
  if (!response.ok) throw new Error(`Image ${url} answered ${response.status}`);
  return URL.createObjectURL(await response.blob());
}
