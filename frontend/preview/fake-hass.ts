/**
 * A simulated Home Assistant for the preview app: the `hass` object the real panel is given, with a
 * made-up home built from a home package, and the `maxsen/*` websocket commands answered in memory
 * with the same request, response and error shapes as the integration
 * (custom_components/maxsen/websocket.py).
 */
import type { HomeEvent } from '../src/api.ts';
import { LIGHTING_CATEGORIES } from '../src/link-candidates.ts';
import { gangCount as statedGangs } from '../src/walk.ts';
import { PackageProblem, type PackageReason, parseHomeFile } from './validate-package.ts';
import type {
  ChangedDrawing,
  ChangedElement,
  DisplaySettings,
  HassArea,
  HassDevice,
  HassEntity,
  HassLike,
  HassState,
  HomeElement,
  HomeLevel,
  HomePackage,
  HomeResponse,
  Link,
  QuickItem,
  RefreshSummary,
  StoredHomePackage,
} from '../src/types.ts';

export const ENTRY_ID = 'preview-entry';

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const DOOR_FLIP_MS = 20_000;
/** One lighting switch ("gang") serves this many lighting elements of a plan. */
const ELEMENTS_PER_GANG = 4;
/** What a scene's `turn_off` reaches (custom_components/maxsen/scene.py). */
const SCENE_DOMAINS = new Set(['light', 'switch', 'fan', 'climate']);

export interface FakeHass extends HassLike {
  /** Calls `listener` after anything changes that a re-rendered `hass` would show. Returns the stop function. */
  onChange(listener: () => void): () => void;
  setAdmin(admin: boolean): void;
  setInstallerMode(on: boolean): void;
  /** Replace the whole home (a new file was opened): new devices, links cleared to the automatic ones. */
  openHome(pkg: HomePackage): void;
  /** What the pretend planner answers to "Refresh from planner". Starts as the loaded home. */
  setPlannerPackage(pkg: HomePackage): void;
  /** The planner disconnects this home: refreshing from the planner answers `revoked` until a new home is opened. */
  revokePairing(): void;
  /** Keep a file for `maxsen/refresh/preview` with `file_id`. Returns the id. */
  uploadFile(pkg: HomePackage): string;
  /**
   * Pretend Home Assistant restarted, as home-assistant-js-websocket sees it: the connection fires
   * `ready` after reconnecting; a subscription made with `resubscribe: false` is gone (calling its
   * unsubscribe answers `not_found`) while the others are resubscribed by the connection itself.
   * For `startingMs` the integration is still loading: its entry is `not_loaded` and the maxsen
   * commands answer `unknown_command`.
   */
  restart(startingMs?: number): void;
  /** Flip the door sensors every 20 s so alerts can be seen. Returns the stop function. */
  startSimulation(everyMs?: number): () => void;
  /** What a person can press on the fake devices: their gangs, curtains and sensors, not their settings. */
  pressTargets(): PressTarget[];
  /**
   * Press this entity as a person would: a switch, light or sensor goes to its other state, a
   * curtain opens or closes. `maxsen/identify/subscribe` listeners see it like a real state change.
   */
  press(entityId: string): void;
}

/** One entry of the preview's Press a device menu. */
export interface PressTarget {
  entityId: string;
  /** The entity's name, e.g. "Entrance switch 2". */
  label: string;
  /** The device it belongs to, to group the menu. */
  group: string;
}

/** What the panel says for a rejected refresh file: the same sentences as the integration's `websocket.py`. */
const NOT_A_HOME_FILE = 'This is not a Maxsen home file.';
const REJECTED_MESSAGES: Record<PackageReason, string> = {
  invalid_json: NOT_A_HOME_FILE,
  wrong_format: NOT_A_HOME_FILE,
  missing_image: NOT_A_HOME_FILE,
  unsupported_version: 'This home file is from a newer planner. Update this integration.',
  too_large: 'This file is larger than 100 MB.',
};

/** What a rejected websocket call looks like in Home Assistant: `{code, message}`. */
export class CommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
  }
}

interface StarterScene {
  id: string;
  name: string;
  entity_ids: string[];
}

interface Preview {
  pkg: HomePackage;
  summary: Omit<RefreshSummary, 'preview_id'>;
  expires: number;
}

type Message = { type: string; [key: string]: unknown };

const IDENTIFY_KINDS = ['switch', 'cover', 'binary_sensor', 'light_gang'];
/** The entities of a device that count as its gangs. */
const GANG_DOMAINS = new Set(['switch', 'light']);
/** How long the first candidate waits for another before it is reported (identify.py `AMBIGUITY_WINDOW`). */
const AMBIGUITY_WINDOW_MS = 1000;

/** One `maxsen/identify/subscribe`: what it listens for, and the candidates inside its window. */
interface Identify {
  mode: 'device' | 'entity';
  kinds: string[];
  gangs: number | null;
  includeOther: boolean;
  send(result: Record<string, unknown>): void;
  candidates: Map<string, Record<string, unknown>>;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** As the connection keeps it: false when the caller asked not to be resubscribed after a restart. */
  resubscribe: boolean;
  /** Dropped with a lost connection: ending it answers `not_found`. */
  lost: boolean;
}
type Attributes = Record<string, unknown>;

