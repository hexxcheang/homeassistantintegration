import type { HassEntity, HassLike } from './types.ts';

export const domainOf = (entityId: string): string => entityId.split('.', 1)[0] ?? '';

/** The registry entries that belong to a device. */
export function deviceEntities(hass: HassLike, deviceId: string): HassEntity[] {
  return Object.values(hass.entities).filter((e) => e.device_id === deviceId);
}
