import { deviceEntities, domainOf } from './hass-util.ts';
import type { HassLike, HassState, HomeElement, Link } from './types.ts';

export type VisualStatus = 'unlinked' | 'missing' | 'unavailable' | 'on' | 'off' | 'alert' | 'idle';

export interface VisualState {
  status: VisualStatus;
  /** Short text shown next to the icon, e.g. `Open`, `21.5 °C`. */
  text?: string;
  /** Cover position, 0 (closed) to 100 (open). */
  position?: number;
}

/** The domains read for a device link; the rest of a device's entities (updates, buttons…) are noise. */
const DEVICE_DOMAINS = new Set([
  'light',
  'switch',
  'cover',
  'climate',
  'binary_sensor',
  'sensor',
  'fan',
  'lock',
  'camera',
]);

/** A binary sensor in one of these classes shows an alert while it is on. */
const ALERT_CLASSES = new Set(['door', 'window', 'motion', 'occupancy', 'smoke', 'moisture', 'gas']);

interface Reading {
  entityId: string;
  domain: string;
  state: string;
  attributes: Record<string, unknown>;
}

const isUnavailable = (state: string): boolean => state === 'unavailable' || state === 'unknown';
const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function reading(entityId: string, s: HassState): Reading {
  return { entityId, domain: domainOf(entityId), state: s.state, attributes: s.attributes };
}

/** `undefined` when the link points at something Home Assistant no longer has. */
function readings(link: Link, hass: HassLike): Reading[] | undefined {
  if (link.type === 'entity') {
    const s = hass.states[link.id];
    return s ? [reading(link.id, s)] : undefined;
  }
  if (!hass.devices[link.id]) return undefined;
  const out: Reading[] = [];
  for (const e of deviceEntities(hass, link.id)) {
    const s = hass.states[e.entity_id];
    if (s && DEVICE_DOMAINS.has(domainOf(e.entity_id))) out.push(reading(e.entity_id, s));
  }
  return out;
}

function cover(r: Reading): VisualState {
  const raw = r.attributes['current_position'];
  const position = typeof raw === 'number' ? Math.round(raw) : undefined;
  const open = position !== undefined ? position > 0 : r.state !== 'closed';
  let text: string;
  if (position === undefined) text = r.state === 'closed' ? 'Closed' : 'Open';
  else text = position === 0 ? 'Closed' : position === 100 ? 'Open' : `${position}%`;
  return position === undefined
    ? { status: open ? 'on' : 'off', text }
    : { status: open ? 'on' : 'off', position, text };
}

function climate(r: Reading): VisualState {
  const temp = r.attributes['current_temperature'];
  const text = typeof temp === 'number' ? `${r.state} · ${temp}°` : r.state;
  return { status: r.state === 'off' ? 'off' : 'on', text };
}

function lock(r: Reading): VisualState {
  const text = capitalise(r.state);
  if (r.state === 'locked') return { status: 'off', text };
  return { status: r.state === 'jammed' ? 'alert' : 'on', text };
}

function sensor(r: Reading): VisualState {
  const unit = r.attributes['unit_of_measurement'];
  return { status: 'idle', text: typeof unit === 'string' && unit ? `${r.state} ${unit}` : r.state };
}

/**
 * What to draw for an element, from its link and the live Home Assistant states.
 *
 * A device shows the most telling of its entities: climate, cover, lock, a binary-sensor alert,
 * lights/switches/fans, a sensor reading, then any other binary sensor.
 */
export function visualState(_el: HomeElement, link: Link | undefined, hass: HassLike): VisualState {
  if (!link) return { status: 'unlinked' };
  const all = readings(link, hass);
  if (!all) return { status: 'missing' };
  if (all.length === 0) return { status: 'idle' };

  const live = all.filter((r) => !isUnavailable(r.state));
  if (live.length === 0) return { status: 'unavailable' };

  const first = (domain: string) => live.find((r) => r.domain === domain);
  const ofDomain = (...domains: string[]) => live.filter((r) => domains.includes(r.domain));

  const climateR = first('climate');
  if (climateR) return climate(climateR);
  const coverR = first('cover');
  if (coverR) return cover(coverR);
  const lockR = first('lock');
  if (lockR) return lock(lockR);

  const binary = ofDomain('binary_sensor');
  const alert = binary.find(
    (r) => r.state === 'on' && ALERT_CLASSES.has(String(r.attributes['device_class'])),
  );
  if (alert) return { status: 'alert' };

  const switchable = ofDomain('light', 'switch', 'fan');
  if (switchable.length > 0) {
    return { status: switchable.some((r) => r.state === 'on') ? 'on' : 'off' };
  }

  const sensors = ofDomain('sensor');
  const shown = sensors.find((r) => r.attributes['device_class'] !== 'battery') ?? sensors[0];
  if (shown) return sensor(shown);

  if (binary.length > 0) return { status: binary.some((r) => r.state === 'on') ? 'on' : 'idle' };

  // Anything else, e.g. a camera: show its state.
  return { status: 'idle', text: live[0]?.state };
}