/** The four registries, copied before a batch of changes and put back in one go. */
interface World {
  states: Record<string, HassState>;
  entities: Record<string, HassEntity>;
  devices: Record<string, HassDevice>;
  areas: Record<string, HassArea>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const domainOf = (entityId: string): string => entityId.split('.', 1)[0] ?? '';

/** How Home Assistant makes an entity id out of a name. */
function slug(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || 'unnamed';
}

function elementsOf(pkg: HomePackage): Map<string, HomeElement> {
  const out = new Map<string, HomeElement>();
  for (const level of pkg.levels) {
    for (const plan of level.plans) for (const el of plan.elements) out.set(el.id, el);
  }
  return out;
}

/** Every element as a refresh summary shows it, with the name of its level. */
function describedElements(pkg: HomePackage): Map<string, ChangedElement> {
  const out = new Map<string, ChangedElement>();
  for (const level of pkg.levels) {
    for (const plan of level.plans) {
      for (const el of plan.elements) {
        out.set(el.id, { id: el.id, productName: el.productName, label: el.label, levelName: level.name });
      }
    }
  }
  return out;
}

/** Added and removed elements, and the plans that were redrawn (revision changed). */
function diff(oldPkg: HomePackage, newPkg: HomePackage): Preview['summary'] {
  const before = describedElements(oldPkg);
  const after = describedElements(newPkg);
  const revisions = new Map(
    oldPkg.levels.flatMap((l) => l.plans.map((p) => [p.id, p.revision] as const)),
  );
  const changed: ChangedDrawing[] = [];
  for (const level of newPkg.levels) {
    for (const plan of level.plans) {
      const old = revisions.get(plan.id);
      if (old === undefined || old === plan.revision) continue;
      changed.push({ planId: plan.id, levelName: level.name, type: plan.type });
    }
  }
  return {
    added: [...after.values()].filter((e) => !before.has(e.id)),
    removed: [...before.values()].filter((e) => !after.has(e.id)),
    changed_drawings: changed,
  };
}

function strip(pkg: HomePackage): StoredHomePackage {
  const { images, ...rest } = pkg;
  return {
    ...rest,
    image_types: Object.fromEntries(Object.entries(images).map(([id, i]) => [id, i.mediaType])),
  };
}

// ---- the made-up home ----

function addEntity(
  world: World,
  wanted: string,
  name: string,
  state: string,
  attributes: Attributes,
  owner: { deviceId?: string; areaId?: string },
  category: 'config' | 'diagnostic' | null = null,
): string {
  let id = wanted;
  for (let n = 2; world.states[id]; n++) id = `${wanted}_${n}`;
  world.entities[id] = {
    entity_id: id,
    device_id: owner.deviceId ?? null,
    area_id: owner.deviceId ? null : (owner.areaId ?? null),
    name,
    ...(category ? { entity_category: category } : {}),
  };
  world.states[id] = { state, attributes: { friendly_name: name, ...attributes } };
  return id;
}

function ensureArea(world: World, name: string): string {
  const existing = Object.values(world.areas).find((a) => a.name === name);
  if (existing) return existing.area_id;
  let id = slug(name);
  for (let n = 2; world.areas[id]; n++) id = `${slug(name)}_${n}`;
  world.areas[id] = { area_id: id, name };
  return id;
}

/** What Maxsen wrote to a device, and what it replaced (the integration's `named` records). */
interface NamedRecord {
  name: string;
  area_id: string | null;
  prev_name: string | null;
  prev_area_id: string | null;
}

/** "Level – label (else product name)", numbered 2, 3, ... when taken (ignoring case). */
function installedName(levelName: string, el: HomeElement, taken: Set<string>): string {
  const base = `${levelName} – ${el.label?.trim() || el.productName?.trim() || el.id}`;
  const folded = new Set([...taken].map((n) => n.toLowerCase()));
  let name = base;
  for (let n = 2; folded.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}

function uniqueDeviceName(world: World, wanted: string): string {
  const taken = new Set(Object.values(world.devices).map((d) => d.name));
  let name = wanted;
  for (let n = 2; taken.has(name); n++) name = `${wanted} ${n}`;
  return name;
}

/** The gangs a switch has: the count its names state ("3 Gang", "3-gang", "3G", read as the walk reads it), else one. */
function gangCount(el: HomeElement): number {
  return Math.max(1, statedGangs(el.productName, el.variantName) ?? 1);
}

/** One fake device for a non-lighting element, with the entities its category would have. */
function addDevice(world: World, el: HomeElement, areaId: string): Link {
  const name = uniqueDeviceName(world, String(el.label || el.productName || el.id));
  const deviceId = `device_${el.id}`;
  world.devices[deviceId] = { id: deviceId, name, area_id: areaId };
  const owner = { deviceId, areaId };
  const base = slug(name);
  const add = (domain: string, suffix: string, label: string, state: string, attrs: Attributes = {}) =>
    addEntity(world, `${domain}.${base}${suffix}`, label, state, attrs, owner);
  const addSetting = (domain: string, suffix: string, label: string, state: string) =>
    addEntity(world, `${domain}.${base}${suffix}`, label, state, {}, owner, 'config');

  switch (el.categoryId) {
    case 'smart-switches':
    case 'control-panels': {
      const gangs = el.categoryId === 'smart-switches' ? gangCount(el) : 1;
      for (let i = 1; i <= gangs; i++) add('switch', `_${i}`, `${name} ${i}`, i === 1 ? 'on' : 'off');
      if (el.categoryId === 'smart-switches') {
        // Zigbee2MQTT's Tuya switches put their settings on the same device as config entities.
        addSetting('switch', '_backlight', `${name} Backlight`, 'on');
        addSetting('lock', '_child_lock', `${name} Child lock`, 'unlocked');
      }
      break;
    }
    case 'curtains-blinds':
      add('cover', '', name, 'open', { device_class: 'curtain', current_position: 100 });
      break;
    case 'aircon-controllers':
      add('climate', '', name, 'cool', {
        hvac_modes: ['off', 'cool', 'heat', 'fan_only', 'auto'],
        current_temperature: 24,
        temperature: 22,
      });
      break;
    case 'sensors': {
      const text = `${el.productName} ${el.variantName} ${el.label}`.toLowerCase();
      if (/door|window|contact/.test(text)) {
        add('binary_sensor', '_door', `${name} door`, 'off', { device_class: 'door' });
      } else if (/motion|pir|presence|occupancy/.test(text)) {
        add('binary_sensor', '_motion', `${name} motion`, 'off', { device_class: 'motion' });
      }
      add('sensor', '_temperature', `${name} temperature`, '21.5', {
        device_class: 'temperature',
        unit_of_measurement: '°C',
      });
      break;
    }
    case 'smart-locks':
      add('lock', '', name, 'locked');
      break;
    case 'cameras':
      add('camera', '', name, 'idle');
      break;
    default:
      // Gateways, network devices and the rest: they only report that they are online.
      add('binary_sensor', '_connectivity', `${name} connectivity`, 'on', { device_class: 'connectivity' });
  }
  return { type: 'device', id: deviceId };
}

/** Give each element a fake device or lighting gang, for the elements `include` accepts. Returns their links. */
function provision(
  world: World,
  pkg: HomePackage,
  include: (id: string) => boolean,
): Record<string, Link> {
  const links: Record<string, Link> = {};
  for (const level of pkg.levels) {
    const areaId = ensureArea(world, level.name);
    for (const plan of level.plans) {
      const lights: HomeElement[] = [];
      for (const el of plan.elements) {
        if (!include(el.id)) continue;
        if (LIGHTING_CATEGORIES.has(el.categoryId)) lights.push(el);
        else links[el.id] = addDevice(world, el, areaId);
      }
      for (let i = 0; i < lights.length; i += ELEMENTS_PER_GANG) {
        const gang = addLightingGang(world, level, areaId);
        for (const el of lights.slice(i, i + ELEMENTS_PER_GANG)) links[el.id] = gang;
      }
    }
  }
  return links;
}

function addLightingGang(world: World, level: HomeLevel, areaId: string): Link {
  let n = 1;
  while (world.states[`switch.${slug(level.name)}_lighting_${n}`]) n++;
  // The gang is a switch of a (Zigbee) lighting module, as in a real home.
  const deviceId = `device_lighting_${slug(level.name)}_${n}`;
  world.devices[deviceId] = { id: deviceId, name: `${level.name} lighting module ${n}`, area_id: areaId };
  const id = addEntity(
    world,
    `switch.${slug(level.name)}_lighting_${n}`,
    `${level.name} lighting ${n}`,
    n % 2 === 1 ? 'on' : 'off',
    {},
    { deviceId, areaId },
  );
  return { type: 'entity', id };
}

/**
 * A device no marker links to and that is not Zigbee (a Wi-Fi plug), to show that pressing it does
 * not count unless "Include other devices" is on. Returns its device id.
 */
function addWifiPlug(world: World): string {
  const deviceId = 'device_wifi_plug';
  world.devices[deviceId] = { id: deviceId, name: 'Hallway smart plug' };
  addEntity(world, 'switch.hallway_smart_plug', 'Hallway smart plug', 'on', {}, { deviceId });
  return deviceId;
}

// ---- starter scenes ----

/** A device brings its switchable entities, but not its settings (config or diagnostic) or hidden ones. */
function resolveLink(link: Link, world: World): string[] {
  if (link.type === 'entity') return [link.id];
  return Object.values(world.entities)
    .filter(
      (e) =>
        e.device_id === link.id &&
        !e.entity_category &&
        !e.hidden &&
        SCENE_DOMAINS.has(domainOf(e.entity_id)),
    )
    .map((e) => e.entity_id);
}

/** custom_components/maxsen/scene.py `build_starter_scenes`: all off, one per level, all lights off. */
function buildStarterScenes(
  pkg: HomePackage,
  links: Record<string, Link>,
  world: World,
): StarterScene[] {
  const unique = (ids: string[]): string[] => [...new Set(ids)];
  const resolved = (els: HomeElement[]): string[] =>
    unique(els.flatMap((el) => (links[el.id] ? resolveLink(links[el.id] as Link, world) : [])));

  const scenes: StarterScene[] = [];
  const push = (id: string, name: string, entityIds: string[]): void => {
    if (entityIds.length > 0) scenes.push({ id, name, entity_ids: entityIds });
  };
  const all = [...elementsOf(pkg).values()];
  push('all_off', 'All off', resolved(all));
  for (const level of pkg.levels) {
    const els = level.plans.flatMap((p) => p.elements);
    push(`all_off_${level.id}`, `All off – ${level.name}`, resolved(els));
  }
  push('all_lights_off', 'All lights off', resolved(all.filter((e) => LIGHTING_CATEGORIES.has(e.categoryId))));
  return scenes;
}

// ---- the fake ----

export function createFakeHass(
  initial: HomePackage,
  opts: { admin: boolean; installerMode: boolean },
): FakeHass {
  let pkg = initial;
  let stored = strip(pkg);
  let links: Record<string, Link> = {};
  /** Devices named by `links/set` with `name_device`, by device id. */
  let named: Record<string, NamedRecord> = {};
  let quickPanel: QuickItem[] = [];
  let scenes: StarterScene[] = [];
  /** Scene entity id to the starter scene behind it. */
  let sceneEntities = new Map<string, StarterScene>();
  let display: DisplaySettings = { background: 'soft' };
  let installerMode = opts.installerMode;
  /** Where the home came from: the sample home plays a planner project; an opened file is a file. */
  let source: HomeResponse['source'] = 'planner';
  let plannerPackage = initial;
  let revoked = false;
  /** What `/api/file_upload` kept: uploaded text, checked when previewed as the integration does. */
  const files = new Map<string, HomePackage | string>();
  const previews = new Map<string, Preview>();
  let counter = 0;
  const listeners = new Set<() => void>();
  /** A `maxsen/subscribe` as home-assistant-js-websocket keeps it: `resubscribe` is false when the caller asked for that. */
  interface Subscription {
    notify(event: HomeEvent): void;
    resubscribe: boolean;
  }
  const subscribers = new Set<Subscription>();
  /** The devices that are not Zigbee (every other fake device is, as the integration counts it). */
  let nonZigbee = new Set<string>();
  /** The open `maxsen/identify/subscribe` calls. */
  const identifiers = new Set<Identify>();
  const readyListeners = new Set<() => void>();
  /** Until this time (ms) the maxsen commands are not registered yet, as right after a restart. */
  let startingUntil = 0;
  function requireStarted(type: string): void {
    if (type.startsWith('maxsen/') && Date.now() < startingUntil) {
      throw new CommandError('unknown_command', 'Unknown command.');
    }
  }

  const draft = (): World => ({
    states: { ...fake.states },
    entities: { ...fake.entities },
    devices: { ...fake.devices },
    areas: { ...fake.areas },
  });

  /** Put a changed world in place and tell whoever re-renders. */
  function commit(world: World): void {
    fake.states = world.states;
    fake.entities = world.entities;
    fake.devices = world.devices;
    fake.areas = world.areas;
    for (const listener of [...listeners]) listener();
  }

  function emit(event: HomeEvent): void {
    for (const subscriber of [...subscribers]) subscriber.notify(event);
  }

  function setStates(world: World, id: string, state: string, attributes: Attributes = {}): void {
    const old = world.states[id];
    if (old) world.states[id] = { state, attributes: { ...old.attributes, ...attributes } };
  }

  // ---- services ----

  type Action = 'on' | 'off' | 'toggle';

  function act(world: World, id: string, action: Action): void {
    const s = world.states[id];
    if (!s) return;
    const wantOn = (isOn: boolean): boolean => (action === 'toggle' ? !isOn : action === 'on');
    switch (domainOf(id)) {
      case 'switch':
      case 'light':
      case 'fan':
        setStates(world, id, wantOn(s.state === 'on') ? 'on' : 'off');
        break;
      case 'climate':
        setStates(world, id, wantOn(s.state !== 'off') ? 'cool' : 'off');
        break;
      case 'lock':
        setStates(world, id, wantOn(s.state === 'unlocked') ? 'unlocked' : 'locked');
        break;
      case 'cover': {
        const open = wantOn(s.state !== 'closed');
        setStates(world, id, open ? 'open' : 'closed', { current_position: open ? 100 : 0 });
        break;
      }
    }
  }

  function activateScene(world: World, id: string): void {
    const scene = sceneEntities.get(id);
    if (!scene) return;
    for (const member of scene.entity_ids) act(world, member, 'off');
    setStates(world, id, new Date().toISOString());
  }

  function entityIdsOf(data?: Record<string, unknown>, target?: Record<string, unknown>): string[] {
    const raw = target?.['entity_id'] ?? data?.['entity_id'];
    if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
    return Array.isArray(raw) ? raw.filter(nonEmpty) : [];
  }

  async function callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ): Promise<unknown> {
    const actions: Record<string, Action> = {
      toggle: 'toggle',
      turn_on: 'on',
      turn_off: 'off',
      open_cover: 'on',
      close_cover: 'off',
    };
    const direct = ['homeassistant', 'switch', 'light', 'fan'].includes(domain)
      ? ['toggle', 'turn_on', 'turn_off']
      : domain === 'cover'
        ? ['toggle', 'open_cover', 'close_cover']
        : [];
    const world = draft();
    if (direct.includes(service)) {
      for (const id of entityIdsOf(data, target)) act(world, id, actions[service] as Action);
    } else if (domain === 'scene' && service === 'turn_on') {
      for (const id of entityIdsOf(data, target)) activateScene(world, id);
    } else if (domain === 'cover' && service === 'stop_cover') {
      // Covers jump to their end here, so there is nothing to stop; the call is still valid.
    } else if (domain === 'cover' && service === 'set_cover_position') {
      const position = data?.['position'];
      if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 100) {
        throw new CommandError('invalid_format', 'position must be a number from 0 to 100.');
      }
      for (const id of entityIdsOf(data, target)) {
        if (domainOf(id) === 'cover') setStates(world, id, position === 0 ? 'closed' : 'open', { current_position: position });
      }
    } else {
      throw new CommandError('service_not_found', `Service ${domain}.${service} not found.`);
    }
    commit(world);
    return undefined;
  }

