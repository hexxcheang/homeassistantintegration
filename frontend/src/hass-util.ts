import type { HassEntity, HassLike, Link } from './types.ts';

export const domainOf = (entityId: string): string => entityId.split('.', 1)[0] ?? '';

/** The registry entries that belong to a device. */
export function deviceEntities(hass: HassLike, deviceId: string): HassEntity[] {
  return Object.values(hass.entities).filter((e) => e.device_id === deviceId);
}

/**
 * The text of a failed websocket call. Home Assistant rejects with `{code, message}`; the message
 * is shown as the server wrote it.
 */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const { message } = err;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

/** What a link points at, as a person would call it; `undefined` when Home Assistant no longer has it. */
export function linkName(link: Link, hass: HassLike): string | undefined {
  if (link.type === 'entity') {
    const state = hass.states[link.id];
    if (!state) return undefined;
    const friendly = state.attributes['friendly_name'];
    return (typeof friendly === 'string' && friendly) || hass.entities[link.id]?.name || link.id;
  }
  const device = hass.devices[link.id];
  return device ? device.name_by_user || device.name || link.id : undefined;
}
