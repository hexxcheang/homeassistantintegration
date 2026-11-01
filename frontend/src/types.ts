/**
 * Types shared by the card and the panel.
 *
 * The home package and scene shapes are copied from the planner, which is the source of truth:
 *   - maxsen-planner/packages/domain/src/home-package/types.ts  (HomePackage and friends)
 *   - maxsen-planner/packages/domain/src/render/scene.ts        (Scene and its items)
 *   - maxsen-planner/packages/domain/src/categories.ts          (CategoryId, ElementKind, BadgeStyle)
 *   - maxsen-planner/packages/domain/src/icons.ts               (IconShape)
 * Change them there first, then here.
 */

export type CategoryId =
  | 'smart-switches'
  | 'control-panels'
  | 'curtains-blinds'
  | 'aircon-controllers'
  | 'gateways'
  | 'sensors'
  | 'cameras'
  | 'network-devices'
  | 'smart-locks'
  | 'misc-smart-home'
  | 'downlights'
  | 'surface-lights'
  | 'track-lights'
  | 'led-strips'
  | 'magnetic-track-lights'
  | 'pendant-lights'
  | 'ceiling-fans'
  | 'spotlights'
  | 'misc-lighting';

export type ElementKind = 'point' | 'led-strip' | 'track' | 'curtain';
export type BadgeStyle = 'filled' | 'outline';

export type IconShape =
  | 'square'
  | 'panel'
  | 'pill'
  | 'hexagon'
  | 'diamond'
  | 'target'
  | 'dome'
  | 'triangle'
  | 'arch'
  | 'dot'
  | 'circle'
  | 'roundedSquare'
  | 'drop'
  | 'star4'
  | 'smallHexagon'
  | 'fan'
  | 'track'
  | 'strip'
  | 'magnetic'
  | 'curtain';

export interface Pt {
  x: number;
  y: number;
}

// ---- Scene (render/scene.ts) ----