  // ---- press to identify (custom_components/maxsen/identify.py) ----

  const isPrimary = (e: HassEntity): boolean => !e.entity_category && !e.hidden;

  /** Whether this change is a press for `kind`: a light press is off to on; the rest are any change. */
  function isPressFor(kind: string, domain: string, old: string, now: string): boolean {
    if (old === now) return false;
    if (kind === 'light_gang') return GANG_DOMAINS.has(domain) && old === 'off' && now === 'on';
    if (kind === 'switch') return GANG_DOMAINS.has(domain);
    return domain === kind; // 'cover' and 'binary_sensor'
  }

  function primaryGangs(deviceId: string): number {
    return Object.values(fake.entities).filter(
      (e) => e.device_id === deviceId && GANG_DOMAINS.has(domainOf(e.entity_id)) && isPrimary(e),
    ).length;
  }

  const deviceIsLinked = (deviceId: string): boolean =>
    Object.values(links).some((l) => l.type === 'device' && l.id === deviceId);

  function stopIdentify(sub: Identify): void {
    clearTimeout(sub.timer);
    sub.timer = undefined;
    sub.candidates.clear();
    identifiers.delete(sub);
  }

  function reportIdentify(sub: Identify): void {
    sub.timer = undefined;
    const found = [...sub.candidates.values()];
    sub.candidates.clear();
    if (found.length === 1) sub.send(found[0] as Record<string, unknown>);
    else if (found.length > 1) sub.send({ ambiguous: true });
  }

