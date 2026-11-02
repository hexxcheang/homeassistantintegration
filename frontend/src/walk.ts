import { LIGHTING_CATEGORIES } from './link-candidates.ts';
import type { CategoryId, HomeElement, HomeResponse, Link, Pt, SceneItem } from './types.ts';

/** What the identify watcher listens for; mirrors `KINDS` in custom_components/maxsen/identify.py. */
export type IdentifyKind = 'switch' | 'cover' | 'binary_sensor' | 'light_gang';

/** One thing for the installer to do: press, wave or pick, for one element. */
export type WalkStep =
  | {
      kind: 'device';
      elementId: string;
      prompt: string;
      mode: 'device';
      kinds: IdentifyKind[];
      /** Gang count stated in the product or variant name of a switch; null when neither states one. */
      gangs: number | null;
    }
  | { kind: 'lights'; elementId: string; prompt: string; mode: 'entity'; kinds: ['light_gang'] }
  | { kind: 'pick'; elementId: string; prompt: string };

/** Same pattern as `_GANG_PATTERN` in identify.py ("3 Gang", "3-gang", "3G"). */
const GANG_PATTERN = /(\d+)\s*-?\s*g(?:ang)?\b/i;

const PICK_PROMPT = 'Pick it from the list';

/** The count the product name states, else the variant name ("Ark Series" + "3-gang, White"). */
function gangCount(productName: string, variantName: string): number | null {
  const match = GANG_PATTERN.exec(productName) ?? GANG_PATTERN.exec(variantName);
  return match ? Number(match[1]) : null;
}

function labelOf(el: HomeElement): string {
  return el.label || el.productName;
}

/** What to ask the installer to do for this element, linked or not. */
export function stepFor(el: HomeElement): WalkStep {
  const id = el.id;
  const category: CategoryId = el.categoryId;
  if (LIGHTING_CATEGORIES.has(category)) {
    return {
      kind: 'lights',
      elementId: id,
      prompt: 'Turn its gangs off, then press the gang that turns this on',
      mode: 'entity',
      kinds: ['light_gang'],
    };
  }
  switch (category) {
    case 'smart-switches':
    case 'control-panels':
      return {
        kind: 'device',
        elementId: id,
        prompt: `Press any button on the switch at ${labelOf(el)}`,
        mode: 'device',
        kinds: ['switch'],
        gangs: gangCount(el.productName, el.variantName),
      };
    case 'curtains-blinds':
      return {
        kind: 'device',
        elementId: id,
        prompt: 'Press open or close on the curtain switch',
        mode: 'device',
        kinds: ['cover'],
        gangs: null,
      };
    case 'sensors':
      return {
        kind: 'device',
        elementId: id,
        prompt: "Wave at the sensor, or open the door it's on",
        mode: 'device',
        kinds: ['binary_sensor'],
        gangs: null,
      };
    default:
      return { kind: 'pick', elementId: id, prompt: PICK_PROMPT };
  }
}

/** Where an item sits: a marker's position, a path's midpoint (centre of its bounding box). */
function positionOf(item: SceneItem): Pt | undefined {
  if (item.type === 'marker') return { x: item.x, y: item.y };
  if (item.type === 'path' && item.points.length > 0) {
    const xs = item.points.map((p) => p.x);
    const ys = item.points.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }
  return undefined;
}

/**
 * The elements of the home for which `include` holds, in walk order: levels by `sortOrder`; within a
 * level the non-lighting elements before the lighting ones; within each group top to bottom, then
 * left to right. Elements without a position go last in their group, in package order.
 */
export function orderedElements(
  home: HomeResponse,
  include: (el: HomeElement) => boolean,
): { el: HomeElement; levelName: string }[] {
  const pkg = home.package;
  if (!pkg) return [];
  const found: { el: HomeElement; levelName: string }[] = [];
  const levels = [...pkg.levels].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const level of levels) {
    const positions = new Map<string, Pt>();
    const elements: HomeElement[] = [];
    for (const plan of level.plans) {
      for (const item of plan.scene.items) {
        const at = positionOf(item);
        if (at && !positions.has(item.elementId)) positions.set(item.elementId, at);
      }
      for (const el of plan.elements) if (include(el)) elements.push(el);
    }
    for (const lighting of [false, true]) {
      const group = elements.filter((el) => LIGHTING_CATEGORIES.has(el.categoryId) === lighting);
      const drawn = group.filter((el) => positions.has(el.id));
      const undrawn = group.filter((el) => !positions.has(el.id));
      drawn.sort((a, b) => {
        const pa = positions.get(a.id)!;
        const pb = positions.get(b.id)!;
        return pa.y - pb.y || pa.x - pb.x;
      });
      for (const el of [...drawn, ...undrawn]) found.push({ el, levelName: level.name });
    }
  }
  return found;
}