export interface SceneLabel {
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

export interface SceneBadge {
  text: string;
  /** Text colour: readable on the fill for filled badges, the category colour for outline ones. */
  color: string;
  /** Offset from the icon centre in plan units, before rotation. */
  dx: number;
  dy: number;
  fontSize: number;
}

export interface SceneMarker {
  type: 'marker';
  elementId: string;
  z: number;
  categoryId: CategoryId;
  shape: IconShape;
  x: number;
  y: number;
  rotation: number;
  size: number;
  color: string;
  badgeStyle: BadgeStyle;
  badge: SceneBadge;
  /** Icon outline in the −0.5…0.5 unit box; scale by `size` and translate to (x, y). */
  pathD: string;
  label?: SceneLabel;
}

export interface SceneHead {
  x: number;
  y: number;
  angle: number;
  size: number;
}

export interface ScenePath {
  type: 'path';
  elementId: string;
  z: number;
  categoryId: CategoryId;
  kind: 'led-strip' | 'track' | 'curtain';
  shape: IconShape;
  d: string;
  points: Pt[];
  closed: boolean;
  smooth: boolean;
  strokeWidth: number;
  color: string;
  /** Dot pattern (dash, gap) for a dotted line (curtains); absent for a solid one. */
  dash?: [number, number];
  heads: SceneHead[];
  label?: SceneLabel;
}

export interface SceneNote {
  type: 'note';
  elementId: string;
  z: number;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  bold: boolean;
  color: string;
  highlight: string | null;
}

export type SceneItem = SceneMarker | ScenePath | SceneNote;

export interface SceneLegendEntry {
  categoryId: CategoryId;
  name: string;
  shape: IconShape;
  color: string;
  badge: string;
  badgeStyle: BadgeStyle;
  kind: ElementKind;
}

export interface Scene {
  width: number;
  height: number;
  /** Everything to draw, in ascending z order. */
  items: SceneItem[];
  /** Categories present among the drawn items, in fixed category order. */
  legend: SceneLegendEntry[];
}

// ---- Home package (home-package/types.ts) ----

export interface HomeImage {
  mediaType: string;
  /** base64 with no `data:` prefix. */
  data: string;
}

export interface HomeElement {
  /** Planner element id, stable across saves. */
  id: string;
  categoryId: CategoryId;
  kind: ElementKind;
  productName: string;
  variantName: string;
  /** The marker's label, kept even when showLabels is off; empty only when none. */
  label: string;
  /** False when its category is hidden in the export settings. */
  drawn: boolean;
}

export interface HomePlan {
  id: string;
  type: 'smart-home' | 'lighting';
  revision: number;
  /** Plan units, always 1000. */
  width: number;
  /** 1000 * background.height / background.width. */
  height: number;
  /** Equal keys mean identical backgrounds. */
  background: { imageId: string; key: string };
  scene: Scene;
  /** Every non-note element of the plan, drawn or not. */
  elements: HomeElement[];
}

export interface HomeLevel {
  id: string;
  name: string;
  sortOrder: number;
  plans: HomePlan[];
}

/** The package as the planner sends it. The card never sees this: images are stripped on save. */
export interface HomePackage {
  format: 'maxsen-home';
  schemaVersion: 1;
  project: { id: string; title: string };
  /** ISO timestamp. */
  exportedAt: string;
  savedVersion: number;
  levels: HomeLevel[];
  images: Record<string, HomeImage>;
}

/** The package as stored by the integration: no image data, `image_types` instead. */
export type StoredHomePackage = Omit<HomePackage, 'images'> & {
  /** Image id to media type. */
  image_types: Record<string, string>;
};

// ---- Integration data (custom_components/maxsen/websocket.py) ----

/** Lighting links go to an entity; everything else to a device. */
export interface Link {
  type: 'device' | 'entity';
  id: string;
}

export interface QuickItem {
  type: 'element' | 'entity';
  id: string;
}

/** The `maxsen/home` result. */
export interface HomeResponse {
  package: StoredHomePackage | null;
  /** Planner element id to its link; unlinked elements are absent. */
  links: Record<string, Link>;
  quick_panel: QuickItem[];
  installer_mode: boolean;
  /** Image id to the URL to load it from. */
  image_urls: Record<string, string>;
}

// ---- Home Assistant (structural subset of the frontend `hass` object) ----

export interface HassState {
  state: string;
  attributes: Record<string, unknown>;
}

export interface HassEntity {
  entity_id: string;
  device_id?: string | null;
  area_id?: string | null;
  name?: string | null;
}

export interface HassDevice {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  area_id?: string | null;
}

export interface HassArea {
  area_id: string;
  name: string;
}

/** The websocket connection on the Home Assistant frontend's `hass` object. */
export interface HassConnection {
  /** Resolves to the function that ends the subscription. */
  subscribeMessage<T>(
    callback: (message: T) => void,
    subscribeMessage: { type: string; [key: string]: unknown },
  ): Promise<() => void>;
}

export interface HassLike {
  states: Record<string, HassState>;
  entities: Record<string, HassEntity>;
  devices: Record<string, HassDevice>;
  areas: Record<string, HassArea>;
  user: { is_admin: boolean };
  callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ): Promise<unknown>;
  callWS<T>(message: { type: string; [key: string]: unknown }): Promise<T>;
  connection: HassConnection;
  /** `fetch` with the user's access token added; `path` is relative to Home Assistant. */
  fetchWithAuth(path: string, init?: RequestInit): Promise<Response>;
}

// ---- Refresh and starter scenes (custom_components/maxsen/websocket.py) ----

/** An element named in a refresh summary, with what the installer needs to recognise it. */
export interface ChangedElement {
  id: string;
  productName: string;
  label: string;
}

/** What `maxsen/refresh/preview` and `maxsen/refresh/apply` report. */
export interface RefreshSummary {
  preview_id: string;
  added: ChangedElement[];
  removed: ChangedElement[];
  changed_drawings: ChangedElement[];
}