  /** Takes `entityId` changing from `old` to `now` as a candidate of `sub`, if it is a press `sub` is waiting for. */
  function noticePress(sub: Identify, entityId: string, old: string, now: string): void {
    const domain = domainOf(entityId);
    if (!sub.kinds.some((kind) => isPressFor(kind, domain, old, now))) return;
    const entity = fake.entities[entityId];
    if (!entity || !isPrimary(entity)) return;
    const device = entity.device_id ? fake.devices[entity.device_id] : undefined;
    if (!sub.includeOther && !(device && !nonZigbee.has(device.id))) return;

    let key: string;
    let result: Record<string, unknown>;
    if (sub.mode === 'entity') {
      // A gang that is already linked may be chosen again for more lights.
      key = entityId;
      const friendly = fake.states[entityId]?.attributes['friendly_name'];
      result = { entity_id: entityId, name: typeof friendly === 'string' ? friendly : entityId };
    } else {
      if (!device || deviceIsLinked(device.id)) return;
      if (sub.gangs !== null && primaryGangs(device.id) !== sub.gangs) return;
      key = device.id;
      result = { device_id: device.id, name: device.name_by_user || device.name || device.id };
    }
    // The same thing pressed twice inside the window is still one candidate.
    if (!sub.candidates.has(key)) sub.candidates.set(key, result);
    sub.timer ??= setTimeout(() => reportIdentify(sub), AMBIGUITY_WINDOW_MS);
  }

