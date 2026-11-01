import { deviceEntities, domainOf } from './hass-util.ts';
import type { CategoryId, HassLike, HomeElement, Link } from './types.ts';

/** Lighting categories link to entities; every other category links to a device. */
export const LIGHTING_CATEGORIES: ReadonlySet<CategoryId> = new Set<CategoryId>([
  'downlights',
  'surface-lights',
  'track-lights',
  'led-strips',
  'magnetic-track-lights',
  'pendant-lights',
  'spotlights',
  'misc-lighting',
  'ceiling-fans',
]);

export interface Candidate {
  link: Link;
  name: string;
  /** Area name, or '' when it has none. */
  area: string;
  /** Entity id, for an entity candidate. */
  detail?: string;
}

/** The entity domains a lighting category may link to. A ceiling fan is usually a `fan` entity. */
function entityDomains(categoryId: CategoryId): string[] {
  return categoryId === 'ceiling-fans' ? ['light', 'switch', 'fan'] : ['light', 'switch'];
}

/** The entity domains a device must have (at least one of) for a device category; undefined = any. */
function deviceDomains(categoryId: CategoryId): string[] | undefined {
  switch (categoryId) {
    case 'curtains-blinds':
      return ['cover'];
    case 'aircon-controllers':
      return ['climate'];
    case 'sensors':
      return ['sensor', 'binary_sensor'];
    case 'cameras':
      return ['camera'];
    case 'smart-locks':
      return ['lock'];
    case 'smart-switches':
    case 'control-panels':
      return ['switch', 'light'];
    default:
      return undefined;
  }
}

function entityCandidates(domains: string[], hass: HassLike): Candidate[] {
  // Registry entries, plus entities that only exist as states (e.g. defined in YAML).
  const ids = new Set([...Object.keys(hass.entities), ...Object.keys(hass.states)]);
  const out: Candidate[] = [];
  for (const id of ids) {
    if (!domains.includes(domainOf(id))) continue;
    const entry = hass.entities[id];
    const friendly = hass.states[id]?.attributes['friendly_name'];
    const areaId = entry?.area_id ?? (entry?.device_id ? hass.devices[entry.device_id]?.area_id : null);
    out.push({
      link: { type: 'entity', id },
      name: entry?.name || (typeof friendly === 'string' && friendly) || id,
      area: (areaId && hass.areas[areaId]?.name) || '',
      detail: id,
    });
  }
  return out;
}

function deviceCandidates(domains: string[] | undefined, hass: HassLike): Candidate[] {
  return Object.values(hass.devices)
    .filter(
      (d) =>
        domains === undefined ||
        deviceEntities(hass, d.id).some((e) => domains.includes(domainOf(e.entity_id))),
    )
    .map((d) => ({
      link: { type: 'device' as const, id: d.id },
      name: d.name_by_user || d.name || d.id,
      area: (d.area_id && hass.areas[d.area_id]?.name) || '',
    }));
}

/**
 * What an installer may link an element to, sorted by area name then name. Entries with no area
 * come last.
 */
export function linkCandidates(el: HomeElement, hass: HassLike): Candidate[] {
  const found = LIGHTING_CATEGORIES.has(el.categoryId)
    ? entityCandidates(entityDomains(el.categoryId), hass)
    : deviceCandidates(deviceDomains(el.categoryId), hass);
  return found.sort(
    (a, b) =>
      Number(a.area === '') - Number(b.area === '') ||
      a.area.localeCompare(b.area) ||
      a.name.localeCompare(b.name),
  );
}
