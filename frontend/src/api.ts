import type { IdentifyKind } from './walk.ts';
import type { DisplayBackground, DisplaySettings, HassLike, HomeResponse, Link, QuickItem, RefreshSummary } from './types.ts';

/** What changed on the server; the view reloads the home on any of them. */
export type HomeEvent = 'home' | 'links' | 'quick_panel';

/** A Maxsen config entry and where it is in its life: `loaded` is the only state that answers `maxsen/*`. */
export interface MaxsenEntry {
  entryId: string;
  state: string;
}

/**
 * The first loaded Maxsen entry or, when none is loaded yet, the first one there is, so the caller
 * can tell "still starting" (right after Home Assistant restarts) from "not set up". `undefined`
 * only when there is no Maxsen entry at all.
 */
export async function findEntry(hass: HassLike): Promise<MaxsenEntry | undefined> {
  const entries = await hass.callWS<{ entry_id: string; state: string }[]>({
    type: 'config_entries/get',
    domain: 'maxsen',
  });
  const entry = entries.find((e) => e.state === 'loaded') ?? entries[0];
  return entry && { entryId: entry.entry_id, state: entry.state };
}

export function getHome(hass: HassLike, entryId: string): Promise<HomeResponse> {
  return hass.callWS<HomeResponse>({ type: 'maxsen/home', entry_id: entryId });
}

/**
 * Calls `callback` when the home, links or quick panel change. Resolves to the unsubscribe function.
 *
 * The subscription does not resubscribe itself: after a reconnect it is gone, and the panel
 * subscribes again once Maxsen answers. (A resubscribed copy would be a second subscription.)
 */
export function subscribe(
  hass: HassLike,
  entryId: string,
  callback: (event: HomeEvent) => void,
): Promise<() => void | Promise<void>> {
  return hass.connection.subscribeMessage<{ event: HomeEvent }>(
    (msg) => callback(msg.event),
    { type: 'maxsen/subscribe', entry_id: entryId },
    { resubscribe: false },
  );
}

/**
 * Link or unlink elements; a `null` value removes that element's link. Installer mode only.
 *
 * `nameDevice` names each linked device after its marker ("Level 1 – Entrance switch") and puts
 * it in its level's area, unless a person named it. Unlinking a device Maxsen named puts its
 * previous name and area back, with or without this option.
 */
export function setLinks(
  hass: HassLike,
  entryId: string,
  updates: Record<string, Link | null>,
  options: { nameDevice?: boolean } = {},
): Promise<{ links: Record<string, Link> }> {
  return hass.callWS({
    type: 'maxsen/links/set',
    entry_id: entryId,
    updates,
    ...(options.nameDevice ? { name_device: true } : {}),
  });
}

/** What `maxsen/identify/subscribe` listens for. */
export interface IdentifyOptions {
  /** `device`: a device with no link yet; `entity`: a gang (it may already be linked). */
  mode: 'device' | 'entity';
  kinds: IdentifyKind[];
  /** Only devices with exactly this many switch gangs. */
  gangs?: number | null;
  /** Count devices that are not Zigbee too. */
  includeOther?: boolean;
}

/** What the server pushes: the thing pressed, two things at once, or the end of the subscription. */
export type IdentifyResult =
  | { device_id: string; name: string }
  | { entity_id: string; name: string }
  | { ambiguous: true }
  | { stopped: true };

/**
 * Calls `callback` with what the installer presses from now on (installer mode only). Resolves to
 * the unsubscribe function. Like `subscribe`, it does not resubscribe itself: after a reconnect a
 * prompt is stale, and the caller asks again.
 */
export function identify(
  hass: HassLike,
  entryId: string,
  options: IdentifyOptions,
  callback: (result: IdentifyResult) => void,
): Promise<() => void | Promise<void>> {
  return hass.connection.subscribeMessage<IdentifyResult>(
    callback,
    {
      type: 'maxsen/identify/subscribe',
      entry_id: entryId,
      mode: options.mode,
      kinds: options.kinds,
      ...(options.gangs ? { gangs: options.gangs } : {}),
      include_other: options.includeOther ?? false,
    },
    { resubscribe: false },
  );
}

export function setQuickPanel(
  hass: HassLike,
  entryId: string,
  items: QuickItem[],
): Promise<{ quick_panel: QuickItem[] }> {
  return hass.callWS({ type: 'maxsen/quick_panel/set', entry_id: entryId, items });
}

/** Choose how plan backgrounds look for every screen of this home. Installer mode only. */
export function setDisplay(
  hass: HassLike,
  entryId: string,
  background: DisplayBackground,
): Promise<{ display: DisplaySettings }> {
  return hass.callWS({ type: 'maxsen/display/set', entry_id: entryId, background });
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

/**
 * Hand a home file to Home Assistant's upload endpoint and return its `file_id`, which
 * `refreshPreview` takes. Throws when Home Assistant refuses the file.
 */
export async function uploadHomeFile(hass: HassLike, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const response = await hass.fetchWithAuth('/api/file_upload', { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Upload answered ${response.status}`);
  const { file_id: fileId } = (await response.json()) as { file_id?: unknown };
  if (typeof fileId !== 'string' || !fileId) throw new Error('Upload gave no file id');
  return fileId;
}