  function pressedState(entityId: string, state: string): { state: string; attributes?: Attributes } | undefined {
    switch (domainOf(entityId)) {
      case 'switch':
      case 'light':
      case 'binary_sensor':
        return { state: state === 'on' ? 'off' : 'on' };
      case 'cover': {
        const open = state === 'closed';
        return { state: open ? 'open' : 'closed', attributes: { current_position: open ? 100 : 0 } };
      }
      default:
        return undefined;
    }
  }

  function press(entityId: string): void {
    const old = fake.states[entityId];
    const next = old && pressedState(entityId, old.state);
    if (!old || !next) return;
    const world = draft();
    setStates(world, entityId, next.state, next.attributes);
    commit(world);
    for (const sub of [...identifiers]) noticePress(sub, entityId, old.state, next.state);
  }

  function pressTargets(): PressTarget[] {
    const targets: PressTarget[] = [];
    for (const entity of Object.values(fake.entities)) {
      const id = entity.entity_id;
      if (!['switch', 'light', 'cover', 'binary_sensor'].includes(domainOf(id)) || !isPrimary(entity)) continue;
      const state = fake.states[id];
      if (!state) continue;
      const device = entity.device_id ? fake.devices[entity.device_id] : undefined;
      const friendly = state.attributes['friendly_name'];
      targets.push({
        entityId: id,
        label: typeof friendly === 'string' ? friendly : id,
        group: device
          ? `${device.name_by_user || device.name || device.id}${nonZigbee.has(device.id) ? ' (not Zigbee)' : ''}`
          : 'Other',
      });
    }
    return targets;
  }

  /** The schema of the server command: a bad request is `invalid_format`, before anything else is looked at. */
  function parseIdentify(message: Message): Pick<Identify, 'mode' | 'kinds' | 'gangs' | 'includeOther'> {
    const { mode, kinds, gangs, include_other: includeOther = false } = message;
    const bad = (what: string): never => {
      throw new CommandError('invalid_format', what);
    };
    if (mode !== 'device' && mode !== 'entity') bad('mode must be "device" or "entity"');
    if (!Array.isArray(kinds) || !kinds.every((k) => typeof k === 'string' && IDENTIFY_KINDS.includes(k))) {
      bad('kinds must be a list of switch, cover, binary_sensor or light_gang');
    }
    if (gangs !== undefined && !(typeof gangs === 'number' && Number.isInteger(gangs) && gangs >= 1)) {
      bad('gangs must be a whole number of at least 1');
    }
    if (typeof includeOther !== 'boolean') bad('include_other must be true or false');
    return {
      mode: mode as 'device' | 'entity',
      kinds: kinds as string[],
      gangs: typeof gangs === 'number' ? gangs : null,
      includeOther: includeOther as boolean,
    };
  }

  function subscribeIdentify<T>(
    callback: (message: T) => void,
    message: Message,
    options?: { resubscribe?: boolean },
  ): () => Promise<void> {
    const wanted = parseIdentify(message);
    requireHome(message);
    requireInstaller('Identifying');
    const sub: Identify = {
      ...wanted,
      send: (result) => callback(result as T),
      candidates: new Map(),
      timer: undefined,
      resubscribe: options?.resubscribe !== false,
      lost: false,
    };
    // One subscription per home: a new one stops the older (identify.py `stop_replaced`).
    for (const older of [...identifiers]) {
      older.send({ stopped: true });
      stopIdentify(older);
    }
    identifiers.add(sub);
    return async () => {
      if (sub.lost) throw new CommandError('not_found', 'Subscription not found.');
      stopIdentify(sub);
    };
  }

  // ---- websocket ----

