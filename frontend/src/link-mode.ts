import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import {
  createStarterScenes,
  identify,
  type IdentifyOptions,
  type IdentifyResult,
  refreshApply,
  refreshPreview,
  setDisplay,
  setLinks,
  uploadHomeFile,
} from './api.ts';
import { CheckAll, type CheckStep } from './check-all.ts';
import { errorMessage, linkName, release } from './hass-util.ts';
import { LIGHTING_CATEGORIES, linkCandidates } from './link-candidates.ts';
import type {
  ChangedElement,
  HassConnection,
  HassLike,
  HomeElement,
  HomeResponse,
  Link,
  RefreshSummary,
} from './types.ts';
import { visualState, type VisualStatus } from './visual-state.ts';
import { stepFor, Walk, type WalkStep } from './walk.ts';

const NOTICE_MS = 5000;
const MIXED_KINDS = 'Select lights together, or other devices together, not both.';
/** How long "Linked: …" stays, with its Undo, before the walk moves on. */
const TOAST_MS = 2000;
const AMBIGUOUS = 'Two devices reacted. Press once more.';
const WALK_STOPPED = 'The walk stopped. Open Installer to carry on.';
const IDENTIFY_STOPPED = 'Identifying stopped because installer mode was switched off.';
const OTHER_LIGHTS = 'Tap the other lights that came on';
const NOTHING_TO_CHECK = 'Nothing to check yet. Link a switch, light or curtain first.';

/** The steps that wait for a press (the others are picked from a list). */
type PressStep = Exclude<WalkStep, { kind: 'pick' }>;

/**
 * Where the walk is on its current step: `waiting` for a press (or a pick), `linking` while the
 * press is being saved, `others` for the lights step waiting for the other lights that came on,
 * `linked` while "Linked: …" and its Undo show.
 */
type WalkPhase = 'waiting' | 'linking' | 'others' | 'linked';

/**
 * Where Check all is on its current step: `running` while the load is switched and put back,
 * `asking` for OK or Wrong, `problem` when the step could not be run (Again or Skip), `summary`
 * at the end, `ending` while a step that was running is being put back.
 */
type CheckPhase = 'running' | 'asking' | 'problem' | 'summary' | 'ending';

/** One Check all, from the button to its summary. */
interface Check {
  all: CheckAll;
  steps: CheckStep[];
  index: number;
  phase: CheckPhase;
  /** Steps marked OK, Wrong, and left untested (unavailable, or skipped after a failure). */
  ok: number;
  wrong: number;
  untested: number;
  /** The elements Wrong unlinked, which go back in the walk. */
  wrongElements: string[];
  /** Why the step could not be run (phase `problem`). */
  problem?: string;
  /** Bumped whenever a step is started or the check is stopped, so a late answer can tell. */
  token: number;
}

/** What was linked on this step, for the "Linked: …" toast and its Undo. */
interface Toast {
  link: Link;
  name: string;
  /** The elements linked, the walk's own first. */
  ids: string[];
  /** What each had before (`null`: no link), which Undo puts back. */
  previous: Record<string, Link | null>;
}

/** A lights step after its first press: the gang is linked to the highlighted light; others may join. */
interface Group {
  elementId: string;
  link: Link;
  name: string;
  /** Lights tapped since, linked together on Done. */
  others: string[];
  previous: Record<string, Link | null>;
}

/** What the server pushes when the installer pressed something (not "ambiguous" or "stopped"). */
const isFound = (result: IdentifyResult): result is Extract<IdentifyResult, { name: string }> =>
  typeof (result as { name?: unknown }).name === 'string';

const sameLink = (a: Link | null | undefined, b: Link | null | undefined): boolean =>
  (a ?? null) === (b ?? null) || (a != null && b != null && a.type === b.type && a.id === b.id);

interface Notice {
  text: string;
  error: boolean;
}

interface Dialog {
  phase: 'checking' | 'ready' | 'applying' | 'error';
  /** The home is read from a file the installer chose, not fetched from the planner. */
  fromFile?: boolean;
  summary?: RefreshSummary;
  error?: string;
}

interface Known {
  el: HomeElement;
  levelName: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const nameOf = (el: HomeElement): string => el.label || el.productName;
const isLight = (el: HomeElement): boolean => LIGHTING_CATEGORIES.has(el.categoryId);

/** "2 new devices to link, 1 device removed, 1 drawing updated". */
export function summaryLine(s: RefreshSummary): string {
  return [
    `${plural(s.added.length, 'new device', 'new devices')} to link`,
    `${plural(s.removed.length, 'device', 'devices')} removed`,
    `${plural(s.changed_drawings.length, 'drawing', 'drawings')} updated`,
  ].join(', ');
}

/**
 * The installer's tools: pick elements on the drawing (the panel passes their taps to `tap`),
 * link them to devices or entities, create the starter scenes, and refresh from the planner.
 * Needs an administrator and installer mode; the server checks both.
 */
export class MaxsenLinkMode extends LitElement {
  static override properties = {
    hass: { attribute: false },
    home: { attribute: false },
    entryId: { attribute: false },
    _selected: { state: true },
    _multi: { state: true },
    _search: { state: true },
    _notice: { state: true },
    _busy: { state: true },
    _dialog: { state: true },
    _walk: { state: true },
    _phase: { state: true },
    _toast: { state: true },
    _group: { state: true },
    _ambiguous: { state: true },
    _includeOther: { state: true },
    _armed: { state: true },
    _check: { state: true },
  };

  declare hass: HassLike | undefined;
  declare home: HomeResponse | undefined;
  declare entryId: string | undefined;
  declare private _selected: string[];
  declare private _multi: boolean;
  declare private _search: string;
  declare private _notice: Notice | undefined;
  declare private _busy: boolean;
  declare private _dialog: Dialog | undefined;
  /** The linking walk, when one is on. Mutable: call `requestUpdate()` after changing it. */
  declare private _walk: Walk | undefined;
  declare private _phase: WalkPhase;
  declare private _toast: Toast | undefined;
  declare private _group: Group | undefined;
  /** Two devices reacted; shown until the next press or step. */
  declare private _ambiguous: boolean;
  /** Count devices that are not Zigbee too. */
  declare private _includeOther: boolean;
  /** The press of the one selected marker is being listened for (outside the walk): on for an unlinked marker, off until asked for a linked one. */
  declare private _armed: boolean;
  /** Check all, when it is open. Mutable: call `requestUpdate()` after changing it. */
  declare private _check: Check | undefined;

  private _known = new Map<string, Known>();
  /** Bumped when the dialog is closed, so an answer that arrives later does not reopen it. */
  private _dialogRun = 0;
  private _noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private _toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** Ends the identify subscription in use, if any. */
  private _stopListen: (() => void | Promise<void>) | undefined;
  /** Bumped whenever the subscription in use is replaced or ended, so a late answer can tell. */
  private _listenToken = 0;
  /** What the single-marker press is listening for ('' for nothing), to subscribe only on a change. */
  private _singleKey = '';
  /** The subscription being set up, if any; settles once it is in place (or has failed) and any stale one is released. */
  private _subscribing: Promise<void> = Promise.resolve();
  /** The one marker the press listening is about, to arm it afresh when another is selected. */
  private _singleFor: string | undefined;
  /** Links this element wrote that the home it was given may not show yet; see `_walkHome`. */
  private _expected = new Map<string, Link | null>();
  /** The element id last announced with `maxsen-current`. */
  private _announced: string | undefined;
  /** The connection whose `ready` (reconnected) event this element listens to. */
  private _connection: HassConnection | undefined;

