import { deviceEntities, domainOf } from './hass-util.ts';
import type { HassLike, Link } from './types.ts';

/** What a tap toggles. Everything else linked opens its more-info dialog instead. */
export const CONTROLLABLE = new Set(['light', 'switch', 'fan', 'cover']);
/** Which entity of a device is "the first": the one that says most about it. */
const PRIMARY_ORDER = ['climate', 'cover', 'lock', 'light', 'switch', 'fan', 'binary_sensor', 'sensor', 'camera'];

/**
 * The entity ids behind a link that have a state. A device brings its registry entities; a link
 * to something Home Assistant no longer has gives none.
 */
export function linkEntityIds(link: Link, hass: HassLike): string[] {
  if (link.type === 'entity') return hass.states[link.id] ? [link.id] : [];
  return deviceEntities(hass, link.id)
    .map((e) => e.entity_id)
    .filter((id) => hass.states[id]);
}

/** The entity that says most about a link, for the more-info dialog. */
export function primaryEntity(ids: string[], hass: HassLike): string | undefined {
  const rank = (id: string): number => {
    const battery = hass.states[id]?.attributes['device_class'] === 'battery';
    const i = PRIMARY_ORDER.indexOf(domainOf(id));
    return (i === -1 ? PRIMARY_ORDER.length : i) + (battery ? 100 : 0);
  };
  return [...ids].sort((a, b) => rank(a) - rank(b))[0];
}

/** Toggle lights, switches and fans; open closed covers and close the others. False if a call failed. */
export async function toggleEntities(hass: HassLike, ids: string[]): Promise<boolean> {
  const covers = ids.filter((id) => domainOf(id) === 'cover');
  const open = covers.filter((id) => hass.states[id]?.state === 'closed');
  const close = covers.filter((id) => !open.includes(id));
  const calls: [string, string, string[]][] = [
    ['homeassistant', 'toggle', ids.filter((id) => domainOf(id) !== 'cover')],
    ['cover', 'open_cover', open],
    ['cover', 'close_cover', close],
  ];
  let ok = true;
  for (const [domain, service, entityIds] of calls) {
    if (entityIds.length === 0) continue;
    try {
      await hass.callService(domain, service, { entity_id: entityIds });
    } catch {
      ok = false;
    }
  }
  return ok;
}
