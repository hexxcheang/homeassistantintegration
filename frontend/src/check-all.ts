import { deviceEntities, domainOf, errorMessage } from './hass-util.ts';
import { LIGHTING_CATEGORIES } from './link-candidates.ts';
import type { HassLike, HomeElement, HomeResponse, Link } from './types.ts';
import { orderedElements } from './walk.ts';

/** How long a load stays switched before it goes back. */
export const CHECK_MS = 2000;

/**
 * How often a put-back is looked at while waiting for it to land, and how long (in elapsed time, not
 * polls: a page in the background polls slowly) a switch or a curtain may take. A put-back that Home
 * Assistant refused is not waited for as long as one that was accepted.
 */
const SETTLE_POLL_MS = 100;
const SETTLE_SWITCH_MS = 3000;
const SETTLE_COVER_MS = 60_000;
const SETTLE_REFUSED_MS = 3000;
/** A curtain that is not travelling and has not changed position for this long has stopped, wherever it is. */
const COVER_STILL_MS = 1500;
/** A curtain counts as back at its position within this many percent. */
const POSITION_TOLERANCE = 2;

/** Home Assistant's `CoverEntityFeature` bits. */
const COVER_SET_POSITION = 4;
const COVER_STOP = 8;

/** The entity domains a category is checked through; every other category (climate, locks, cameras, sensors...) is skipped. */
const SWITCHING = new Set(['switch', 'light']);
const COVERS = new Set(['cover']);
const SWITCH_CATEGORIES = new Set(['smart-switches', 'control-panels']);

/** One thing to switch and watch: the entities that move together, and the elements Wrong unlinks. */
export interface CheckStep {
  /** What the installer is watching for: the lights' names, or "switch name · gang 2 of 3". */
  label: string;
  levelName: string;
  /** Switched together, and put back together. Today always one gang entity or one cover. */
  entityIds: string[];
  /** The planner elements that are linked to them, which Wrong unlinks and puts back in the walk. */
  elementIds: string[];
  /** What to light up on the drawing: `elementIds`, plus the switch whose gang this is. */
  highlightIds: string[];
}

export type CheckOutcome =
  | { status: 'done'; restored: boolean }
  /** The entities were not switched: Home Assistant says they are unavailable (or does not have them). */
  | { status: 'unavailable'; entityIds: string[] }
  | { status: 'failed'; message: string; restored: boolean }
  /** `abort()` ended the step early; the load was put back. */
  | { status: 'cancelled'; restored: boolean }
  /** Another step is running: only one at a time. */
  | { status: 'busy' };

/** What an entity was before the step, so it can be put back. */
interface Memo {
  id: string;
  domain: string;
  state: string;
  attributes: Record<string, unknown>;
}

interface Active {
  cancelled: boolean;
  /** Do not wait for the put-back to land (the installer has left). */
  skipSettle: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  wake: (() => void) | undefined;
  done: Promise<unknown>;
}

/** A gang being collected: the lights and the switch elements that are linked to it. */
interface Draft {
  entityId: string;
  lights: HomeElement[];
  others: HomeElement[];
  levelName: string;
  /** Where this gang is among the switching entities of the device it came from. */
  gang: { index: number; count: number } | undefined;
}

const nameOf = (el: HomeElement): string => el.label || el.productName;

/**
 * What Check all switches for an element: a curtain's cover, a switch's gangs, a light's gang.
 * `undefined` for every other category (aircon, locks, cameras, sensors...), which are skipped.
 */
function checkedBy(el: HomeElement): { lights: boolean; domains: ReadonlySet<string> } | undefined {
  if (el.categoryId === 'curtains-blinds') return { lights: false, domains: COVERS };
  if (SWITCH_CATEGORIES.has(el.categoryId)) return { lights: false, domains: SWITCHING };
  if (LIGHTING_CATEGORIES.has(el.categoryId)) return { lights: true, domains: SWITCHING };
  return undefined;
}

/**
 * Check all: goes through what is linked to a switch, a light or a curtain, one entity at a time,
 * switching it to the opposite state for 2 s and then back, while the installer watches.
 *
 * It never leaves a load switched: `run` always puts the state back, and `abort` ends a step that
 * is running at once and puts the state back (call it when the installer leaves).
 */
export class CheckAll {
  private active: Active | undefined;
  /** What each step's entities were the first time it ran, which every run of that step goes back to. */
  private memos = new Map<string, Memo[]>();

  constructor(
    /** Replaced whenever Home Assistant sends a new state: a step reads the live states when it runs. */
    public hass: HassLike,
    public home: HomeResponse,
  ) {}

