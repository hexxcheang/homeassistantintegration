import type { MaxsenFloorplanView } from '../src/floorplan-view.ts';
import type { HomeResponse, HomePackage, Link, StoredHomePackage } from '../src/types.ts';
import { home } from './helpers.ts';

/** The fixture as the integration serves it: no image data, image urls added. */
export function homeResponse(
  overrides: { links?: Record<string, Link>; package?: StoredHomePackage | null } = {},
): HomeResponse {
  const { images, ...rest } = home as HomePackage;
  const pkg: StoredHomePackage = {
    ...rest,
    image_types: Object.fromEntries(Object.entries(images).map(([id, i]) => [id, i.mediaType])),
  };
  return {
    package: overrides.package === undefined ? pkg : overrides.package,
    links: overrides.links ?? {},
    quick_panel: [],
    installer_mode: false,
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