  const homeResponse = (): HomeResponse =>
    structuredClone({
      package: stored,
      links,
      quick_panel: quickPanel,
      display,
      installer_mode: installerMode,
      source,
      image_urls: Object.fromEntries(
        Object.keys(pkg.images).map((id) => [id, `/api/maxsen/image/${ENTRY_ID}/${id}`]),
      ),
    });

  function requireHome(msg: Message): void {
    if (!nonEmpty(msg['entry_id'])) throw new CommandError('invalid_format', 'entry_id is required');
    if (msg['entry_id'] !== ENTRY_ID) throw new CommandError('not_found', 'Unknown home');
  }

  function requireInstaller(what: string): void {
    if (!fake.user.is_admin || !installerMode) {
      throw new CommandError('not_allowed', `${what} needs an administrator and installer mode`);
    }
  }

  const isLink = (v: unknown): boolean =>
    v === null || (isRecord(v) && (v['type'] === 'device' || v['type'] === 'entity') && nonEmpty(v['id']));
  const isQuickItem = (v: unknown): v is QuickItem =>
    isRecord(v) && (v['type'] === 'element' || v['type'] === 'entity') && nonEmpty(v['id']);

  function setLinks(msg: Message): unknown {
    const updates = msg['updates'];
    if (!isRecord(updates) || !Object.values(updates).every(isLink)) {
      throw new CommandError('invalid_format', 'updates must map element ids to links');
    }
    requireHome(msg);
    requireInstaller('Linking');
    const known = elementsOf(pkg);
    if (Object.keys(updates).some((id) => !known.has(id))) {
      throw new CommandError('invalid_element', 'An element is not in this home');
    }
    const next = { ...links };
    for (const [id, link] of Object.entries(updates)) {
      if (link === null) delete next[id];
      else next[id] = link as Link;
    }
    const nameDevice = msg['name_device'] ?? false;
    if (typeof nameDevice !== 'boolean') {
      throw new CommandError('invalid_format', 'name_device must be true or false');
    }
    const onlyIfUnlinked = msg['only_if_unlinked'] ?? false;
    if (typeof onlyIfUnlinked !== 'boolean') {
      throw new CommandError('invalid_format', 'only_if_unlinked must be true or false');
    }
    if (onlyIfUnlinked) {
      // Press-to-identify links a device only when no other element has a device link to it.
      const held = new Set(
        Object.entries(links).flatMap(([id, l]) => (l.type === 'device' && !(id in updates) ? [l.id] : [])),
      );
      if (Object.values(updates).some((l) => (l as Link | null)?.type === 'device' && held.has((l as Link).id))) {
        throw new CommandError('already_linked', 'That device is already linked to another element');
      }
    }

    // As the integration does: restore the devices no link points to any more,
    // then (with name_device) name and place the devices linked now.
    const world = draft();
    const stillLinked = new Set(
      Object.values(next).flatMap((l) => (l.type === 'device' ? [l.id] : [])),
    );
    const released = new Set<string>();
    for (const id of Object.keys(updates)) {
      const old = links[id];
      if (old?.type === 'device' && !stillLinked.has(old.id)) released.add(old.id);
    }
    const nextNamed = { ...named };
    restoreDevices(world, nextNamed, released);
    if (nameDevice) {
      const taken = new Set(
        Object.values(world.devices).flatMap((d) => (d.name_by_user ? [d.name_by_user] : [])),
      );
      const done = new Set<string>();
      for (const [id, link] of Object.entries(updates)) {
        const target = link as Link | null;
        const device = target?.type === 'device' ? world.devices[target.id] : undefined;
        if (!target || !device || done.has(target.id) || device.name_by_user) continue;
        done.add(target.id);
        const level = pkg.levels.find((l) => l.plans.some((p) => p.elements.some((e) => e.id === id)));
        const element = known.get(id);
        if (!level || !element) continue;
        const name = installedName(level.name, element, taken);
        taken.add(name);
        const placed = device.area_id ?? ensureArea(world, level.name);
        world.devices[target.id] = { ...device, name_by_user: name, area_id: placed };
        nextNamed[target.id] = {
          name,
          area_id: placed,
          prev_name: device.name_by_user ?? null,
          prev_area_id: device.area_id ?? null,
        };
      }
    }
    links = next;
    named = nextNamed;
    commit(world);
    emit('links');
    return { links: structuredClone(links) };
  }

  /** Put back the name and area Maxsen replaced on these devices, unless a person changed them since. */
  function restoreDevices(world: World, records: Record<string, NamedRecord>, deviceIds: Iterable<string>): void {
    for (const deviceId of deviceIds) {
      const record = records[deviceId];
      if (!record) continue;
      delete records[deviceId];
      const device = world.devices[deviceId];
      if (!device) continue;
      world.devices[deviceId] = {
        ...device,
        ...(device.name_by_user === record.name ? { name_by_user: record.prev_name } : {}),
        ...((device.area_id ?? null) === record.area_id ? { area_id: record.prev_area_id } : {}),
      };
    }
  }

  function setQuickPanel(msg: Message): unknown {
    const items = msg['items'];
    if (!Array.isArray(items) || !items.every(isQuickItem)) {
      throw new CommandError('invalid_format', 'items must be a list of {type, id}');
    }
    requireHome(msg);
    quickPanel = items.map(({ type, id }) => ({ type, id }));
    emit('quick_panel');
    return { quick_panel: structuredClone(quickPanel) };
  }

  function setDisplay(msg: Message): unknown {
    const background = msg['background'];
    if (background !== 'soft' && background !== 'original') {
      throw new CommandError('invalid_format', 'background must be "soft" or "original"');
    }
    requireHome(msg);
    requireInstaller('Changing the display');
    display = { background };
    emit('home');
    return { display: structuredClone(display) };
  }

