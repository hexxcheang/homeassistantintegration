import type { MaxsenFloorplanView } from '../src/floorplan-view.ts';
import type { HomeResponse, HomePackage, Link, QuickItem, StoredHomePackage } from '../src/types.ts';
import { home } from './helpers.ts';

/** The fixture as the integration serves it: no image data, image urls added. */
export function homeResponse(
  overrides: {
    links?: Record<string, Link>;
    package?: StoredHomePackage | null;
    quick_panel?: QuickItem[];
    display?: HomeResponse['display'];
    installer_mode?: boolean;
    source?: 'planner' | 'file';
  } = {},
): HomeResponse {
  const { images, ...rest } = home as HomePackage;
  const pkg: StoredHomePackage = {
    ...rest,
    image_types: Object.fromEntries(Object.entries(images).map(([id, i]) => [id, i.mediaType])),
  };
  return {
    package: overrides.package === undefined ? pkg : overrides.package,
    links: overrides.links ?? {},
    quick_panel: overrides.quick_panel ?? [],
    display: overrides.display ?? { background: 'soft' },
    installer_mode: overrides.installer_mode ?? false,
    source: overrides.source ?? 'planner',
    image_urls: Object.fromEntries(Object.keys(images).map((id) => [id, `/api/maxsen/image/e1/${id}`])),
  };
}

export async function settle(el: { updateComplete: Promise<unknown> }): Promise<void> {
  // An update can start another (images arriving), so wait until it stops.
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
}

export async function mountView(props: Partial<MaxsenFloorplanView>): Promise<MaxsenFloorplanView> {
  const el = document.createElement('maxsen-floorplan-view') as MaxsenFloorplanView;
  Object.assign(el, props);
  document.body.append(el);
  await settle(el);
  return el;
}

export const root = (el: HTMLElement): ShadowRoot => el.shadowRoot as ShadowRoot;

export function group(el: HTMLElement, elementId: string): SVGGElement {
  const g = root(el).querySelector<SVGGElement>(`g[data-element-id="${elementId}"]`);
  if (!g) throw new Error(`No group for ${elementId}`);
  return g;
}

export function pointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { id?: number; x?: number; y?: number } = {},
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: init.id ?? 1,
      clientX: init.x ?? 100,
      clientY: init.y ?? 100,
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}

/** A quick press and release on an element. */
export function tap(target: Element, x = 100, y = 100): void {
  pointer(target, 'pointerdown', { x, y });
  pointer(target, 'pointerup', { x, y });
}

/** happy-dom's WheelEvent drops the pointer position, so it is added by hand. */
export function wheel(target: Element, deltaY: number, x = 400, y = 300): void {
  const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
  Object.defineProperties(e, { clientX: { value: x }, clientY: { value: y } });
  target.dispatchEvent(e);
}

/** The stage is 800 x 600 CSS px in tests (happy-dom has no layout, so the view's fallback applies). */
export const STAGE = { w: 800, h: 600 };

/** Where a point of the drawing (plan units) is on screen, in stage px, at the current zoom/pan. */
export function planPoint(view: MaxsenFloorplanView, x: number, y: number): { x: number; y: number } {
  const [bx, by, bw, bh] = (root(view).querySelector('svg')?.getAttribute('viewBox') ?? '')
    .split(' ')
    .map(Number) as [number, number, number, number];
  const fit = Math.min(STAGE.w / bw, STAGE.h / bh);
  const base = { x: (STAGE.w - bw * fit) / 2 + (x - bx) * fit, y: (STAGE.h - bh * fit) / 2 + (y - by) * fit };
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(
    root(view).querySelector<HTMLElement>('.canvas')?.style.transform ?? '',
  );
  const [tx, ty, s] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 1];
  return { x: base.x * s + tx, y: base.y * s + ty };
}

/**
 * Where an item is on screen, in stage px: the centre of a marker, the anchor of a note, the middle
 * of the first segment of a line. Reads the drawing's view box and the canvas zoom, so it holds at any zoom/pan.
 */
export function elementPoint(view: MaxsenFloorplanView, elementId: string): { x: number; y: number } {
  const item = view.home?.package?.levels
    .flatMap((l) => l.plans.flatMap((p) => p.scene.items))
    .find((i) => i.elementId === elementId);
  if (!item) throw new Error(`No item ${elementId}`);
  const [x, y] =
    item.type !== 'path'
      ? [item.x, item.y]
      : [((item.points[0]?.x ?? 0) + (item.points[1]?.x ?? 0)) / 2, ((item.points[0]?.y ?? 0) + (item.points[1]?.y ?? 0)) / 2];
  return planPoint(view, x, y);
}

export const stageOf = (view: HTMLElement): HTMLElement => root(view).querySelector<HTMLElement>('.stage')!;

/** A quick press and release on the stage, `dx`/`dy` px from the element's centre. */
export function tapElement(view: MaxsenFloorplanView, elementId: string, dx = 0, dy = 0): void {
  const p = elementPoint(view, elementId);
  tap(stageOf(view), p.x + dx, p.y + dy);
}

/** Press on the stage at an element; release with `releaseElement`. */
export function pressElement(view: MaxsenFloorplanView, elementId: string): void {
  const p = elementPoint(view, elementId);
  pointer(stageOf(view), 'pointerdown', p);
}

export function releaseElement(view: MaxsenFloorplanView, elementId: string): void {
  const p = elementPoint(view, elementId);
  pointer(stageOf(view), 'pointerup', p);
}
