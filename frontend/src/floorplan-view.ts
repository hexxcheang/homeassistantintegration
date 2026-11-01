import { LitElement, css, html, nothing, svg, type SVGTemplateResult, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { loadImage } from './api.ts';
import { domainOf } from './hass-util.ts';
import { CONTROLLABLE, linkEntityIds, primaryEntity, toggleEntities } from './operate.ts';
import { LIGHTING_CATEGORIES } from './link-candidates.ts';
import { sceneToSvg, type SvgNode } from './scene-svg.ts';
import type {
  HassLike,
  HomeElement,
  HomeLevel,
  HomePlan,
  HomeResponse,
  Link,
  SceneItem,
} from './types.ts';
import { contentBox, layerOptions, type Box, type Layer } from './view-geometry.ts';
import { visualState, type VisualState } from './visual-state.ts';

export type ViewMode = 'use' | 'link';

const LONG_PRESS_MS = 500;
/** A pointer that moves further than this (CSS px) is dragging, not tapping or holding. */
const MOVE_TOLERANCE = 8;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE = 30;
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
/** Every marker can be hit within this many CSS px of its centre (44 px across) at default zoom. */
const HIT_RADIUS_PX = 22;
const NOTICE_MS = 4000;
/** Used until the stage has been measured, and in environments without layout. */
const FALLBACK_STAGE = { w: 800, h: 600 };

/** Lights glow when on; so do smart switches, which are mostly lights in disguise. */
const GLOWING = new Set<string>([...LIGHTING_CATEGORIES, 'smart-switches']);
/** The categories whose reading is shown as a pill beside the element. */
const PILLED = new Set<string>(['sensors', 'aircon-controllers', 'curtains-blinds', 'smart-locks']);

const LAYER_LABELS: Record<Layer, string> = { all: 'All', 'smart-home': 'Smart Home', lighting: 'Lighting' };

const IDENTITY = 'translate(0px, 0px) scale(1)';

const round = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** One scene's SVG nodes are the same until the scene itself changes. */
const nodeCache = new WeakMap<object, SvgNode[]>();
function sceneNodes(plan: HomePlan): SvgNode[] {
  let nodes = nodeCache.get(plan.scene);
  if (!nodes) {
    nodes = sceneToSvg(plan.scene);
    nodeCache.set(plan.scene, nodes);
  }
  return nodes;
}

interface Press {
  id: number;
  elementId: string | undefined;
  x: number;
  y: number;
  moved: boolean;
  long: boolean;
}

interface Popup {
  title: string;
  entityIds: string[];
}

/**
 * One home's floor plan: level tabs, the drawing over its background image, and live state from
 * Home Assistant. In `use` mode a tap operates the linked devices; in `link` mode it emits
 * `maxsen-element-tap` for the installer tools.
 */
export class MaxsenFloorplanView extends LitElement {
  static override properties = {
    hass: { attribute: false },
    home: { attribute: false },
    mode: { type: String },
    selected: { attribute: false },
    _levelId: { state: true },
    _layer: { state: true },
    _whole: { state: true },
    _images: { state: true },
    _stage: { state: true },
    _popup: { state: true },
    _notice: { state: true },
  };

  declare hass: HassLike | undefined;
  declare home: HomeResponse | undefined;
  declare mode: ViewMode;
  /** Element ids to outline in link mode. */
  declare selected: readonly string[];
  declare private _levelId: string | undefined;
  /** The layer picked on the toggle; a level that cannot show it falls back to its first option. */
  declare private _layer: Layer;
  /** Showing the whole drawing instead of the fitted box. */
  declare private _whole: boolean;
  /** Image id to object URL. */
  declare private _images: ReadonlyMap<string, string>;
  declare private _stage: { w: number; h: number };
  declare private _popup: Popup | undefined;
  declare private _notice: string | undefined;

  private _elements = new Map<string, HomeElement>();
  private _packageKey = '';
  private _loading = new Set<string>();
  private _generation = 0;

  private _pointers = new Map<number, { x: number; y: number }>();
  private _press: Press | undefined;
  private _pinch: { dist: number; scale: number; x: number; y: number; mid: { x: number; y: number } } | undefined;
  private _lastTap: { t: number; x: number; y: number } | undefined;
  private _view = { s: 1, x: 0, y: 0 };
  private _holdTimer: ReturnType<typeof setTimeout> | undefined;
  private _noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private _observer: ResizeObserver | undefined;
  private _observed: Element | undefined;
  private _shownPlans = '';

  constructor() {
    super();
    this.mode = 'use';
    this.selected = [];
    this._layer = 'all';
    this._whole = false;
    this._images = new Map();
    this._stage = FALLBACK_STAGE;
  }

  // ---- lifecycle ----

  override connectedCallback(): void {
    super.connectedCallback();
    // Images are dropped on disconnect; an update on re-attach loads them again.
    if (this.hasUpdated) this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._dropImages();
    this._cancelHold();
    clearTimeout(this._noticeTimer);
    this._observer?.disconnect();
    this._observer = undefined;
    this._observed = undefined;
    this._pointers.clear();
    this._press = undefined;
    this._pinch = undefined;
  }

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has('home')) return;
    const pkg = this.home?.package;
    const key = pkg ? `${pkg.project.id}|${pkg.exportedAt}|${pkg.savedVersion}` : '';
    if (key !== this._packageKey) {
      // A refreshed home may carry new backgrounds under the same ids.
      this._dropImages();
      this._packageKey = key;
    }
    this._elements = new Map(
      (pkg?.levels ?? []).flatMap((l) => l.plans.flatMap((p) => p.elements.map((e) => [e.id, e] as const))),
    );
    const levels = this._levels();
    if (!levels.some((l) => l.id === this._levelId)) this._levelId = levels[0]?.id;
  }

  override updated(): void {
    this._observeStage();
    this._loadImages();
    // A new level, layer or view box is a new drawing: start it unzoomed.
    const shown = `${this._levelId}|${this._visible().plans.map((p) => p.id).join(',')}|${this._whole}`;
    if (shown !== this._shownPlans) {
      this._shownPlans = shown;
      this._resetView();
    }
  }

  private _observeStage(): void {
    const stage = this.renderRoot.querySelector('.stage') ?? undefined;
    if (stage === this._observed) return;
    this._observer?.disconnect();
    this._observed = stage;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    this._observer ??= new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0) this._stage = { w: box.width, h: box.height };
    });
    this._observer.observe(stage);
  }

  // ---- images ----

  private _dropImages(): void {
    this._generation++;
    for (const url of this._images.values()) URL.revokeObjectURL(url);
    this._images = new Map();
    this._loading.clear();
  }

  private _loadImages(): void {
    const { hass, home } = this;
    // A detached view must not start fetches it would only throw away.
    if (!this.isConnected || !hass || !home?.package) return;
    for (const plan of this._visible().plans) {
      const id = plan.background.imageId;
      const url = home.image_urls[id];
      // A failed load stays in `_loading` so it is not retried on every update.
      if (!url || this._images.has(id) || this._loading.has(id)) continue;
      this._loading.add(id);
      const generation = this._generation;
      loadImage(hass, url).then(
        (objectUrl) => {
          if (generation !== this._generation || !this.isConnected) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          this._images = new Map(this._images).set(id, objectUrl);
        },
        () => undefined,
      );
    }
  }

  // ---- what is shown ----

  private _levels(): HomeLevel[] {
    return [...(this.home?.package?.levels ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * The plans to draw for the selected level, and the layers it offers. Hit testing and drawing
   * use only these plans, so a hidden layer's devices are neither drawn nor tappable.
   */
  private _visible(): { plans: HomePlan[]; options: Layer[]; layer: Layer } {
    const level = this._levels().find((l) => l.id === this._levelId);
    const all = level?.plans ?? [];
    const options = layerOptions(all);
    if (options.length === 0) return { plans: all, options, layer: 'all' };
    const layer = options.includes(this._layer) ? this._layer : (options[0] as Layer);
    return { plans: layer === 'all' ? all : all.filter((p) => p.type === layer), options, layer };
  }

  /** The area of the drawing in view at 1x: the items of what is shown, or the whole drawing. */
  private _boxes(plans: HomePlan[]): { fitted: Box; whole: Box; shown: Box } {
    const first = plans[0] as HomePlan;
    const whole = { x: 0, y: 0, w: first.width, h: first.height };
    const fitted = contentBox(
      plans.flatMap((p) => p.scene.items),
      first.width,
      first.height,
    );
    return { fitted, whole, shown: this._whole ? whole : fitted };
  }

  private _state(elementId: string): VisualState {
    const el = this._elements.get(elementId);
    if (!el || !this.hass) return { status: 'unlinked' };
    return visualState(el, this.home?.links[elementId], this.hass);
  }

  // ---- gestures ----

  private _local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  private _stageSize(): { w: number; h: number } {
    const box = this.renderRoot.querySelector('.stage')?.getBoundingClientRect();
    return box && box.width > 0 && box.height > 0 ? { w: box.width, h: box.height } : this._stage;
  }

  private _applyView(): void {
    const { w, h } = this._stageSize();
    const v = this._view;
    v.x = clamp(v.x, w * (1 - v.s), 0);
    v.y = clamp(v.y, h * (1 - v.s), 0);
    const canvas = this.renderRoot.querySelector<HTMLElement>('.canvas');
    // Written straight to the element: a gesture must not re-render the whole drawing.
    if (canvas) canvas.style.transform = `translate(${round(v.x)}px, ${round(v.y)}px) scale(${round(v.s)})`;
  }

  private _resetView(): void {
    this._view = { s: 1, x: 0, y: 0 };
    this._applyView();
  }

  /** Zoom to `scale`, keeping the drawing point under (fx, fy) where it is. */
  private _zoomAt(fx: number, fy: number, scale: number, from = this._view): void {
    const s = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    const px = (fx - from.x) / from.s;
    const py = (fy - from.y) / from.s;
    this._view = { s, x: fx - px * s, y: fy - py * s };
    this._applyView();
  }

  private _elementIdAt(e: Event): string | undefined {
    const target = (e.composedPath()[0] ?? e.target) as Element | null;
    const id = target?.closest?.('[data-element-id]')?.getAttribute('data-element-id') ?? undefined;
    return id !== undefined && this._elements.has(id) ? id : undefined;
  }

  private _onDown(e: PointerEvent): void {
    const stage = e.currentTarget as HTMLElement;
    const p = this._local(e);
    this._pointers.set(e.pointerId, p);
    try {
      stage.setPointerCapture?.(e.pointerId);
    } catch {
      // Not an active pointer (synthetic events); the stage still gets the events it needs.
    }
    if (this._pointers.size === 1) {
      const elementId = this._elementIdAt(e);
      const press: Press = { id: e.pointerId, elementId, x: p.x, y: p.y, moved: false, long: false };
      this._press = press;
      this._cancelHold();
      if (elementId && this.mode === 'use') {
        this._holdTimer = setTimeout(() => this._onHold(press), LONG_PRESS_MS);
      }
    } else if (this._pointers.size === 2) {
      this._cancelPress();
      const [a, b] = [...this._pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this._pinch = {
        dist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
        scale: this._view.s,
        x: this._view.x,
        y: this._view.y,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    }
  }

  private _onMove(e: PointerEvent): void {
    const before = this._pointers.get(e.pointerId);
    if (!before) return;
    const p = this._local(e);
    this._pointers.set(e.pointerId, p);

    const pinch = this._pinch;
    if (pinch && this._pointers.size >= 2) {
      const [a, b] = [...this._pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const start = { s: pinch.scale, x: pinch.x, y: pinch.y };
      // Zoom about where the fingers started, then follow them as they travel.
      this._zoomAt(pinch.mid.x, pinch.mid.y, (pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist, start);
      this._view.x += mid.x - pinch.mid.x;
      this._view.y += mid.y - pinch.mid.y;
      this._applyView();
      return;
    }

    const press = this._press;
    if (press && press.id === e.pointerId && !press.moved) {
      if (Math.hypot(p.x - press.x, p.y - press.y) <= MOVE_TOLERANCE) return;
      press.moved = true;
      this._cancelHold();
    }
    if (!press || press.moved) {
      this._view.x += p.x - before.x;
      this._view.y += p.y - before.y;
      this._applyView();
    }
  }

  private _onUp(e: PointerEvent): void {
    this._pointers.delete(e.pointerId);
    if (this._pointers.size < 2) this._pinch = undefined;
    const press = this._press;
    if (!press || press.id !== e.pointerId) return;
    this._press = undefined;
    this._cancelHold();
    if (e.type === 'pointerup' && !press.moved && !press.long) this._onTap(press);
  }

  private _onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this._local(e);
    // Firefox reports lines, not pixels.
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    this._zoomAt(p.x, p.y, this._view.s * Math.exp(-delta * 0.0015));
  }

  private _cancelHold(): void {
    clearTimeout(this._holdTimer);
    this._holdTimer = undefined;
  }

  private _cancelPress(): void {
    this._cancelHold();
    this._press = undefined;
  }

  // ---- actions ----

  private _onTap(press: Press): void {
    if (!press.elementId) {
      // A second tap on the empty drawing puts it back.
      const now = Date.now();
      const last = this._lastTap;
      if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(press.x - last.x, press.y - last.y) < DOUBLE_TAP_DISTANCE) {
        this._lastTap = undefined;
        this._whole = false;
        this._resetView();
      } else {
        this._lastTap = { t: now, x: press.x, y: press.y };
      }
      return;
    }
    if (this.mode === 'link') {
      this.dispatchEvent(
        new CustomEvent('maxsen-element-tap', {
          detail: { elementId: press.elementId },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    this._operate(press.elementId);
  }

  private _onHold(press: Press): void {
    press.long = true;
    this._holdTimer = undefined;
    const { hass, home } = this;
    const id = press.elementId;
    if (!hass || !home || !id) return;
    const status = this._state(id).status;
    const link = home.links[id];
    if (!link || status === 'unlinked' || status === 'missing') return;
    const entityId = primaryEntity(linkEntityIds(link, hass), hass);
    if (entityId) this._moreInfo(entityId);
  }

  private _moreInfo(entityId: string): void {
    this.dispatchEvent(
      new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }),
    );
  }

  /** A tap in use mode. */
  private _operate(elementId: string): void {
    const { hass, home } = this;
    const link = home?.links[elementId];
    const status = this._state(elementId).status;
    if (!hass || !link || status === 'unlinked' || status === 'missing' || status === 'unavailable') return;

    const ids = linkEntityIds(link, hass);
    const controls = ids.filter((id) => CONTROLLABLE.has(domainOf(id)));
    if (controls.length === 0) {
      const entityId = primaryEntity(ids, hass);
      if (entityId) this._moreInfo(entityId);
    } else if (link.type === 'device' && controls.length > 1) {
      const el = this._elements.get(elementId);
      const device = hass.devices[link.id];
      this._popup = {
        title: el?.label || device?.name_by_user || device?.name || el?.productName || '',
        entityIds: controls,
      };
    } else {
      void this._toggle(controls);
    }
  }

  private async _toggle(ids: string[]): Promise<void> {
    if (this.hass && !(await toggleEntities(this.hass, ids))) this._showNotice('Could not reach that device.');
  }

  private _showNotice(text: string): void {
    this._notice = text;
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => (this._notice = undefined), NOTICE_MS);
  }

  // ---- drawing ----

  private _renderNode(node: SvgNode): SVGTemplateResult {
    const a = node.attrs;
    switch (node.tag) {
      case 'g':
        return svg`<g>${(node.children ?? []).map((c) => this._renderNode(c))}</g>`;
      case 'path':
        return svg`<path
          d=${ifDefined(a['d'])}
          transform=${ifDefined(a['transform'])}
          fill=${ifDefined(a['fill'])}
          fill-rule=${ifDefined(a['fill-rule'])}
          stroke=${ifDefined(a['stroke'])}
          stroke-width=${ifDefined(a['stroke-width'])}
          stroke-linecap=${ifDefined(a['stroke-linecap'])}
          stroke-linejoin=${ifDefined(a['stroke-linejoin'])}
          stroke-dasharray=${ifDefined(a['stroke-dasharray'])}
          opacity=${ifDefined(a['opacity'])}
        />`;
      case 'text':
        return svg`<text
          x=${ifDefined(a['x'])}
          y=${ifDefined(a['y'])}
          font-size=${ifDefined(a['font-size'])}
          font-weight=${ifDefined(a['font-weight'])}
          text-anchor=${ifDefined(a['text-anchor'])}
          dominant-baseline=${ifDefined(a['dominant-baseline'])}
          fill=${ifDefined(a['fill'])}
          transform=${ifDefined(a['transform'])}
          stroke=${ifDefined(a['stroke'])}
          stroke-width=${ifDefined(a['stroke-width'])}
          stroke-linejoin=${ifDefined(a['stroke-linejoin'])}
          paint-order=${ifDefined(a['paint-order'])}
        >${node.text ?? ''}</text>`;
    }
  }

  private _renderPill(item: SceneItem, text: string, planWidth: number): SVGTemplateResult {
    const fontSize = 14;
    const w = text.length * fontSize * 0.58 + fontSize * 1.2;
    const h = fontSize * 1.7;
    let x: number;
    let y: number;
    if (item.type === 'marker') {
      x = item.x + item.size / 2 + 6;
      if (x + w > planWidth) x = item.x - item.size / 2 - 6 - w;
      y = item.y;
    } else if (item.type === 'path') {
      // Centred on the line, from its first point to its last.
      const a = item.points[0];
      const b = item.points[item.points.length - 1];
      x = ((a?.x ?? 0) + (b?.x ?? 0)) / 2 - w / 2;
      y = ((a?.y ?? 0) + (b?.y ?? 0)) / 2 - h;
    } else {
      return svg``;
    }
    return svg`<g class="pill" transform="translate(${round(x)} ${round(y)})">
      <rect y=${-h / 2} width=${w} height=${h} rx=${h / 2} />
      <text x=${w / 2} y="0" font-size=${fontSize} text-anchor="middle" dominant-baseline="central">${text}</text>
    </g>`;
  }

  /** Link mode only: a halo behind a selected element, a dashed ring around one with no working link. */
  private _renderLinkMarks(item: SceneItem, status: VisualState['status'], selected: boolean): SVGTemplateResult {
    if (item.type === 'note') return svg``;
    const flawed = status === 'unlinked' || status === 'missing';
    const ringClass = classMap({ 'link-ring': true, missing: status === 'missing' });
    if (item.type === 'marker') {
      const r = Math.max(item.size * 0.85, 20);
      return svg`
        ${selected ? svg`<circle class="halo" cx=${item.x} cy=${item.y} r=${round(r + 6)} />` : nothing}
        ${flawed ? svg`<circle class=${ringClass} cx=${item.x} cy=${item.y} r=${round(r)} />` : nothing}
      `;
    }
    return svg`
      ${selected
        ? svg`<path class="halo line" d=${item.d} stroke-width=${item.strokeWidth + 16} />`
        : nothing}
      ${flawed
        ? svg`<path class=${ringClass} d=${item.d} stroke-width=${item.strokeWidth + 8} />`
        : nothing}
    `;
  }

  private _renderItem(item: SceneItem, node: SvgNode, plan: HomePlan, hitRadius: number): SVGTemplateResult {
    const id = item.elementId;
    const children = (node.children ?? []).map((c) => this._renderNode(c));
    if (item.type === 'note' || !this._elements.has(id)) {
      return svg`<g class="static" data-element-id=${id}>${children}</g>`;
    }
    const state = this._state(id);
    const glowing = state.status === 'on' && GLOWING.has(item.categoryId);
    const filter = glowing ? (item.type === 'path' ? 'url(#maxsen-glow-path)' : 'url(#maxsen-glow)') : undefined;
    const pill = state.text && PILLED.has(item.categoryId) ? this._renderPill(item, state.text, plan.width) : nothing;
    const linking = this.mode === 'link';
    const selected = linking && this.selected.includes(id);
    return svg`<g
      class=${classMap({
        element: true,
        [item.type]: true,
        [state.status]: true,
        linking,
        selected,
      })}
      data-element-id=${id}
    >
      ${item.type === 'marker'
        ? svg`<circle class="hit" cx=${item.x} cy=${item.y} r=${round(hitRadius)} fill="transparent" />`
        : svg`<path
            class="hit"
            d=${item.d}
            fill="none"
            stroke="transparent"
            stroke-width=${round(hitRadius * 2)}
            stroke-linecap="round"
            stroke-linejoin="round"
            pointer-events="stroke"
          />`}
      ${linking ? this._renderLinkMarks(item, state.status, selected) : nothing}
      ${state.status === 'alert' && item.type === 'marker'
        ? svg`<circle class="alert-ring" cx=${item.x} cy=${item.y} r=${Math.max(item.size * 0.9, 18)} />`
        : nothing}
      <g class="glyph" filter=${ifDefined(filter)}>${children}</g>
      ${pill}
    </g>`;
  }

  private _renderDrawing(plans: HomePlan[], box: Box): TemplateResult {
    const first = plans[0] as HomePlan;
    const image = this._images.get(first.background.imageId);
    const fit = Math.min(this._stage.w / box.w, this._stage.h / box.h);
    const hitRadius = HIT_RADIUS_PX / fit;
    const soft = this.home?.display?.background !== 'original';
    return html`
      <svg viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="maxsen-glow" x="-300%" y="-300%" width="700%" height="700%" color-interpolation-filters="sRGB">
            <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#ffb22e" flood-opacity="0.95" result="near" />
            <feDropShadow in="near" dx="0" dy="0" stdDeviation="16" flood-color="#ffb22e" flood-opacity="0.7" />
          </filter>
          <!-- A straight line has no area, so this one is sized in plan units, not by the shape. -->
          <filter id="maxsen-glow-path" filterUnits="userSpaceOnUse" x="0" y="0" width=${first.width} height=${first.height} color-interpolation-filters="sRGB">
            <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#ffb22e" flood-opacity="0.95" result="near" />
            <feDropShadow in="near" dx="0" dy="0" stdDeviation="16" flood-color="#ffb22e" flood-opacity="0.7" />
          </filter>
        </defs>
        <rect width=${first.width} height=${first.height} fill="#fff" />
        ${image
          ? svg`<image
              class=${classMap({ background: true, soft })}
              href=${image}
              width=${first.width}
              height=${first.height}
              preserveAspectRatio="none"
            />`
          : nothing}
        ${plans.map((plan) => {
          const nodes = sceneNodes(plan);
          return svg`<g class="plan">${plan.scene.items.map((item, i) =>
            this._renderItem(item, nodes[i] as SvgNode, plan, hitRadius),
          )}</g>`;
        })}
      </svg>
    `;
  }

  private _renderPopup(): TemplateResult | typeof nothing {
    const popup = this._popup;
    const hass = this.hass;
    if (!popup || !hass) return nothing;
    const close = () => (this._popup = undefined);
    return html`
      <div class="popup-layer">
        <div class="popup-backdrop" @click=${close}></div>
        <div class="popup" role="dialog" aria-label=${popup.title}>
          <div class="popup-title">
            <span>${popup.title}</span>
            <button class="close" aria-label="Close" @click=${close}>&times;</button>
          </div>
          ${popup.entityIds.map((id) => {
            const s = hass.states[id];
            const name = typeof s?.attributes['friendly_name'] === 'string' ? s.attributes['friendly_name'] : id;
            const on = s?.state === 'on' || (domainOf(id) === 'cover' && s?.state !== 'closed');
            return html`<div class="row">
              <button class="name" @click=${() => { close(); this._moreInfo(id); }}>${name}</button>
              <span class="state">${s?.state ?? ''}</span>
              <button
                class=${classMap({ switch: true, checked: on })}
                role="switch"
                aria-checked=${on ? 'true' : 'false'}
                aria-label=${`Toggle ${name}`}
                @click=${() => void this._toggle([id])}
              ><span class="knob"></span></button>
            </div>`;
          })}
        </div>
      </div>
    `;
  }

  override render(): TemplateResult {
    const pkg = this.home?.package;
    if (!pkg || pkg.levels.length === 0) {
      return html`<div class="empty">No home loaded yet. An installer adds it from the Maxsen Planner.</div>`;
    }
    const levels = this._levels();
    const { plans, options, layer } = this._visible();
    const boxes = plans.length > 0 ? this._boxes(plans) : undefined;
    // With nothing placed the fitted box is the whole drawing: there is nothing to switch between.
    const canFit = boxes !== undefined && (boxes.fitted.w < boxes.whole.w || boxes.fitted.h < boxes.whole.h);
    return html`
      <div class="bar">
        <div class="tabs" role="tablist">
          ${levels.map(
            (l) => html`<button
              role="tab"
              aria-selected=${l.id === this._levelId ? 'true' : 'false'}
              class=${classMap({ active: l.id === this._levelId })}
              @click=${() => {
                this._levelId = l.id;
                this._whole = false;
              }}
            >${l.name}</button>`,
          )}
        </div>
        <div class="controls">
          ${options.length > 0
            ? html`<div class="plan-toggle" role="group" aria-label="Layer">
                ${options.map(
                  (option) => html`<button
                    class=${classMap({ active: layer === option })}
                    aria-pressed=${layer === option ? 'true' : 'false'}
                    @click=${() => (this._layer = option)}
                  >${LAYER_LABELS[option]}</button>`,
                )}
              </div>`
            : nothing}
          ${canFit
            ? html`<button class="fit" @click=${() => (this._whole = !this._whole)}>
                ${this._whole ? 'Fit to rooms' : 'Whole drawing'}
              </button>`
            : nothing}
        </div>
      </div>
      <div
        class="stage"
        @pointerdown=${this._onDown}
        @pointermove=${this._onMove}
        @pointerup=${this._onUp}
        @pointercancel=${this._onUp}
        @wheel=${this._onWheel}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div class="canvas" style=${`transform: ${IDENTITY}`}>
          ${boxes ? this._renderDrawing(plans, boxes.shown) : html`<div class="empty">This level has no plan.</div>`}
        </div>
      </div>
      ${this._renderPopup()}
      ${this._notice ? html`<div class="notice" role="status">${this._notice}</div>` : nothing}
    `;
  }

  static override styles = css`
    :host {
      position: relative;
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
      color: var(--primary-text-color, #1f1d1a);
      background: var(--secondary-background-color, #f4f5f7);
      font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    }
    .empty {
      margin: auto;
      padding: 32px 24px;
      max-width: 420px;
      text-align: center;
      font-size: 17px;
      line-height: 1.5;
      color: var(--secondary-text-color, #5b6168);
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 16px;
      padding: 10px 16px;
      background: var(--card-background-color, #fff);
      border-bottom: 1px solid var(--divider-color, #e3e6ea);
    }
    .tabs,
    .plan-toggle {
      display: flex;
      gap: 6px;
      overflow-x: auto;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .plan-toggle {
      padding: 3px;
      border-radius: 24px;
      background: var(--secondary-background-color, #f4f5f7);
    }
    .bar button {
      min-height: 44px;
      padding: 0 20px;
      border: 0;
      border-radius: 22px;
      background: transparent;
      color: var(--primary-text-color, #1f1d1a);
      font: inherit;
      font-size: 16px;
      white-space: nowrap;
      cursor: pointer;
    }
    .bar button.active {
      background: var(--primary-color, #2f6fed);
      color: var(--text-primary-color, #fff);
      font-weight: 600;
    }
    .bar button.fit {
      border: 1px solid var(--divider-color, #cfd3d9);
    }
    .stage {
      position: relative;
      flex: 1 1 auto;
      min-height: 240px;
      overflow: hidden;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      background: var(--card-background-color, #fff);
    }
    .canvas {
      position: absolute;
      inset: 0;
      transform-origin: 0 0;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    /* The plan's own drawing is the point: fade the background so the markers stand out. */
    image.soft {
      filter: grayscale(1) contrast(0.55) brightness(1.25);
      opacity: 0.6;
    }
    .element {
      cursor: pointer;
    }
    .element.unlinked,
    .element.missing,
    .element.unavailable {
      opacity: 0.35;
    }
    .element.unlinked,
    .element.missing {
      cursor: default;
    }
    .static {
      pointer-events: none;
    }
    .element.linking {
      cursor: pointer;
    }
    .element.linking.unlinked,
    .element.linking.missing {
      opacity: 0.8;
    }
    .halo {
      fill: color-mix(in srgb, var(--primary-color, #2f6fed) 22%, transparent);
      stroke: var(--primary-color, #2f6fed);
      pointer-events: none;
    }
    circle.halo {
      stroke-width: 4;
    }
    /* A line's width is set on the element, in plan units. */
    .halo.line {
      fill: none;
      stroke: color-mix(in srgb, var(--primary-color, #2f6fed) 45%, transparent);
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .link-ring {
      fill: none;
      stroke: #6b7280;
      stroke-dasharray: 7 5;
      pointer-events: none;
    }
    path.link-ring {
      stroke-dasharray: 6 6;
      opacity: 0.55;
    }
    circle.link-ring {
      stroke-width: 3;
    }
    .link-ring.missing {
      stroke: #e5322d;
    }
    .alert-ring {
      fill: none;
      stroke: #e5322d;
      stroke-width: 4;
      pointer-events: none;
      transform-box: fill-box;
      transform-origin: center;
      animation: maxsen-pulse 1.6s ease-out infinite;
    }
    @keyframes maxsen-pulse {
      from {
        transform: scale(0.7);
        opacity: 0.95;
      }
      to {
        transform: scale(1.6);
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .alert-ring {
        animation: none;
      }
    }
    .pill {
      pointer-events: none;
    }
    .pill rect {
      fill: var(--card-background-color, #fff);
      stroke: var(--divider-color, #cfd3d9);
      stroke-width: 1;
      opacity: 0.95;
    }
    .pill text {
      fill: var(--primary-text-color, #1f1d1a);
      font-weight: 600;
    }
    .popup-layer {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .popup-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.35);
    }
    .popup {
      position: relative;
      width: min(360px, calc(100% - 32px));
      max-height: calc(100% - 32px);
      overflow-y: auto;
      padding: 8px 16px 16px;
      border-radius: 16px;
      background: var(--card-background-color, #fff);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    }
    .popup-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 52px;
      font-size: 18px;
      font-weight: 600;
    }
    .popup button {
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    .popup .close {
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 22px;
      background: transparent;
      font-size: 28px;
      line-height: 1;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 56px;
      border-top: 1px solid var(--divider-color, #e3e6ea);
    }
    .row .name {
      flex: 1;
      min-height: 44px;
      padding: 0;
      border: 0;
      background: transparent;
      font-size: 16px;
      text-align: left;
    }
    .row .state {
      color: var(--secondary-text-color, #5b6168);
      font-size: 14px;
      text-transform: capitalize;
    }
    .switch {
      position: relative;
      flex: none;
      width: 52px;
      height: 32px;
      padding: 0;
      border: 0;
      border-radius: 16px;
      background: var(--disabled-color, #c4c8ce);
      transition: background 0.15s;
    }
    .switch.checked {
      background: var(--primary-color, #2f6fed);
    }
    .switch .knob {
      position: absolute;
      top: 4px;
      left: 4px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.15s;
    }
    .switch.checked .knob {
      transform: translateX(20px);
    }
    .notice {
      position: absolute;
      left: 50%;
      bottom: 20px;
      transform: translateX(-50%);
      padding: 10px 18px;
      border-radius: 22px;
      background: #2b2d31;
      color: #fff;
      font-size: 15px;
    }
  `;
}

if (!customElements.get('maxsen-floorplan-view')) {
  customElements.define('maxsen-floorplan-view', MaxsenFloorplanView);
}

declare global {
  interface HTMLElementTagNameMap {
    'maxsen-floorplan-view': MaxsenFloorplanView;
  }
}