  /** Replace the scene entities with ones for `next`. Returns the entity ids of the new scenes. */
  function setScenes(world: World, next: StarterScene[]): string[] {
    for (const id of sceneEntities.keys()) {
      delete world.entities[id];
      delete world.states[id];
    }
    sceneEntities = new Map();
    scenes = next;
    return next.map((scene) => {
      const id = addEntity(world, `scene.${slug(scene.name)}`, scene.name, 'unknown', {
        entity_id: scene.entity_ids,
      }, {});
      sceneEntities.set(id, scene);
      return id;
    });
  }

  function createStarter(msg: Message): unknown {
    requireHome(msg);
    requireInstaller('Creating scenes');
    const world = draft();
    const old = [...sceneEntities.keys()];
    const ids = setScenes(world, buildStarterScenes(pkg, links, world));
    const known = new Set(quickPanel.map((i) => `${i.type}:${i.id}`));
    const added = ids.filter((id) => !known.has(`entity:${id}`));
    // Scenes that are gone from the list leave the quick panel; new ones are appended.
    const gone = old.filter((id) => !ids.includes(id));
    const kept = quickPanel.filter((i) => !(i.type === 'entity' && gone.includes(i.id)));
    const panelChanged = added.length > 0 || kept.length !== quickPanel.length;
    quickPanel = [...kept, ...added.map((id): QuickItem => ({ type: 'entity', id }))];
    commit(world);
    if (panelChanged) emit('quick_panel');
    return { scenes: structuredClone(scenes) };
  }

  function pruneExpired(): void {
    const now = Date.now();
    for (const [id, p] of previews) if (p.expires < now) previews.delete(id);
  }

  function previewRefresh(msg: Message): unknown {
    requireHome(msg);
    requireInstaller('Refreshing');
    const fileId = msg['file_id'];
    let next: HomePackage;
    if (fileId !== undefined) {
      const file = nonEmpty(fileId) ? files.get(fileId) : undefined;
      if (file === undefined) throw new CommandError('invalid_package', 'That file is no longer available');
      next = typeof file === 'string' ? readUploaded(file) : file;
    } else if (source === 'planner') {
      if (revoked) {
        throw new CommandError(
          'revoked',
          'Connection revoked: ask Maxsen for a new pairing code, then use Reconfigure on the Maxsen Home integration.',
        );
      }
      next = plannerPackage;
    } else {
      throw new CommandError('invalid_package', 'Choose the file to refresh from');
    }
    pruneExpired();
    const summary = diff(pkg, next);
    const previewId = `preview-${++counter}`;
    previews.set(previewId, { pkg: next, summary, expires: Date.now() + PREVIEW_TTL_MS });
    return { preview_id: previewId, ...structuredClone(summary) };
  }

  function applyRefresh(msg: Message): unknown {
    requireHome(msg);
    requireInstaller('Refreshing');
    pruneExpired();
    const previewId = msg['preview_id'];
    const preview = nonEmpty(previewId) ? previews.get(previewId) : undefined;
    if (!preview || !nonEmpty(previewId)) {
      throw new CommandError('preview_expired', 'The preview expired. Preview again.');
    }
    previews.delete(previewId);

    const removed = new Set(preview.summary.removed.map((e) => e.id));
    const before = elementsOf(pkg);
    const world = draft();
    // New elements get fake devices but stay unlinked, as after a real refresh.
    provision(world, preview.pkg, (id) => !before.has(id));
    pkg = preview.pkg;
    stored = strip(pkg);
    const pruned = Object.fromEntries(Object.entries(links).filter(([id]) => !removed.has(id)));
    // Devices only a removed marker linked to go back to their own name and area.
    const stillLinked = new Set(Object.values(pruned).flatMap((l) => (l.type === 'device' ? [l.id] : [])));
    const dropped = Object.entries(links).flatMap(([id, l]) =>
      removed.has(id) && l.type === 'device' && !stillLinked.has(l.id) ? [l.id] : [],
    );
    links = pruned;
    named = { ...named };
    restoreDevices(world, named, dropped);
    quickPanel = quickPanel.filter((i) => !(i.type === 'element' && removed.has(i.id)));
    if (scenes.length > 0) {
      const old = [...sceneEntities.keys()];
      const ids = setScenes(world, buildStarterScenes(pkg, links, world));
      quickPanel = quickPanel.filter((i) => !(i.type === 'entity' && old.includes(i.id) && !ids.includes(i.id)));
    }
    commit(world);
    emit('home');
    return { preview_id: previewId, ...structuredClone(preview.summary) };
  }

  /** Parse an uploaded home as the integration does, with its words for what is wrong. */
  function readUploaded(text: string): HomePackage {
    let parsed: HomePackage;
    try {
      parsed = parseHomeFile(text);
    } catch (error) {
      if (error instanceof PackageProblem) {
        throw new CommandError('invalid_package', REJECTED_MESSAGES[error.reason]);
      }
      throw error;
    }
    if (parsed.project.id !== pkg.project.id) {
      throw new CommandError('invalid_package', 'This home file is for a different project.');
    }
    return parsed;
  }