  /**
   * The steps, in walk order. One per distinct gang entity that lights are linked to; one per
   * primary switch or light entity (a gang) of each linked switch device; one per linked curtain.
   * A gang that is both gets one step, whose Wrong unlinks the lights (what the installer sees).
   */
  steps(): CheckStep[] {
    const { hass, home } = this;
    const drafts = new Map<string, Draft>();
    for (const { el, levelName } of orderedElements(home, (e) => Boolean(home.links[e.id]))) {
      const checked = checkedBy(el);
      const link = home.links[el.id];
      if (!checked || !link) continue;
      const ids = this.entitiesOf(link, checked.domains);
      ids.forEach((entityId, index) => {
        let draft = drafts.get(entityId);
        if (!draft) {
          draft = { entityId, lights: [], others: [], levelName, gang: undefined };
          drafts.set(entityId, draft);
        }
        (checked.lights ? draft.lights : draft.others).push(el);
        if (!checked.lights && ids.length > 1) draft.gang = { index: index + 1, count: ids.length };
      });
    }
    return [...drafts.values()].map((d) => this.stepOf(d));
  }

  private entitiesOf(link: Link, domains: ReadonlySet<string>): string[] {
    if (link.type === 'entity') return domains.has(domainOf(link.id)) ? [link.id] : [];
    return deviceEntities(this.hass, link.id)
      .map((e) => e.entity_id)
      .filter((id) => domains.has(domainOf(id)))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }

  private stepOf(d: Draft): CheckStep {
    const watched = d.lights.length > 0 ? d.lights : d.others;
    const names = watched.map(nameOf);
    const gang = d.gang ? `gang ${d.gang.index} of ${d.gang.count}` : '';
    let label: string;
    if (d.lights.length === 0) {
      label = `${names[0]}${gang ? ` · ${gang}` : ''}`;
    } else {
      label = names.length === 1 ? names[0]! : `${names[0]} and ${names.length - 1} more`;
      // The gang also belongs to a linked switch: say which, so the installer can look at it.
      const via = d.others[0];
      if (via) label += ` · via ${nameOf(via)}${gang ? `, ${gang}` : ''}`;
    }
    return {
      label,
      levelName: d.levelName,
      entityIds: [d.entityId],
      elementIds: watched.map((e) => e.id),
      highlightIds: [...watched, ...(d.lights.length > 0 ? d.others : [])].map((e) => e.id),
    };
  }

  /** The entities of a step that Home Assistant cannot switch right now: unavailable, unknown or gone. */
  unavailable(step: CheckStep): string[] {
    return step.entityIds.filter((id) => {
      const state = this.hass.states[id]?.state;
      return state === undefined || state === 'unavailable' || state === 'unknown';
    });
  }

  /**
   * Switch the step's entities to the opposite state, wait 2 s, and put them back to the state
   * they had when this started (read live, not when the steps were listed). A curtain is opened or
   * closed, stopped, and returned to its position. Unavailable entities are not touched.
   */
  run(step: CheckStep): Promise<CheckOutcome> {
    if (this.active) return Promise.resolve({ status: 'busy' });
    const missing = this.unavailable(step);
    if (missing.length > 0) return Promise.resolve({ status: 'unavailable', entityIds: missing });
    const key = step.entityIds.join(',');
    let memos = this.memos.get(key);
    if (!memos) {
      memos = step.entityIds.map((id) => this.remember(id));
      this.memos.set(key, memos);
    }
    const active: Active = { cancelled: false, skipSettle: false, timer: undefined, wake: undefined, done: Promise.resolve() };
    this.active = active;
    active.done = this.execute(memos, active).finally(() => {
      if (this.active === active) this.active = undefined;
    });
    return active.done as Promise<CheckOutcome>;
  }

  /**
   * Ends the step that is running, if any, at once; resolves when its loads are back and have
   * reported it (so nothing that listens for presses hears the put-back). With `settle` false it
   * does not wait for that: for an installer who has gone.
   */
  async abort(settle = true): Promise<void> {
    const active = this.active;
    if (!active) return;
    active.cancelled = true;
    if (!settle) active.skipSettle = true;
    clearTimeout(active.timer);
    active.wake?.();
    await active.done;
  }

  private remember(id: string): Memo {
    const state = this.hass.states[id];
    return { id, domain: domainOf(id), state: state?.state ?? '', attributes: state?.attributes ?? {} };
  }

