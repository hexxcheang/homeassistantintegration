import type {
  HassArea,
  HassDevice,
  HassEntity,
  HassLike,
  HassState,
  HomeElement,
  HomePackage,
} from '../src/types.ts';
import fixture from '../../tests/fixtures/home-v1.json';

/** The real package the planner generated (also used by the Python tests). */
export const home = fixture as unknown as HomePackage;

export function element(overrides: Partial<HomeElement> = {}): HomeElement {
  return {
    id: 'el1',
    categoryId: 'smart-switches',
    kind: 'point',
    productName: 'Product',
    variantName: 'Variant',
    label: '',
    drawn: true,
    ...overrides,
  };
}

interface HassInit {
  states?: Record<string, { state: string; attributes?: Record<string, unknown> }>;
  entities?: Record<string, Omit<HassEntity, 'entity_id'>>;
  devices?: Record<string, Omit<HassDevice, 'id'>>;
  areas?: Record<string, string>;
}

/** A minimal `hass`. Entities in `entities` are the registry; `states` are live states. */
export function makeHass(init: HassInit = {}): HassLike {
  const states: Record<string, HassState> = {};
  for (const [id, s] of Object.entries(init.states ?? {})) {
    states[id] = { state: s.state, attributes: s.attributes ?? {} };
  }
  const entities: Record<string, HassEntity> = {};
  for (const [id, e] of Object.entries(init.entities ?? {})) {
    entities[id] = { entity_id: id, ...e };
  }
  const devices: Record<string, HassDevice> = {};
  for (const [id, d] of Object.entries(init.devices ?? {})) devices[id] = { id, ...d };
  const areas: Record<string, HassArea> = {};
  for (const [id, name] of Object.entries(init.areas ?? {})) areas[id] = { area_id: id, name };
  return {
    states,
    entities,
    devices,
    areas,
    user: { is_admin: true },
    callService: async () => undefined,
    callWS: async () => undefined as never,
    connection: { subscribeMessage: async () => () => undefined },
    fetchWithAuth: async () => new Response(null, { status: 404 }),
  };
}