  /** Home Assistant's `POST /api/file_upload`: keeps the `file` of a multipart form, answers `{file_id}`. */
  async function handleUpload(init?: RequestInit): Promise<Response> {
    if (init?.method !== 'POST') return new Response(null, { status: 404 });
    const file = init.body instanceof FormData ? init.body.get('file') : null;
    if (!(file instanceof Blob)) return new Response(null, { status: 400 });
    const id = `file-${++counter}`;
    files.set(id, await file.text());
    return new Response(JSON.stringify({ file_id: id }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  async function callWS<T>(msg: Message): Promise<T> {
    requireStarted(msg.type);
    const result = ((): unknown => {
      switch (msg.type) {
        case 'config_entries/get':
          return msg['domain'] === undefined || msg['domain'] === 'maxsen'
            ? [
                {
                  entry_id: ENTRY_ID,
                  domain: 'maxsen',
                  title: stored.project.title,
                  state: Date.now() < startingUntil ? 'not_loaded' : 'loaded',
                },
              ]
            : [];
        case 'maxsen/home':
          requireHome(msg);
          return homeResponse();
        case 'maxsen/links/set':
          return setLinks(msg);
        case 'maxsen/quick_panel/set':
          return setQuickPanel(msg);
        case 'maxsen/display/set':
          return setDisplay(msg);
        case 'maxsen/scenes/create_starter':
          return createStarter(msg);
        case 'maxsen/refresh/preview':
          return previewRefresh(msg);
        case 'maxsen/refresh/apply':
          return applyRefresh(msg);
        default:
          throw new CommandError('unknown_command', `Unknown command ${msg.type}`);
      }
    })();
    return result as T;
  }

  const fake: FakeHass = {
    states: {},
    entities: {},
    devices: {},
    areas: {},
    user: { is_admin: opts.admin },
    callService,
    callWS,
    connection: {
      async subscribeMessage<T>(
        callback: (message: T) => void,
        message: { type: string; [key: string]: unknown },
        options?: { resubscribe?: boolean },
      ): Promise<() => Promise<void>> {
        if (message.type === 'maxsen/identify/subscribe') {
          requireStarted(message.type);
          return subscribeIdentify(callback, message, options);
        }
        if (message.type !== 'maxsen/subscribe') {
          throw new CommandError('unknown_command', `Unknown command ${message.type}`);
        }
        requireStarted(message.type);
        requireHome(message);
        const subscriber: Subscription = {
          notify: (event) => callback({ event } as T),
          resubscribe: options?.resubscribe !== false,
        };
        subscribers.add(subscriber);
        // Like Home Assistant, ending a subscription that is already gone is an error.
        return async () => {
          if (!subscribers.delete(subscriber)) {
            throw new CommandError('not_found', 'Subscription not found.');
          }
        };
      },
      addEventListener(event, listener) {
        if (event === 'ready') readyListeners.add(listener);
      },
      removeEventListener(event, listener) {
        if (event === 'ready') readyListeners.delete(listener);
      },
    },
    async fetchWithAuth(path: string, init?: RequestInit): Promise<Response> {
      if (path === '/api/file_upload') return handleUpload(init);
      const match = /^\/api\/maxsen\/image\/([^/?#]+)\/([^/?#]+)$/.exec(path.split('?', 1)[0] ?? '');
      const image = match?.[1] === ENTRY_ID ? pkg.images[match[2] ?? ''] : undefined;
      if (!image) return new Response(null, { status: 404 });
      const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
      return new Response(bytes, { status: 200, headers: { 'content-type': image.mediaType } });
    },

    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setAdmin(admin) {
      fake.user = { is_admin: admin };
      for (const listener of [...listeners]) listener();
    },
    setInstallerMode(on) {
      installerMode = on;
      if (!on) {
        // Identify ends itself, telling the client once (identify.py `_check_allowed`).
        for (const sub of [...identifiers]) {
          sub.send({ stopped: true });
          stopIdentify(sub);
        }
      }
      emit('home');
      for (const listener of [...listeners]) listener();
    },
    openHome(next) {
      // Build everything first: if anything throws, the previous home is left exactly as it was.
      const nextStored = strip(next);
      const world: World = { states: {}, entities: {}, devices: {}, areas: {} };
      const nextLinks = provision(world, next, () => true);
      const nextNonZigbee = new Set([addWifiPlug(world)]);
      pkg = next;
      stored = nextStored;
      source = 'file';
      plannerPackage = next;
      revoked = false;
      links = nextLinks;
      nonZigbee = nextNonZigbee;
      // The home these prompts were about is gone, as when the integration unloads.
      for (const sub of [...identifiers]) {
        sub.send({ stopped: true });
        stopIdentify(sub);
      }
      named = {};
      quickPanel = [];
      display = { background: 'soft' };
      scenes = [];
      sceneEntities = new Map();
      files.clear();
      previews.clear();
      commit(world);
      emit('home');
    },
    setPlannerPackage(next) {
      plannerPackage = next;
    },
    revokePairing() {
      revoked = true;
    },
    uploadFile(file) {
      const id = `file-${++counter}`;
      files.set(id, file);
      return id;
    },
    restart(startingMs = 5_000) {
      for (const subscriber of [...subscribers]) {
        if (!subscriber.resubscribe) subscribers.delete(subscriber);
      }
      for (const sub of [...identifiers]) {
        if (sub.resubscribe) continue;
        sub.lost = true;
        stopIdentify(sub);
      }
      startingUntil = Date.now() + startingMs;
      for (const listener of [...readyListeners]) listener();
    },
    pressTargets,
    press,
    startSimulation(everyMs = DOOR_FLIP_MS) {
      const timer = setInterval(() => {
        const world = draft();
        for (const [id, s] of Object.entries(world.states)) {
          if (domainOf(id) === 'binary_sensor' && s.attributes['device_class'] === 'door') {
            setStates(world, id, s.state === 'on' ? 'off' : 'on');
          }
        }
        commit(world);
      }, everyMs);
      return () => clearInterval(timer);
    },
  };

  // The first home: the fake world and its automatic links.
  const world = draft();
  links = provision(world, pkg, () => true);
  nonZigbee.add(addWifiPlug(world));
  commit(world);
  return fake;
}