  private async execute(memos: Memo[], active: Active): Promise<CheckOutcome> {
    let failure: string | undefined;
    const switched = await Promise.allSettled(memos.map((m) => this.switchAway(m)));
    for (const result of switched) {
      if (result.status === 'rejected') failure ??= errorMessage(result.reason, 'Home Assistant refused.');
    }
    if (failure === undefined) await this.wait(active);
    // Always put back: a call that failed may still have moved the load.
    const cutShort = active.cancelled; // aborted before the put-back: the step did not run in full
    const putBack = await Promise.allSettled(memos.map((m) => this.putBack(m)));
    const restored = putBack.every((r) => r.status === 'fulfilled');
    // The put-back has been asked for; Zigbee reports it a moment later, and a curtain keeps
    // travelling. Until it has, a listener would take those reports for presses.
    await Promise.all(memos.map((m, i) => this.settled(m, active, putBack[i]!.status === 'rejected')));
    if (failure !== undefined) return { status: 'failed', message: failure, restored };
    // An abort that only came while the put-back was settling does not make a step that ran in full "cancelled".
    return cutShort ? { status: 'cancelled', restored } : { status: 'done', restored };
  }

  private wait(active: Active): Promise<void> {
    if (active.cancelled) return Promise.resolve();
    return new Promise((resolve) => {
      active.wake = resolve;
      active.timer = setTimeout(resolve, CHECK_MS);
    });
  }

  /**
   * Waits until `m` is back where it was, or the cap runs out (quietly). A curtain also counts as
   * settled once it is not opening or closing and its position has not changed for a while: some
   * stop short of where they were, and waiting a minute for that would keep Check all stuck.
   */
  private async settled(m: Memo, active: Active, refused: boolean): Promise<void> {
    const cap = refused ? SETTLE_REFUSED_MS : m.domain === 'cover' ? SETTLE_COVER_MS : SETTLE_SWITCH_MS;
    const started = Date.now();
    let lastPosition: unknown;
    let still = started;
    while (!active.skipSettle && !this.isBack(m)) {
      const now = Date.now();
      if (now - started >= cap) return;
      if (m.domain === 'cover') {
        const cover = this.hass.states[m.id];
        const position = cover?.attributes['current_position'];
        const travelling = cover?.state === 'opening' || cover?.state === 'closing';
        if (travelling || position !== lastPosition) {
          lastPosition = position;
          still = now;
        } else if (now - still >= COVER_STILL_MS) {
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    }
  }

  private isBack(m: Memo): boolean {
    const now = this.hass.states[m.id];
    if (!now) return true; // gone: nothing to wait for
    if (m.domain !== 'cover') return now.state === m.state;
    if (now.state === 'opening' || now.state === 'closing') return false;
    const closed = m.state === 'closed' || m.state === 'closing';
    if (now.state !== (closed ? 'closed' : 'open')) return false;
    const target = m.attributes['current_position'];
    const at = now.attributes['current_position'];
    if (typeof target === 'number' && typeof at === 'number' && this.supports(m, COVER_SET_POSITION, true)) {
      return Math.abs(at - target) <= POSITION_TOLERANCE;
    }
    return true;
  }

  private async switchAway(m: Memo): Promise<void> {
    const data = { entity_id: m.id };
    if (m.domain === 'cover') {
      await this.hass.callService('cover', m.state === 'closed' ? 'open_cover' : 'close_cover', data);
    } else {
      await this.hass.callService(m.domain, m.state === 'on' ? 'turn_off' : 'turn_on', data);
    }
  }

  private async putBack(m: Memo): Promise<void> {
    const data = { entity_id: m.id };
    if (m.domain !== 'cover') {
      await this.hass.callService(m.domain, m.state === 'on' ? 'turn_on' : 'turn_off', data);
      return;
    }
    // A curtain is still travelling: stop it where it is, then return it. A failed stop does not
    // stop the return, but is reported.
    let stopFailed: unknown;
    if (this.supports(m, COVER_STOP, true)) {
      try {
        await this.hass.callService('cover', 'stop_cover', data);
      } catch (err) {
        stopFailed = err;
      }
    }
    const position = m.attributes['current_position'];
    const closed = m.state === 'closed' || m.state === 'closing';
    if (this.supports(m, COVER_SET_POSITION, typeof position === 'number')) {
      const target = typeof position === 'number' ? position : closed ? 0 : 100;
      await this.hass.callService('cover', 'set_cover_position', { ...data, position: target });
    } else {
      // No positions: drive it back to the end it was at.
      await this.hass.callService('cover', closed ? 'close_cover' : 'open_cover', data);
    }
    if (stopFailed !== undefined) throw stopFailed;
  }

  /** Whether a cover supports a feature; `fallback` when its attributes do not say. */
  private supports(m: Memo, feature: number, fallback: boolean): boolean {
    const features = m.attributes['supported_features'];
    return typeof features === 'number' ? (features & feature) !== 0 : fallback;
  }
}