  constructor() {
    super();
    this._selected = [];
    this._multi = false;
    this._search = '';
    this._busy = false;
    this._phase = 'waiting';
    this._ambiguous = false;
    this._includeOther = false;
    this._armed = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._bindConnection();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._bindConnection();
    clearTimeout(this._noticeTimer);
    // Nothing may listen or move on for an element that is gone.
    this._stopListening();
    this._clearToast();
    // A load that is switched goes back now, wherever the installer went.
    const check = this._check;
    this._check = undefined;
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (check) {
      check.token++;
      void check.all.abort(false); // nobody is left to listen: no waiting for the load to report
    }
    this._walk = undefined;
    this._group = undefined;
    this._armed = false;
    this._singleKey = '';
    this._singleFor = undefined;
    this._expected.clear();
  }

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('hass')) {
      this._bindConnection();
      if (this._check && this.hass) this._check.all.hass = this.hass;
    }
    if (!changed.has('home')) return;
    this._known = new Map(
      (this.home?.package?.levels ?? []).flatMap((level) =>
        level.plans.flatMap((p) =>
          p.elements.map((el) => [el.id, { el, levelName: level.name }] as const),
        ),
      ),
    );
    // A refresh can take away what was selected.
    const kept = this._selected.filter((id) => this._known.has(id));
    if (kept.length !== this._selected.length) this._select(kept);
    this._homeChanged();
  }

  override updated(): void {
    const check = this._check;
    const current = check
      ? check.phase === 'summary' || check.phase === 'ending'
        ? undefined
        : check.steps[check.index]?.elementIds[0]
      : this._walk?.current?.elementId;
    if (current === this._announced) return;
    this._announced = current;
    this.dispatchEvent(
      new CustomEvent('maxsen-current', { detail: { elementId: current }, bubbles: true, composed: true }),
    );
  }

  // ---- selection ----

  /** An element was tapped on the drawing (or chosen from the list). */
  tap(elementId: string): void {
    const tapped = this._known.get(elementId)?.el;
    if (!tapped || this._check) return; // Check all highlights what it switches; taps wait
    if (this._walk) {
      this._tapInWalk(tapped);
      return;
    }
    const current = this._selected;
    if (current.includes(elementId)) {
      this._select(current.filter((id) => id !== elementId));
    } else if (!this._multi) {
      this._select([elementId]);
    } else {
      const first = this._known.get(current[0] ?? '')?.el;
      if (first && isLight(first) !== isLight(tapped)) {
        this._say(MIXED_KINDS, false);
        return;
      }
      this._select([...current, elementId]);
    }
  }

  private _select(ids: string[]): void {
    this._selected = ids;
    if (ids.length === 0) this._search = '';
    this.dispatchEvent(
      new CustomEvent('maxsen-selection', { detail: { selected: ids }, bubbles: true, composed: true }),
    );
    this._syncSingle();
  }

  private _toggleMulti(): void {
    this._multi = !this._multi;
    if (!this._multi && this._selected.length > 1) this._select(this._selected.slice(0, 1));
    this._syncSingle(); // never listens in Select several
  }

  private _say(text: string, error: boolean): void {
    this._notice = { text, error };
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => (this._notice = undefined), NOTICE_MS);
  }

  // ---- linking ----

  /**
   * Link the selected elements to `link` (or unlink them). A device link also names the device
   * after its marker and puts it in its level's area, however the link was made (the server leaves
   * a device a person named alone); `name` is what the notice calls the link. A link found by a
   * press, or picked on a walk step, is shown for 2 s as "Linked: …" with Undo, as the walk does.
   * Resolves to whether the link was saved.
   */
  private async _link(link: Link | null, options: { name?: string; undoable?: boolean } = {}): Promise<boolean> {
    const { hass, entryId } = this;
    if (!hass || !entryId || this._busy) return false;
    const targets = link === null ? this._selected.filter((id) => this.home?.links[id]) : this._selected;
    if (targets.length === 0) return false;
    const previous = Object.fromEntries(targets.map((id) => [id, this._walkHome()?.links[id] ?? null]));
    this._busy = true;
    try {
      await setLinks(hass, entryId, Object.fromEntries(targets.map((id) => [id, link])), {
        nameDevice: link?.type === 'device',
      });
      const step = this._walk?.current;
      const picked = step?.kind === 'pick' && targets.includes(step.elementId);
      this._select([]);
      if (link && (picked || options.undoable)) {
        this._showToast({ link, name: options.name ?? link.id, ids: targets, previous });
      } else {
        const many = targets.length > 1;
        const verb = link === null ? 'Unlinked' : 'Linked';
        this._say(
          many ? `${verb} ${targets.length} elements.` : options.name ? `${verb}: ${options.name}` : `${verb}.`,
          false,
        );
      }
      return true;
    } catch (err) {
      this._say(errorMessage(err, 'Could not save the link. Try again.'), true);
      return false;
    } finally {
      this._busy = false;
    }
  }

  // ---- listening for a press ----

  private _bindConnection(): void {
    const connection = this.isConnected ? this.hass?.connection : undefined;
    if (connection === this._connection) return;
    this._connection?.removeEventListener?.('ready', this._onReconnect);
    this._connection = connection;
    connection?.addEventListener?.('ready', this._onReconnect);
  }

  /**
   * The websocket came back: the server forgot the prompt (a subscription made with
   * `resubscribe: false` is not brought back), so ask it again for the step the installer is on.
   */
  private _onReconnect = (): void => {
    // The old subscription died with the socket. Its unsubscribe would name a command id the new
    // socket may use for something else, so it is dropped, not called.
    this._listenToken++;
    this._stopListen = undefined;
    const step = this._walk?.current;
    if (this._walk) {
      if (this._phase === 'waiting' && step && step.kind !== 'pick') this._listenForStep(step);
    } else if (this._singleKey !== '') {
      this._singleKey = '';
      this._syncSingle();
    }
  };

  /** Listen for what the installer presses; any earlier subscription ends first. */
  private _listen(options: IdentifyOptions, onResult: (result: IdentifyResult) => void): void {
    this._stopListening();
    // Nothing listens while Check all switches loads: its toggles are not presses.
    if (this._check) return;
    const { hass, entryId } = this;
    if (!hass || !entryId) return;
    const token = this._listenToken;
    this._subscribing = identify(hass, entryId, options, (result) => {
      if (token === this._listenToken) onResult(result);
    }).then(
      (stop) => {
        // The prompt may be over before the server answered: end the subscription at once.
        if (token === this._listenToken) this._stopListen = stop;
        else release(stop);
      },
      (err: unknown) => {
        if (token !== this._listenToken) return;
        this._say(errorMessage(err, 'Could not listen for a press. Try again.'), true);
        if (!this._walk) {
          // Not listening: say so, and let Listen / Press to relink subscribe again.
          this._armed = false;
          this._singleKey = '';
        }
      },
    );
  }

  private _stopListening(): void {
    this._listenToken++;
    release(this._stopListen);
    this._stopListen = undefined;
  }

  private _identifyOptions(step: PressStep): IdentifyOptions {
    return {
      mode: step.mode,
      kinds: step.kinds,
      gangs: step.kind === 'device' ? step.gangs : null,
      includeOther: this._includeOther,
    };
  }

  private _linkOf(result: { device_id: string } | { entity_id: string }): Link {
    return 'device_id' in result
      ? { type: 'device', id: result.device_id }
      : { type: 'entity', id: result.entity_id };
  }

  /** What a link is called now: after Maxsen names a device, its new name. */
  private _nameOf(link: Link, fallback: string): string {
    return (this.hass && linkName(link, this.hass)) ?? fallback;
  }

  private _toggleIncludeOther(): void {
    this._includeOther = !this._includeOther;
    this._ambiguous = false;
    const step = this._walk?.current;
    if (this._walk) {
      if (this._phase === 'waiting' && step && step.kind !== 'pick') this._listenForStep(step);
    } else {
      this._singleKey = '';
      this._syncSingle();
    }
  }

  // ---- press to identify, outside the walk ----

  /**
   * With exactly one marker selected (not in Select several, not in a walk), listen for the press of
   * its device: at once for an unlinked marker (the Listen switch can turn it off), only after
   * "Press to relink" for a linked one, so a light switched by someone else cannot overwrite a link.
   */
  private _syncSingle(): void {
    if (this._check) return; // Check all does not listen; `_startCheck` and `_endCheck` set this right
    const only = !this._walk && !this._multi && this._selected.length === 1 ? this._selected[0] : undefined;
    if (only !== this._singleFor) {
      this._singleFor = only;
      this._armed = only !== undefined && !this.home?.links[only];
    }
    let step: PressStep | undefined;
    if (only !== undefined && this._armed) {
      const el = this._known.get(only)?.el;
      const found = el && stepFor(el);
      if (found && found.kind !== 'pick') step = found;
    }
    const key = step ? `${step.elementId}|${this._includeOther}` : '';
    if (key === this._singleKey) return;
    this._singleKey = key;
    this._ambiguous = false;
    if (!step) {
      this._stopListening();
      return;
    }
    this._listen(this._identifyOptions(step), (result) => void this._onSinglePress(step, result));
  }

  private _setArmed(armed: boolean): void {
    this._armed = armed;
    this._syncSingle();
  }

  private async _onSinglePress(step: PressStep, result: IdentifyResult): Promise<void> {
    if ('stopped' in result) {
      this._stopListening();
      this._armed = false;
      this._singleKey = ''; // so turning Listen on again subscribes afresh
      this._say(IDENTIFY_STOPPED, true);
      return;
    }
    if ('ambiguous' in result) {
      this._ambiguous = true;
      return;
    }
    if (!isFound(result)) return;
    this._stopListening();
    this._ambiguous = false;
    const link = this._linkOf(result);
    // The installer may have selected something else while the press was on its way.
    if (this._selected.length !== 1 || this._selected[0] !== step.elementId) return;
    const saved = await this._link(link, { name: this._nameOf(link, result.name), undoable: true });
    if (!saved) {
      // Still selected: listen again.
      this._singleKey = '';
      this._syncSingle();
    }
  }

  // ---- the linking walk ----

  /** Start a walk over everything still unlinked, at `first` when it is one of them (after Check all). */
  private _startWalk(first?: string): void {
    const home = this._walkHome();
    if (!home || this._walk) return;
    const walk = new Walk(home);
    if (!walk.current) {
      this._say('Every element is linked.', false);
      return;
    }
    if (first) walk.jump(first);
    this._walk = walk;
    if (!first) this._expected.clear(); // after Check all they stay until the home shows what it unlinked
    this._select([]); // ends a single press that was on
    this._beginStep();
  }

  /** The step the walk is on: say what to do, listen for it (or show the list). */
  private _beginStep(): void {
    const walk = this._walk;
    const step = walk?.current;
    this._clearToast();
    this._group = undefined;
    this._ambiguous = false;
    this._phase = 'waiting';
    this.requestUpdate();
    if (!walk || !step) {
      this._endWalk('Every element is linked.', false);
      return;
    }
    if (step.kind === 'pick') {
      this._stopListening();
      this._select([step.elementId]);
      return;
    }
    this._select([]);
    this._listenForStep(step);
  }

  private _listenForStep(step: PressStep): void {
    this._ambiguous = false;
    this._listen(this._identifyOptions(step), (result) => void this._onWalkPress(step, result));
  }

  private _endWalk(message?: string, error = false): void {
    this._stopListening();
    this._clearToast();
    this._walk = undefined;
    this._group = undefined;
    this._phase = 'waiting';
    this._ambiguous = false;
    this._expected.clear();
    this._select([]);
    if (message) this._say(message, error);
  }

  private _clearToast(): void {
    clearTimeout(this._toastTimer);
    this._toastTimer = undefined;
    this._toast = undefined;
  }

  private async _onWalkPress(step: PressStep, result: IdentifyResult): Promise<void> {
    const walk = this._walk;
    if ('stopped' in result) {
      this._endWalk(WALK_STOPPED, true);
      return;
    }
    if ('ambiguous' in result) {
      this._ambiguous = true;
      return;
    }
    const { hass, entryId } = this;
    if (!isFound(result) || !walk || !hass || !entryId) return;
    this._stopListening(); // a prompt is one press
    this._ambiguous = false;
    const link = this._linkOf(result);
    const el = step.elementId;
    const previous = { [el]: this._walkHome()?.links[el] ?? null };
    this._phase = 'linking';
    try {
      await setLinks(hass, entryId, { [el]: link }, { nameDevice: step.kind === 'device' });
    } catch (err) {
      if (this._walk !== walk) return;
      this._say(errorMessage(err, 'Could not save the link. Try again.'), true);
      this._phase = 'waiting';
      this._listenForStep(step);
      return;
    }
    if (this._walk !== walk) return; // stopped meanwhile; the link stays
    if (step.kind === 'device') {
      this._showToast({ link, name: result.name, ids: [el], previous });
    } else {
      this._group = { elementId: el, link, name: result.name, others: [], previous };
      this._phase = 'others';
    }
  }

  private _showToast(toast: Toast): void {
    this._toast = toast;
    if (this._walk) this._phase = 'linked';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this._toastOver(), TOAST_MS);
  }

  /** The 2 seconds are up: the walk moves on; outside the walk the toast just goes. */
  private _toastOver(): void {
    if (this._walk) this._advance();
    else this._clearToast();
  }

  /** The toast is over: what was linked leaves the walk, and the next element is asked about. */
  private _advance(): void {
    const toast = this._toast;
    if (!toast || !this._walk) return;
    this._afterLinked(toast.ids, toast.link);
  }

  /** These elements are linked to `link` and done with: take them out of the walk and go on. */
  private _afterLinked(ids: string[], link: Link): void {
    const walk = this._walk;
    if (!walk) return;
    walk.linked(ids, link);
    for (const id of ids) this._expected.set(id, link);
    const home = this._walkHome();
    if (home) walk.refresh(home);
    this._beginStep();
  }

  /** Done on the lights step: the lights tapped since join the gang in one save. */
  private async _doneGroup(): Promise<void> {
    const { hass, entryId } = this;
    const group = this._group;
    const walk = this._walk;
    if (!hass || !entryId || !group || !walk || this._busy) return;
    const previous = { ...group.previous };
    if (group.others.length > 0) {
      for (const id of group.others) previous[id] = this._walkHome()?.links[id] ?? null;
      this._busy = true;
      try {
        await setLinks(hass, entryId, Object.fromEntries(group.others.map((id) => [id, group.link])));
      } catch (err) {
        this._say(errorMessage(err, 'Could not save the links. Try again.'), true);
        return;
      } finally {
        this._busy = false;
      }
      if (this._walk !== walk) return;
    }
    this._group = undefined;
    this._select([]);
    this._showToast({
      link: group.link,
      name: group.name,
      ids: [group.elementId, ...group.others],
      previous,
    });
  }

  /** Undo: put back what the last step linked (a toast's, or a lights step before Done) and ask again. */
  private async _undo(): Promise<void> {
    const { hass, entryId } = this;
    const walk = this._walk;
    const done = this._toast ?? this._group;
    if (!hass || !entryId || !done || this._busy) return;
    const toast = this._toast;
    clearTimeout(this._toastTimer);
    this._busy = true;
    try {
      await setLinks(hass, entryId, done.previous);
    } catch (err) {
      this._say(errorMessage(err, 'Could not undo the link. Try again.'), true);
      // Still linked: carry on as if it had been left.
      if (this._walk === walk && toast) this._toastOver();
      return;
    } finally {
      this._busy = false;
    }
    if (this._walk !== walk) return;
    if (!walk) {
      this._clearToast();
      return;
    }
    for (const [id, link] of Object.entries(done.previous)) this._expected.set(id, link);
    this._beginStep();
  }

  private _skip(): void {
    const walk = this._walk;
    if (!walk || this._phase !== 'waiting') return;
    walk.skip();
    this._beginStep();
  }

  private _back(): void {
    const walk = this._walk;
    if (!walk || this._phase !== 'waiting') return;
    walk.back();
    this._beginStep();
  }

  private _tapInWalk(el: HomeElement): void {
    const walk = this._walk;
    if (!walk) return;
    const group = this._group;
    if (this._phase === 'others' && group) {
      // Lights that came on join the gang; one that already has a gang is moved to this one.
      if (!isLight(el) || el.id === group.elementId) return;
      const others = group.others.includes(el.id)
        ? group.others.filter((id) => id !== el.id)
        : [...group.others, el.id];
      this._group = { ...group, others };
      this._select(others);
      return;
    }
    if (this._phase !== 'waiting') return;
    const before = walk.current?.elementId;
    walk.jump(el.id);
    if (walk.current?.elementId !== before) this._beginStep();
  }

  /**
   * The home the walk plans from: what the server showed, with the links this element saved but the
   * home may not show yet. A home loaded before a link was saved would otherwise put its element
   * back in the queue.
   */
  private _walkHome(): HomeResponse | undefined {
    const home = this.home;
    if (!home || this._expected.size === 0) return home;
    const links = { ...home.links };
    for (const [id, link] of this._expected) {
      if (link) links[id] = link;
      else delete links[id];
    }
    return { ...home, links };
  }

  /** A new home arrived: drop what it now shows, and let the walk follow what changed elsewhere. */
  private _homeChanged(): void {
    const home = this.home;
    if (!home) return;
    for (const [id, link] of [...this._expected]) {
      if (sameLink(home.links[id], link)) this._expected.delete(id);
    }
    const walk = this._walk;
    // While a press is being saved or confirmed the walk stays where it is; it follows at the next step.
    // Check all keeps it still too, and brings it up to date when it ends.
    if (!walk || this._phase !== 'waiting' || this._check) return;
    const before = walk.current?.elementId;
    const planned = this._walkHome();
    if (planned) walk.refresh(planned);
    if (walk.current?.elementId !== before || !walk.current) this._beginStep();
  }

  // ---- Check all ----

  /** Check all can start: not while a press is being saved or confirmed, and not twice. */
  private _canCheck(): boolean {
    return (
      Boolean(this.home?.package) &&
      !this._check &&
      !this._busy &&
      (!this._walk || this._phase === 'waiting')
    );
  }

  /**
   * Go through everything linked that can be switched, one at a time (see `CheckAll`). Nothing
   * listens for a press meanwhile, so its toggles cannot be taken for one; a walk that was on
   * waits and listens again when Check all is over.
   */
  private async _startCheck(): Promise<void> {
    const { hass } = this;
    const home = this._walkHome();
    if (!hass || !home || !this._canCheck()) return;
    const all = new CheckAll(hass, home);
    const steps = all.steps();
    if (steps.length === 0) {
      this._say(NOTHING_TO_CHECK, false);
      return;
    }
    const check: Check = {
      all,
      steps,
      index: 0,
      phase: 'running',
      ok: 0,
      wrong: 0,
      untested: 0,
      wrongElements: [],
      token: 0,
    };
    document.addEventListener('visibilitychange', this._onVisibility);
    this._check = check; // before anything else: a second press of the button, and `_listen`, see it
    this._stopListening();
    this._armed = false;
    this._singleKey = '';
    this._singleFor = undefined;
    this._ambiguous = false;
    this._select([]);
    // A subscription still being set up is released first, so nothing is switched while it could hear.
    await this._subscribing;
    if (this._check === check) void this._runCheckStep();
  }

  /** A phone that is locked or backgrounded mid-step: put the load back now, not when the page wakes up. */
  private _onVisibility = (): void => {
    const check = this._check;
    if (document.visibilityState !== 'hidden' || !check || check.phase !== 'running') return;
    void check.all.abort();
  };

  /** The step Check all is on: highlight it, switch it, put it back, and ask. */
  private async _runCheckStep(): Promise<void> {
    const check = this._check;
    if (!check) return;
    // What Wrong unlinked (or anyone else did) is not asked about again.
    const links = this._walkHome()?.links ?? {};
    while (check.index < check.steps.length && check.steps[check.index]!.elementIds.every((id) => !links[id])) {
      check.index++;
    }
    const step = check.steps[check.index];
    if (!step) {
      check.phase = 'summary';
      this._select([]);
      this.requestUpdate();
      return;
    }
    const token = ++check.token;
    check.phase = 'running';
    check.problem = undefined;
    this._select(step.highlightIds);
    this.requestUpdate();
    const outcome = await check.all.run(step);
    const notBack = 'restored' in outcome && !outcome.restored;
    if (this._check !== check || check.token !== token) {
      // Stopped, or the installer left: there is no bar to show it in.
      if (notBack && this.isConnected) this._say(`Could not put ${step.label} back. Check it by hand.`, true);
      return;
    }
    if (notBack) {
      // Shown until the installer has looked: it must be put back by hand.
      check.phase = 'problem';
      check.problem = `Could not put ${step.label} back. Check it by hand.`;
    } else if (outcome.status === 'done') {
      check.phase = 'asking';
    } else if (outcome.status === 'cancelled') {
      // The screen turned off (see `_onVisibility`): it is back, and has not been judged.
      check.phase = 'problem';
      check.problem = `${step.label} was put back when the screen turned off. Run it again.`;
    } else if (outcome.status === 'unavailable') {
      check.phase = 'problem';
      check.problem = `${step.label} is unavailable, so it was not switched.`;
    } else if (outcome.status === 'failed') {
      check.phase = 'problem';
      check.problem = `Could not switch ${step.label}: ${outcome.message}`;
    } else {
      return; // busy: cannot happen, one step at a time
    }
    this.requestUpdate();
  }

  private _checkOk(): void {
    const check = this._check;
    if (!check || check.phase !== 'asking') return;
    check.ok++;
    check.index++;
    void this._runCheckStep();
  }

  /** Wrong: unlink what the step is linked to (the server puts names back) and go on; the walk takes them at the end. */
  private async _checkWrong(): Promise<void> {
    const { hass, entryId } = this;
    const check = this._check;
    const step = check?.steps[check.index];
    if (!hass || !entryId || !check || !step || check.phase !== 'asking' || this._busy) return;
    const links = this._walkHome()?.links ?? {};
    const ids = step.elementIds.filter((id) => links[id]);
    this._busy = true;
    try {
      if (ids.length > 0) await setLinks(hass, entryId, Object.fromEntries(ids.map((id) => [id, null])));
    } catch (err) {
      this._say(errorMessage(err, 'Could not unlink. Try again.'), true);
      return;
    } finally {
      this._busy = false;
    }
    for (const id of ids) this._expected.set(id, null);
    if (this._check !== check) return;
    check.wrong++;
    check.wrongElements.push(...ids);
    check.index++;
    void this._runCheckStep();
  }

  private _checkAgain(): void {
    const check = this._check;
    if (!check || (check.phase !== 'asking' && check.phase !== 'problem')) return;
    void this._runCheckStep();
  }

  private _checkSkip(): void {
    const check = this._check;
    if (!check || check.phase !== 'problem') return;
    check.untested++;
    check.index++;
    void this._runCheckStep();
  }

  private _checkSummary(check: Check): string {
    const base = `${check.ok} OK, ${check.wrong} to relink`;
    return check.untested > 0 ? `${base}, ${check.untested} not tested` : base;
  }

  /**
   * Close Check all (Close, Relink now, or Stop): a step that is running is put back first, and
   * only then does the walk listen again. What was marked Wrong goes back in the walk: a walk that
   * was on gets them and moves to the first; otherwise one starts.
   */
  private async _endCheck(stopped = false): Promise<void> {
    const check = this._check;
    if (!check || check.phase === 'ending') return;
    check.phase = 'ending';
    check.token++;
    this.requestUpdate();
    await check.all.abort();
    if (this._check !== check) return; // link mode was closed meanwhile
    this._check = undefined;
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._select([]);
    const [first] = check.wrongElements;
    const walk = this._walk;
    if (walk) {
      const home = this._walkHome();
      if (home) walk.refresh(home);
      if (first) walk.jump(first);
      this._beginStep();
    } else if (first) {
      this._startWalk(first);
    }
    if (stopped) this._say(`Check all stopped. ${this._checkSummary(check)}.`, false);
  }

  // ---- background ----

  /** The background is the same on every screen, so this saves it on the server. */
  private async _toggleOriginal(): Promise<void> {
    const { hass, entryId } = this;
    if (!hass || !entryId || this._busy) return;
    const next = this.home?.display?.background === 'original' ? 'soft' : 'original';
    this._busy = true;
    try {
      await setDisplay(hass, entryId, next);
      this._say(next === 'original' ? 'Showing the original background.' : 'Showing the soft background.', false);
    } catch (err) {
      this._say(errorMessage(err, 'Could not change the background. Try again.'), true);
    } finally {
      this._busy = false;
    }
  }

  // ---- starter scenes ----

  private async _createStarterScenes(): Promise<void> {
    const { hass, entryId } = this;
    if (!hass || !entryId || this._busy) return;
    this._busy = true;
    try {
      await createStarterScenes(hass, entryId);
      this._say('Starter scenes are ready on the quick panel.', false);
    } catch (err) {
      this._say(errorMessage(err, 'Could not create the scenes. Try again.'), true);
    } finally {
      this._busy = false;
    }
  }

  // ---- refresh ----

  /** Show the dialog and move the keyboard into it. */
  private _openDialog(dialog: Dialog): void {
    const opening = this._dialog === undefined;
    this._dialog = dialog;
    if (opening) {
      void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.dialog .cancel')?.focus());
    }
  }

  private _closeDialog = (): void => {
    this._dialogRun++;
    this._dialog = undefined;
  };

  private async _preview(fileId?: string, run = ++this._dialogRun): Promise<void> {
    const { hass, entryId } = this;
    if (!hass || !entryId) return;
    this._openDialog({ phase: 'checking', fromFile: fileId !== undefined });
    try {
      const summary = await refreshPreview(hass, entryId, fileId);
      if (run === this._dialogRun) this._dialog = { phase: 'ready', summary };
    } catch (err) {
      if (run === this._dialogRun) {
        this._dialog = { phase: 'error', error: errorMessage(err, 'Could not check for changes. Try again.') };
      }
    }
  }

  private async _chooseFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // so choosing the same file again still counts
    const { hass } = this;
    if (!file || !hass) return;
    const run = ++this._dialogRun;
    this._openDialog({ phase: 'checking', fromFile: true });
    let fileId: string;
    try {
      fileId = await uploadHomeFile(hass, file);
    } catch {
      if (run === this._dialogRun) this._dialog = { phase: 'error', error: 'Could not upload that file. Try again.' };
      return;
    }
    if (run === this._dialogRun) await this._preview(fileId, run);
  }

  private async _apply(): Promise<void> {
    const { hass, entryId } = this;
    const summary = this._dialog?.summary;
    if (!hass || !entryId || !summary) return;
    this._dialog = { phase: 'applying', summary };
    try {
      await refreshApply(hass, entryId, summary.preview_id);
      this._dialog = undefined;
      this._say('Home updated.', false);
    } catch (err) {
      this._dialog = { phase: 'ready', summary, error: errorMessage(err, 'Could not update the home. Try again.') };
    }
  }

  // ---- drawing ----

  private _status(el: HomeElement): VisualStatus {
    return this.hass ? visualState(el, this.home?.links[el.id], this.hass).status : 'unlinked';
  }

  /** What an element is linked to, as a sentence. */
  private _linkText(el: HomeElement): { text: string; missing: boolean } {
    const status = this._status(el);
    if (status === 'unlinked') return { text: 'Not linked yet', missing: false };
    const link = this.home?.links[el.id];
    const name = link && this.hass ? linkName(link, this.hass) : undefined;
    if (status === 'missing' || name === undefined) return { text: 'Missing device', missing: true };
    return { text: `Linked to ${name}`, missing: false };
  }

  private _renderCounts(): TemplateResult | typeof nothing {
    let unlinked = 0;
    let missing = 0;
    for (const { el } of this._known.values()) {
      const status = this._status(el);
      if (status === 'unlinked') unlinked++;
      else if (status === 'missing') missing++;
    }
    const parts = [
      unlinked > 0 ? `${unlinked} not linked yet` : '',
      missing > 0 ? plural(missing, 'missing device', 'missing devices') : '',
    ].filter(Boolean);
    return html`<p class="counts">${parts.length > 0 ? parts.join(' · ') : 'Everything is linked.'}</p>`;
  }

  private _renderSelection(): TemplateResult {
    const elements = this._selected.flatMap((id) => this._known.get(id)?.el ?? []);
    const first = elements[0];
    if (!first) {
      return html`<p class="hint">
        ${this._multi
          ? 'Tap several elements of the same kind, then pick one device for all of them.'
          : 'Tap an element on the drawing to link it to a device.'}
      </p>`;
    }
    const single = elements.length === 1;
    const status = single ? this._linkText(first) : undefined;
    const anyLinked = elements.some((el) => this.home?.links[el.id]);
    return html`<div class="selection">
      <div class="who">
        <div class="title">${single ? nameOf(first) : `${elements.length} selected`}</div>
        ${status
          ? html`<div class=${classMap({ status: true, missing: status.missing })}>${status.text}</div>`
          : html`<div class="status">${elements.map(nameOf).join(', ')}</div>`}
      </div>
      ${anyLinked ? html`<button class="unlink" ?disabled=${this._busy} @click=${() => void this._link(null)}>Unlink</button>` : nothing}
    </div>`;
  }

  private _renderCandidates(): TemplateResult | typeof nothing {
    const first = this._known.get(this._selected[0] ?? '')?.el;
    const hass = this.hass;
    if (!first || !hass) return nothing;
    const words = this._search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const found = linkCandidates(first, hass).filter((c) => {
      const hay = `${c.name} ${c.area} ${c.detail ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const current = this._selected.length === 1 ? this.home?.links[first.id] : undefined;
    return html`
      <input
        class="search"
        type="search"
        placeholder="Search by name or room"
        aria-label="Search devices"
        .value=${this._search}
        @input=${(e: Event) => (this._search = (e.target as HTMLInputElement).value)}
      />
      ${found.length === 0
        ? html`<p class="none">Nothing matches.</p>`
        : html`<div class="candidates">
            ${found.map(
              (c) => html`<button
                class=${classMap({
                  candidate: true,
                  current: current?.type === c.link.type && current.id === c.link.id,
                })}
                data-link-id=${c.link.id}
                ?disabled=${this._busy}
                @click=${() => void this._link(c.link)}
              >
                <span class="name">${c.name}</span>
                <span class="sub">${[c.area, c.detail].filter(Boolean).join(' · ')}</span>
              </button>`,
            )}
          </div>`}
    `;
  }

  private _renderNotDrawn(): TemplateResult | typeof nothing {
    const rows = [...this._known.values()].filter(({ el }) => !el.drawn);
    if (rows.length === 0) return nothing;
    return html`<section class="not-drawn">
      <h4>Not on the drawing</h4>
      ${rows.map(({ el, levelName }) => {
        const status = this._linkText(el);
        return html`<button
          class=${classMap({ 'not-drawn-row': true, selected: this._selected.includes(el.id) })}
          aria-pressed=${this._selected.includes(el.id) ? 'true' : 'false'}
          @click=${() => this.tap(el.id)}
        >
          <span class="name">${nameOf(el)}</span>
          <span class=${classMap({ sub: true, missing: status.missing })}>${levelName} · ${status.text}</span>
        </button>`;
      })}
    </section>`;
  }

  private _renderChanges(title: string, items: string[]): TemplateResult | typeof nothing {
    if (items.length === 0) return nothing;
    return html`<div class="changes">
      <h4>${title}</h4>
      <ul>
        ${items.map((text) => html`<li>${text}</li>`)}
      </ul>
    </div>`;
  }

  private _renderDialog(): TemplateResult | typeof nothing {
    const dialog = this._dialog;
    if (!dialog) return nothing;
    const summary = dialog.summary;
    const describe = (e: ChangedElement): string => `${e.label || e.productName} · ${e.levelName}`;
    const changed = summary
      ? summary.added.length + summary.removed.length + summary.changed_drawings.length > 0
      : false;
    const busy = dialog.phase === 'checking' || dialog.phase === 'applying';
    return html`<div class="overlay">
      <div class="backdrop"></div>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="refresh-title">
        <h3 id="refresh-title">Refresh the home</h3>
        ${dialog.phase === 'checking'
          ? html`<p class="working">${dialog.fromFile ? 'Reading the file…' : 'Checking the planner…'}</p>`
          : nothing}
        ${summary
          ? html`<p class="summary">${summaryLine(summary)}</p>
              ${changed
                ? html`${this._renderChanges('New devices', summary.added.map(describe))}
                  ${this._renderChanges('Removed devices', summary.removed.map(describe))}
                  ${this._renderChanges(
                    'Updated drawings',
                    summary.changed_drawings.map(
                      (d) => `${d.levelName} · ${d.type === 'lighting' ? 'Lighting' : 'Smart Home'}`,
                    ),
                  )}`
                : html`<p class="nothing">Nothing has changed.</p>`}`
          : nothing}
        ${dialog.phase === 'applying' ? html`<p class="working">Updating…</p>` : nothing}
        ${dialog.error ? html`<p class="error" role="alert">${dialog.error}</p>` : nothing}
        <div class="actions">
          <button class="cancel" ?disabled=${dialog.phase === 'applying'} @click=${this._closeDialog}>
            ${summary && changed ? 'Cancel' : 'Close'}
          </button>
          ${summary && changed
            ? html`<button class="apply primary" ?disabled=${busy} @click=${() => void this._apply()}>Apply</button>`
            : nothing}
        </div>
      </div>
    </div>`;
  }

  private _renderIncludeOther(): TemplateResult {
    return html`<button
      class="include-other"
      role="switch"
      aria-checked=${this._includeOther ? 'true' : 'false'}
      @click=${() => this._toggleIncludeOther()}
    >
      <span class="track"><span class="knob"></span></span>
      <span>Include other devices</span>
    </button>`;
  }

  private _renderListen(armed: boolean): TemplateResult {
    return html`<button
      class="listen"
      role="switch"
      aria-checked=${armed ? 'true' : 'false'}
      @click=${() => this._setArmed(!armed)}
    >
      <span class="track"><span class="knob"></span></span>
      <span>Listen</span>
    </button>`;
  }

  /** Outside the walk: with one marker selected, listening for the press of its device. */
  private _renderPressHint(): TemplateResult | typeof nothing {
    if (this._walk || this._multi) return nothing;
    const id = this._selected.length === 1 ? this._selected[0] : undefined;
    const el = this._known.get(id ?? '')?.el;
    if (!id || !el || stepFor(el).kind === 'pick') return nothing;
    if (this._armed) {
      return html`<div class="press-hint">
        <p class="hint">Press the device now</p>
        ${this._ambiguous ? html`<p class="press-warning" role="alert">${AMBIGUOUS}</p>` : nothing}
        ${this._renderListen(true)} ${this._renderIncludeOther()}
      </div>`;
    }
    // A linked marker is only listened for when asked: a press elsewhere must not overwrite its link.
    return this.home?.links[id]
      ? html`<button class="press-relink" @click=${() => this._setArmed(true)}>Press to relink</button>`
      : html`<div class="press-tools">${this._renderListen(false)}</div>`;
  }

  /** Outside the walk: what a press linked, for 2 seconds, with Undo. */
  private _renderPressToast(): TemplateResult | typeof nothing {
    const toast = this._toast;
    if (this._walk || !toast) return nothing;
    return html`<div class="press-toast" role="status">
      <span class="walk-linked">Linked: ${this._nameOf(toast.link, toast.name)}</span>
      <button class="press-undo" ?disabled=${this._busy} @click=${() => void this._undo()}>Undo</button>
    </div>`;
  }

  /** The walk bar: where it is, what to do, and how to move through it. */
  private _renderWalk(): TemplateResult | typeof nothing {
    const walk = this._walk;
    const step = walk?.current;
    if (!walk || !step) return nothing;
    const known = this._known.get(step.elementId);
    const links = this._walkHome()?.links ?? {};
    let linked = 0;
    for (const id of this._known.keys()) if (links[id]) linked++;
    const waiting = this._phase === 'waiting';
    const toast = this._toast;
    const group = this._group;
    return html`<section class="walk" aria-label="Linking walk">
      <div class="walk-head">
        <span class="walk-progress">${linked} / ${this._known.size} linked</span>
        <button class="walk-stop" @click=${() => this._endWalk()}>Stop</button>
      </div>
      ${known ? html`<div class="walk-for">${nameOf(known.el)} · ${known.levelName}</div>` : nothing}
      ${toast
        ? html`<div class="walk-toast" role="status">
            <span class="walk-linked">Linked: ${this._nameOf(toast.link, toast.name)}</span>
            <button class="walk-undo" ?disabled=${this._busy} @click=${() => void this._undo()}>Undo</button>
          </div>`
        : html`<p class="walk-prompt" role="status">${this._phase === 'others' ? OTHER_LIGHTS : step.prompt}</p>`}
      ${this._ambiguous ? html`<p class="walk-warning" role="alert">${AMBIGUOUS}</p>` : nothing}
      <div class="walk-actions">
        ${group
          ? html`<button class="walk-done primary" ?disabled=${this._busy} @click=${() => void this._doneGroup()}>Link these lights</button>
              <button class="walk-undo" ?disabled=${this._busy} @click=${() => void this._undo()}>Undo</button>`
          : nothing}
        <button class="walk-back" ?disabled=${!waiting} @click=${() => this._back()}>Back</button>
        <button class="walk-skip" ?disabled=${!waiting} @click=${() => this._skip()}>Skip</button>
      </div>
      ${this._renderIncludeOther()}
    </section>`;
  }

  /** Check all: which step, what to watch, then OK or Wrong; at the end the summary. */
  private _renderCheck(): TemplateResult | typeof nothing {
    const check = this._check;
    if (!check) return nothing;
    const step = check.steps[check.index];
    const phase = check.phase;
    const summary = phase === 'summary';
    return html`<section class="check" aria-label="Check all">
      <div class="check-head">
        <span class="check-progress">${summary ? 'Done' : `${check.index + 1} / ${check.steps.length}`}</span>
        ${summary
          ? nothing
          : html`<button class="check-stop" ?disabled=${phase === 'ending' || this._busy} @click=${() => void this._endCheck(true)}>Stop</button>`}
      </div>
      ${summary
        ? html`<p class="check-summary" role="status">${this._checkSummary(check)}</p>
            <div class="check-actions">
              <button class="check-close primary" @click=${() => void this._endCheck()}>
                ${check.wrongElements.length > 0 ? 'Relink now' : 'Close'}
              </button>
            </div>`
        : html`${step ? html`<div class="check-for">${step.label} · ${step.levelName}</div>` : nothing}
            ${phase === 'problem'
              ? html`<p class="check-prompt check-problem" role="alert">${check.problem}</p>`
              : html`<p class="check-prompt" role="status">
                  ${phase === 'asking'
                    ? 'Was it the right one?'
                    : phase === 'ending'
                      ? 'Putting it back…'
                      : 'Watch now. It switches for 2 seconds, then goes back.'}
                </p>`}
            <div class="check-actions">
              ${phase === 'asking'
                ? html`<button class="check-ok primary" ?disabled=${this._busy} @click=${() => this._checkOk()}>OK</button>
                    <button class="check-wrong" ?disabled=${this._busy} @click=${() => void this._checkWrong()}>Wrong</button>`
                : nothing}
              ${phase === 'asking' || phase === 'problem'
                ? html`<button class="check-again" ?disabled=${this._busy} @click=${() => this._checkAgain()}>Again</button>`
                : nothing}
              ${phase === 'problem'
                ? html`<button class="check-skip" @click=${() => this._checkSkip()}>Skip</button>`
                : nothing}
            </div>`}
    </section>`;
  }

  private _done(): void {
    this.dispatchEvent(new CustomEvent('maxsen-link-done', { bubbles: true, composed: true }));
  }

  /** The installer's tools, which Check all hides while it is open. */
  private _renderTools(): TemplateResult {
    const fromFile = this.home?.source === 'file';
    const original = this.home?.display?.background === 'original';
    return html`
      ${this._walk
        ? nothing
        : html`<button class="start-walk" ?disabled=${!this.home?.package} @click=${() => this._startWalk()}>
            Start linking walk
          </button>`}
      <button class="check-all" ?disabled=${!this._canCheck()} @click=${() => void this._startCheck()}>
        Check all
      </button>
      <button class="multi" aria-pressed=${this._multi ? 'true' : 'false'} @click=${this._toggleMulti}>
        Select several
      </button>
      <button class="starter" ?disabled=${this._busy} @click=${() => void this._createStarterScenes()}>
        Create starter scenes
      </button>
      ${fromFile
        ? nothing
        : html`<button class="refresh" @click=${() => void this._preview()}>Refresh from planner</button>`}
      <button class="choose-file" @click=${() => this.renderRoot.querySelector<HTMLInputElement>('input[type="file"]')?.click()}>
        ${fromFile ? 'Choose a newer home file' : 'Use a home file instead'}
      </button>
      <button
        class="original-background"
        role="switch"
        aria-checked=${original ? 'true' : 'false'}
        ?disabled=${this._busy}
        @click=${() => void this._toggleOriginal()}
      >
        <span class="track"><span class="knob"></span></span>
        <span>Original background</span>
      </button>
      <input type="file" accept=".json,application/json" hidden @change=${(e: Event) => void this._chooseFile(e)} />
    `;
  }

  override render(): TemplateResult {
    const walking = this._walk !== undefined;
    const picking = this._walk?.current?.kind === 'pick' && this._phase === 'waiting';
    const checking = this._check !== undefined;
    return html`
      ${checking ? this._renderCheck() : this._renderWalk()}
      <div class="toolbar">
        ${this._group ? nothing : html`<button class="done primary" @click=${this._done}>Done</button>`}
        ${checking ? nothing : this._renderTools()}
      </div>
      ${this._notice
        ? html`<p class=${classMap({ notice: true, error: this._notice.error })} role="status">${this._notice.text}</p>`
        : nothing}
      ${checking
        ? nothing
        : html`<div class="content">
            ${this._renderPressToast()} ${walking ? nothing : this._renderCounts()}
            ${!walking || picking ? this._renderSelection() : nothing} ${this._renderPressHint()}
            ${!walking || picking ? this._renderCandidates() : nothing}
            ${this._renderNotDrawn()}
          </div>`}
      ${this._renderDialog()}
    `;
  }

  static override styles = css`
    :host {
      display: block;
      color: var(--primary-text-color, #1f1d1a);
      font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    }
    h3,
    h4,
    p {
      margin: 0;
    }
    button {
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    button:disabled {
      cursor: default;
      opacity: 0.6;
    }
    .toolbar {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid var(--divider-color, #e3e6ea);
    }
    .toolbar button {
      min-height: 44px;
      padding: 0 16px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 14px;
      background: transparent;
      font-size: 15px;
      line-height: 1.2;
    }
    .toolbar button[aria-pressed='true'] {
      border-color: var(--primary-color, #2f6fed);
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 16%, transparent);
      font-weight: 600;
    }
    .toolbar button.original-background {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 12px;
      text-align: left;
    }
    .original-background .track,
    .listen .track,
    .include-other .track {
      position: relative;
      flex: none;
      width: 44px;
      height: 26px;
      border-radius: 13px;
      background: var(--disabled-color, #c4c8ce);
      transition: background 0.15s;
    }
    .original-background[aria-checked='true'] .track,
    .listen[aria-checked='true'] .track,
    .include-other[aria-checked='true'] .track {
      background: var(--primary-color, #2f6fed);
    }
    .original-background .knob,
    .listen .knob,
    .include-other .knob {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.15s;
    }
    .original-background[aria-checked='true'] .knob,
    .listen[aria-checked='true'] .knob,
    .include-other[aria-checked='true'] .knob {
      transform: translateX(18px);
    }
    .listen {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 44px;
      padding: 0;
      border: 0;
      background: transparent;
      text-align: left;
      font-size: 15px;
    }
    .press-relink {
      min-height: 44px;
      padding: 0 18px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: var(--card-background-color, #fff);
      font-size: 16px;
    }
    .press-toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 12%, transparent);
      font-size: 17px;
      font-weight: 600;
    }
    .press-undo {
      min-height: 44px;
      padding: 0 18px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: var(--card-background-color, #fff);
      font-size: 16px;
    }
    .include-other {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 44px;
      padding: 0;
      border: 0;
      background: transparent;
      text-align: left;
      font-size: 15px;
    }
    .walk,
    .check {
      /* The prompt stays in view while the rest of the tools scroll under it. */
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid var(--divider-color, #e3e6ea);
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 8%, var(--card-background-color, #fff));
    }
    .walk-head,
    .check-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .walk-progress,
    .check-progress {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--secondary-text-color, #5b6168);
    }
    .walk-for,
    .check-for {
      font-size: 15px;
      color: var(--secondary-text-color, #5b6168);
      overflow-wrap: anywhere;
    }
    .walk-prompt,
    .check-prompt,
    .check-summary {
      font-size: 19px;
      font-weight: 600;
      line-height: 1.35;
    }
    .walk-toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 19px;
      font-weight: 600;
      line-height: 1.35;
    }
    .walk-linked {
      overflow-wrap: anywhere;
    }
    .walk-warning,
    .press-warning {
      font-size: 16px;
      font-weight: 600;
      color: var(--error-color, #b3261e);
    }
    .check-problem {
      color: var(--error-color, #b3261e);
    }
    .walk-actions,
    .check-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .walk button:not(.include-other),
    .check button,
    .press-hint button:not(.include-other):not(.listen) {
      min-height: 44px;
      padding: 0 18px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: var(--card-background-color, #fff);
      font-size: 16px;
    }
    .walk button.primary,
    .check button.primary {
      border-color: var(--primary-color, #2f6fed);
      background: var(--primary-color, #2f6fed);
      color: var(--text-primary-color, #fff);
    }
    .press-hint {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 8%, transparent);
    }
    .press-hint .hint {
      font-size: 17px;
      font-weight: 600;
      color: var(--primary-text-color, #1f1d1a);
    }
    .primary {
      border-color: var(--primary-color, #2f6fed);
      background: var(--primary-color, #2f6fed);
      color: var(--text-primary-color, #fff);
      font-weight: 600;
    }
    .toolbar button.primary {
      border-color: var(--primary-color, #2f6fed);
      background: var(--primary-color, #2f6fed);
      color: var(--text-primary-color, #fff);
    }
    .notice {
      margin: 8px 12px 0;
      padding: 10px 14px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 12%, transparent);
      font-size: 15px;
    }
    .notice.error {
      background: color-mix(in srgb, var(--error-color, #c62828) 12%, transparent);
      color: var(--error-color, #b3261e);
    }
    .content {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
    }
    .counts,
    .hint,
    .none {
      font-size: 15px;
      line-height: 1.5;
      color: var(--secondary-text-color, #5b6168);
    }
    .selection {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 10%, transparent);
    }
    .who {
      flex: 1;
      min-width: 0;
    }
    .title {
      font-size: 17px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .status,
    .sub {
      font-size: 14px;
      color: var(--secondary-text-color, #5b6168);
      overflow-wrap: anywhere;
    }
    .missing {
      color: var(--error-color, #c62828);
      font-weight: 600;
    }
    .unlink {
      min-height: 44px;
      padding: 0 16px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: var(--card-background-color, #fff);
    }
    .search {
      box-sizing: border-box;
      width: 100%;
      min-height: 44px;
      padding: 0 14px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: var(--card-background-color, #fff);
      color: inherit;
      font: inherit;
      font-size: 16px;
    }
    .candidates,
    .not-drawn {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .candidate,
    .not-drawn-row {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 52px;
      padding: 6px 14px;
      border: 1px solid var(--divider-color, #e3e6ea);
      border-radius: 12px;
      background: var(--card-background-color, #fff);
      text-align: left;
    }
    .candidate.current,
    .not-drawn-row.selected {
      border-color: var(--primary-color, #2f6fed);
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 12%, var(--card-background-color, #fff));
    }
    .candidate .name,
    .not-drawn-row .name {
      font-size: 16px;
      overflow-wrap: anywhere;
    }
    h4 {
      padding: 8px 0 2px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--secondary-text-color, #5b6168);
    }

    .overlay {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
    }
    .dialog {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-sizing: border-box;
      width: min(480px, 100%);
      max-height: 100%;
      overflow-y: auto;
      padding: 20px;
      border-radius: 16px;
      background: var(--card-background-color, #fff);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .dialog h3 {
      font-size: 20px;
    }
    .dialog .summary {
      font-size: 17px;
      font-weight: 600;
      line-height: 1.4;
    }
    .dialog .working,
    .dialog .nothing {
      font-size: 16px;
      color: var(--secondary-text-color, #5b6168);
    }
    .dialog .error {
      font-size: 16px;
      color: var(--error-color, #c62828);
    }
    .dialog ul {
      margin: 0;
      padding-left: 20px;
      font-size: 15px;
      line-height: 1.6;
    }
    .dialog .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding-top: 6px;
    }
    .dialog button {
      min-height: 44px;
      min-width: 88px;
      padding: 0 20px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: transparent;
      font-size: 16px;
    }
    .dialog .primary {
      border-color: var(--primary-color, #2f6fed);
      background: var(--primary-color, #2f6fed);
    }
  `;
}

if (!customElements.get('maxsen-link-mode')) {
  customElements.define('maxsen-link-mode', MaxsenLinkMode);
}

declare global {
  interface HTMLElementTagNameMap {
    'maxsen-link-mode': MaxsenLinkMode;
  }
}