/** The steps for every unlinked element, in walk order (see `orderedElements`). */
export function buildQueue(home: HomeResponse): WalkStep[] {
  return orderedElements(home, (el) => !home.links[el.id]).map(({ el }) => stepFor(el));
}

interface HistoryEntry {
  elementIds: string[];
  link: Link;
  /** The steps that were in the queue and left it, in queue order. */
  steps: WalkStep[];
}

/**
 * The linking walk: a queue of unlinked elements, one current step, skip/back/undo/jump, and a
 * refresh that rebuilds it from what is still unlinked. Pure state; no UI, no network.
 */
export class Walk {
  /** Walk order; skipped steps are moved to the end. */
  private queue: WalkStep[];
  private cursor = 0;
  private history: HistoryEntry[] = [];
  private skipped = new Set<string>();
  private _total: number;

  constructor(home: HomeResponse) {
    this.queue = buildQueue(home);
    this._total = this.queue.length;
  }

  get current(): WalkStep | undefined {
    return this.queue[this.cursor];
  }

  get done(): number {
    return this._total - this.queue.length;
  }

  get total(): number {
    return this._total;
  }

  /** Records a link made for these elements and takes them out of the queue. */
  linked(elementIds: string[], link: Link): void {
    const gone = new Set(elementIds);
    const steps = this.queue.filter((s) => gone.has(s.elementId));
    this.history.push({ elementIds: [...elementIds], link, steps });
    this.removeAndAdvance(gone);
  }

  /** Moves the current step to the end of the walk and shows the next one. */
  skip(): void {
    const step = this.queue[this.cursor];
    if (!step) return;
    this.queue.splice(this.cursor, 1);
    this.queue.push(step);
    this.skipped.add(step.elementId);
    // Past the end, or the step was already last: go round to the first.
    if (this.cursor >= this.queue.length - 1) this.cursor = 0;
  }

  /** Goes to the step before the current one in the walk order. Nothing is unlinked. */
  back(): void {
    if (this.cursor > 0) this.cursor -= 1;
  }

  /** Takes back the last link: its elements return to the front of the queue, the first current. */
  undo(): { elementIds: string[]; link: Link } | undefined {
    const entry = this.history.pop();
    if (!entry) return undefined;
    const back = entry.steps.filter((s) => !this.queue.some((q) => q.elementId === s.elementId));
    for (const s of back) this.skipped.delete(s.elementId);
    this.queue.unshift(...back);
    this.cursor = 0;
    return { elementIds: entry.elementIds, link: entry.link };
  }

  /** Makes this element the current step, if it is still in the queue. */
  jump(elementId: string): void {
    const at = this.queue.findIndex((s) => s.elementId === elementId);
    if (at >= 0) this.cursor = at;
  }

  /**
   * Rebuilds from what is still unlinked in `home`: remaining steps keep their order, new ones go
   * before the skipped tail, and the current step stays if it is still unlinked, else the next
   * remaining one (or the first) becomes current. The undo history is kept.
   */
  refresh(home: HomeResponse): void {
    const fresh = new Map(buildQueue(home).map((s) => [s.elementId, s]));
    const old = this.queue;
    const kept = old.filter((s) => fresh.has(s.elementId));
    const known = new Set(old.map((s) => s.elementId));
    const added = [...fresh.values()].filter((s) => !known.has(s.elementId));
    const isSkipped = (s: WalkStep) => this.skipped.has(s.elementId);
    const ordered = [
      ...kept.filter((s) => !isSkipped(s)),
      ...added,
      ...kept.filter(isSkipped),
    ].map((s) => fresh.get(s.elementId)!);

    // The first old step from the current one on that is still there.
    let next: string | undefined;
    for (let i = this.cursor; i < old.length; i++) {
      const id = old[i]!.elementId;
      if (fresh.has(id)) {
        next = id;
        break;
      }
    }
    this.queue = ordered;
    const at = next === undefined ? -1 : ordered.findIndex((s) => s.elementId === next);
    this.cursor = at >= 0 ? at : 0;
    this._total = Math.max(this._total, ordered.length);
    for (const id of [...this.skipped]) if (!fresh.has(id)) this.skipped.delete(id);
  }

  private removeAndAdvance(gone: ReadonlySet<string>): void {
    // The next step is the first one at or after the cursor that stays.
    let before = 0;
    for (let i = 0; i < this.cursor; i++) if (!gone.has(this.queue[i]!.elementId)) before++;
    this.queue = this.queue.filter((s) => !gone.has(s.elementId));
    for (const id of gone) this.skipped.delete(id);
    // `before` is the index of the current step if it stayed, else of the next one that did.
    this.cursor = before;
    if (this.cursor >= this.queue.length) this.cursor = 0;
  }
}
