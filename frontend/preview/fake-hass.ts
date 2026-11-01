/**
 * A simulated Home Assistant for the preview app: the `hass` object the real panel is given, with a
 * made-up home built from a home package, and the `maxsen/*` websocket commands answered in memory
 * with the same request, response and error shapes as the integration
 * (custom_components/maxsen/websocket.py).
 */
import type { HomeEvent } from '../src/api.ts';
import { LIGHTING_CATEGORIES } from '../src/link-candidates.ts';
import { PackageProblem, parseHomeFile } from './validate-package.ts';
import type {
  ChangedDrawing,
  ChangedElement,
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
  /** Flip the door sensors every 20 s so alerts can be seen. Returns the stop function. */
  startSimulation(everyMs?: number): () => void;
}

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

function uniqueDeviceName(world: World, wanted: string): string {
  const taken = new Set(Object.values(world.devices).map((d) => d.name));
  let name = wanted;
  for (let n = 2; taken.has(name); n++) name = `${wanted} ${n}`;
  return name;
}

/** "3-gang" in the variant name gives three switches; at most three, at least one. */
function gangCount(el: HomeElement): number {
  const match = /(\d+)\s*-?\s*gang/i.exec(`${el.variantName} ${el.productName}`);
  return Math.min(3, Math.max(1, match ? Number(match[1]) : 1));
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
  const id = addEntity(
    world,
    `switch.${slug(level.name)}_lighting_${n}`,
    `${level.name} lighting ${n}`,
    n % 2 === 1 ? 'on' : 'off',
    {},
    { areaId },
  );
  return { type: 'entity', id };
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
  let quickPanel: QuickItem[] = [];
  let scenes: StarterScene[] = [];
  /** Scene entity id to the starter scene behind it. */
  let sceneEntities = new Map<string, StarterScene>();
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
  const subscribers = new Set<(event: HomeEvent) => void>();

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
    for (const subscriber of [...subscribers]) subscriber(event);
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
    } else {
      throw new CommandError('service_not_found', `Service ${domain}.${service} not found.`);
    }
    commit(world);
    return undefined;
  }

  // ---- websocket ----

  const homeResponse = (): HomeResponse =>
    structuredClone({
      package: stored,
      links,
      quick_panel: quickPanel,
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
    links = next;
    emit('links');
    for (const listener of [...listeners]) listener();
    return { links: structuredClone(links) };
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
    links = Object.fromEntries(Object.entries(links).filter(([id]) => !removed.has(id)));
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
        throw new CommandError('invalid_package', `The home was rejected: ${error.reason}`);
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
    const result = ((): unknown => {
      switch (msg.type) {
        case 'config_entries/get':
          return msg['domain'] === undefined || msg['domain'] === 'maxsen'
            ? [{ entry_id: ENTRY_ID, domain: 'maxsen', title: stored.project.title, state: 'loaded' }]
            : [];
        case 'maxsen/home':
          requireHome(msg);
          return homeResponse();
        case 'maxsen/links/set':
          return setLinks(msg);
        case 'maxsen/quick_panel/set':
          return setQuickPanel(msg);
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
      ): Promise<() => void> {
        if (message.type !== 'maxsen/subscribe') {
          throw new CommandError('unknown_command', `Unknown command ${message.type}`);
        }
        requireHome(message);
        const subscriber = (event: HomeEvent): void => callback({ event } as T);
        subscribers.add(subscriber);
        return () => void subscribers.delete(subscriber);
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
      emit('home');
      for (const listener of [...listeners]) listener();
    },
    openHome(next) {
      // Build everything first: if anything throws, the previous home is left exactly as it was.
      const nextStored = strip(next);
      const world: World = { states: {}, entities: {}, devices: {}, areas: {} };
      const nextLinks = provision(world, next, () => true);
      pkg = next;
      stored = nextStored;
      source = 'file';
      plannerPackage = next;
      revoked = false;
      links = nextLinks;
      quickPanel = [];
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
  commit(world);
  return fake;
}
