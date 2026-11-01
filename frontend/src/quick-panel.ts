import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { setQuickPanel } from './api.ts';
import { domainOf, errorMessage } from './hass-util.ts';
import { CONTROLLABLE, linkEntityIds, primaryEntity, toggleEntities } from './operate.ts';
import type { HassLike, HomeElement, HomeResponse, QuickItem } from './types.ts';
import { visualState, type VisualStatus } from './visual-state.ts';

const FLASH_MS = 2000;
const NOT_AVAILABLE = 'Not available';

/** What a tile says when the element has no reading of its own. */
const STATUS_TEXT: Record<VisualStatus, string> = {
  on: 'On',
  off: 'Off',
  alert: 'Alert',
  idle: '',
  unavailable: 'Unavailable',
  missing: 'Missing device',
  unlinked: 'Not linked yet',
};

/** A button on the quick panel, or a row in the editor. */
interface Entry {
  key: string;
  item: QuickItem;
  name: string;
  /** Live state text (buttons) or why it cannot be used. */
  state: string;
  on: boolean;
  /** Cannot be tapped: not linked, gone, or unavailable. */
  disabled: boolean;
}

interface Group {
  title: string;
  rows: Row[];
}

interface Row {
  key: string;
  item: QuickItem;
  name: string;
  note: string;
  /** Cannot be added (an element with no link). */
  blocked: boolean;
}

interface Drag {
  pointerId: number;
  key: string;
}

const keyOf = (item: QuickItem): string => `${item.type}:${item.id}`;
const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true });

/** Maxsen's own scenes come first, in the order the integration lists them. */
function starterRank(name: string): number {
  if (name === 'All off') return 0;
  if (name.startsWith('All off – ')) return 1;
  if (name === 'All lights off') return 2;
  return 3;
}

/** The index to move a dragged row to: the first row whose middle is below the pointer. */
function dropIndex(y: number, rows: readonly { top: number; height: number }[]): number {
  const i = rows.findIndex((r) => y < r.top + r.height / 2);
  return i === -1 ? rows.length - 1 : i;
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/**
 * The shared quick panel: one big button per favourite element or scene, and an editor to choose
 * and order them. Anyone may edit it.
 */
export class MaxsenQuickPanel extends LitElement {
  static override properties = {
    hass: { attribute: false },
    home: { attribute: false },
    entryId: { attribute: false },
    _editing: { state: true },
    _draft: { state: true },
    _saving: { state: true },
    _error: { state: true },
    _flash: { state: true },
    _dragging: { state: true },
  };

  declare hass: HassLike | undefined;
  declare home: HomeResponse | undefined;
  declare entryId: string | undefined;
  declare private _editing: boolean;
  declare private _draft: QuickItem[];
  declare private _saving: boolean;
  declare private _error: string | undefined;
  declare private _flash: { key: string; text: string } | undefined;
  declare private _dragging: string | undefined;

  private _elements = new Map<string, HomeElement>();
  private _drag: Drag | undefined;
  private _flashTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this._editing = false;
    this._draft = [];
    this._saving = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._flashTimer);
  }

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has('home')) return;
    this._elements = new Map(
      (this.home?.package?.levels ?? []).flatMap((l) =>
        l.plans.flatMap((p) => p.elements.map((e) => [e.id, e] as const)),
      ),
    );
  }

  // ---- what is shown ----

  private _entry(item: QuickItem): Entry {
    const key = keyOf(item);
    const hass = this.hass;
    const gone: Entry = { key, item, name: item.id, state: NOT_AVAILABLE, on: false, disabled: true };
    if (!hass) return gone;
    if (item.type === 'element') {
      const el = this._elements.get(item.id);
      if (!el) return { ...gone, name: NOT_AVAILABLE };
      const vs = visualState(el, this.home?.links[item.id], hass);
      return {
        key,
        item,
        name: el.label || el.productName,
        state: vs.text ?? STATUS_TEXT[vs.status],
        on: vs.status === 'on',
        disabled: vs.status === 'unlinked' || vs.status === 'missing' || vs.status === 'unavailable',
      };
    }
    const state = hass.states[item.id];
    if (!state) return gone;
    const friendly = state.attributes['friendly_name'];
    const unavailable = state.state === 'unavailable';
    return {
      key,
      item,
      name: (typeof friendly === 'string' && friendly) || item.id,
      state: unavailable ? 'Unavailable' : domainOf(item.id) === 'scene' ? 'Scene' : capitalise(state.state),
      on: state.state === 'on',
      disabled: unavailable,
    };
  }

  /** Everything the editor can offer: scenes first, then each level's elements. */
  private _groups(): Group[] {
    const hass = this.hass;
    if (!hass) return [];
    const scenes: Row[] = Object.keys(hass.states)
      .filter((id) => domainOf(id) === 'scene')
      .map((id) => {
        const item: QuickItem = { type: 'entity', id };
        return { key: keyOf(item), item, name: this._entry(item).name, note: '', blocked: false };
      })
      .sort((a, b) => starterRank(a.name) - starterRank(b.name) || byName(a, b));

    const groups: Group[] = scenes.length > 0 ? [{ title: 'Scenes', rows: scenes }] : [];
    const levels = [...(this.home?.package?.levels ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const level of levels) {
      const seen = new Set<string>();
      const rows: Row[] = [];
      for (const el of level.plans.flatMap((p) => p.elements)) {
        if (seen.has(el.id)) continue;
        seen.add(el.id);
        const item: QuickItem = { type: 'element', id: el.id };
        const linked = this.home?.links[el.id] !== undefined;
        rows.push({
          key: keyOf(item),
          item,
          name: el.label || el.productName,
          note: !linked ? 'Not linked yet' : el.label ? el.productName : '',
          blocked: !linked,
        });
      }
      if (rows.length > 0) groups.push({ title: level.name, rows: rows.sort(byName) });
    }
    return groups;
  }

  // ---- using it ----

  private _showFlash(key: string, text: string): void {
    this._flash = { key, text };
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => (this._flash = undefined), FLASH_MS);
  }

  private _moreInfo(entityId: string): void {
    this.dispatchEvent(
      new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }),
    );
  }

  private async _press(entry: Entry): Promise<void> {
    const hass = this.hass;
    if (!hass || entry.disabled) return;
    const { item } = entry;
    if (item.type === 'entity' && domainOf(item.id) === 'scene') {
      try {
        await hass.callService('scene', 'turn_on', { entity_id: item.id });
        this._showFlash(entry.key, 'Done');
      } catch {
        this._showFlash(entry.key, 'Could not run it');
      }
      return;
    }
    const link = item.type === 'element' ? this.home?.links[item.id] : undefined;
    const ids =
      item.type === 'entity' ? [item.id] : link ? linkEntityIds(link, hass) : [];
    const controls = ids.filter((id) => CONTROLLABLE.has(domainOf(id)));
    if (controls.length > 0) {
      if (!(await toggleEntities(hass, controls))) this._showFlash(entry.key, 'Could not reach it');
      return;
    }
    const entityId = primaryEntity(ids, hass);
    if (entityId) this._moreInfo(entityId);
  }

  // ---- editing ----

  private _open(): void {
    this._draft = (this.home?.quick_panel ?? []).map(({ type, id }) => ({ type, id }));
    this._error = undefined;
    this._saving = false;
    this._editing = true;
    // Keyboard and screen reader users start inside the sheet.
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.sheet .close')?.focus());
  }

  private _close(): void {
    this._editing = false;
    this._drag = undefined;
    this._dragging = undefined;
  }

  private _toggleRow(row: Row, on: boolean): void {
    const rest = this._draft.filter((i) => keyOf(i) !== row.key);
    this._draft = on ? [...rest, row.item] : rest;
  }

  private _move(key: string, by: -1 | 1): void {
    const from = this._draft.findIndex((i) => keyOf(i) === key);
    const to = from + by;
    if (from === -1 || to < 0 || to >= this._draft.length) return;
    this._draft = moved(this._draft, from, to);
    // A moved row is a new node; keep the keyboard where the person was.
    void this.updateComplete.then(() => {
      const row = this.renderRoot.querySelector(`.order-row[data-key="${CSS.escape(key)}"]`);
      const button = row?.querySelector<HTMLButtonElement>(by === -1 ? '.up' : '.down');
      (button && !button.disabled ? button : row?.querySelector<HTMLButtonElement>('.up, .down'))?.focus();
    });
  }

  private _remove(key: string): void {
    this._draft = this._draft.filter((i) => keyOf(i) !== key);
  }

  private async _save(): Promise<void> {
    const { hass, entryId } = this;
    if (!hass || !entryId || this._saving) return;
    this._saving = true;
    this._error = undefined;
    try {
      await setQuickPanel(hass, entryId, this._draft);
      this._close();
    } catch (err) {
      this._error = errorMessage(err, 'Could not save. Try again.');
    } finally {
      this._saving = false;
    }
  }

  // ---- dragging by the handle ----

  private _onDown(e: PointerEvent): void {
    const target = (e.composedPath()[0] ?? e.target) as Element | null;
    const key = target?.closest?.('.handle')?.closest('[data-key]')?.getAttribute('data-key');
    if (!key) return;
    this._drag = { pointerId: e.pointerId, key };
    this._dragging = key;
    try {
      // On the list, not the row: the row is moved in the page while it is dragged.
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // Not an active pointer (synthetic events); moves still reach the list.
    }
    e.preventDefault();
  }

  private _onMove(e: PointerEvent): void {
    const drag = this._drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const rows = [...(e.currentTarget as Element).querySelectorAll('.order-row')].map((r) =>
      r.getBoundingClientRect(),
    );
    const from = this._draft.findIndex((i) => keyOf(i) === drag.key);
    if (from === -1 || rows.length !== this._draft.length) return;
    const to = dropIndex(e.clientY, rows);
    if (to !== from) this._draft = moved(this._draft, from, to);
  }

  private _onUp(e: PointerEvent): void {
    if (this._drag?.pointerId !== e.pointerId) return;
    this._drag = undefined;
    this._dragging = undefined;
  }

  // ---- drawing ----

  private _renderTile(entry: Entry): TemplateResult {
    const flash = this._flash?.key === entry.key ? this._flash.text : undefined;
    return html`<button
      class=${classMap({ tile: true, on: entry.on, off: !entry.on })}
      ?disabled=${entry.disabled}
      @click=${() => void this._press(entry)}
    >
      <span class="name">${entry.name}</span>
      <span class="state">${flash ?? entry.state}</span>
    </button>`;
  }

  private _renderOrder(): TemplateResult {
    if (this._draft.length === 0) {
      return html`<p class="hint">Nothing chosen yet. Tick things below.</p>`;
    }
    const last = this._draft.length - 1;
    return html`<ol
      class="order-list"
      @pointerdown=${this._onDown}
      @pointermove=${this._onMove}
      @pointerup=${this._onUp}
      @pointercancel=${this._onUp}
    >
      ${repeat(
        this._draft,
        keyOf,
        (item, i) => {
          const entry = this._entry(item);
          return html`<li
            class=${classMap({ 'order-row': true, dragging: this._dragging === entry.key })}
            data-key=${entry.key}
          >
            <span class="handle" aria-hidden="true">&#8942;&#8942;</span>
            <span class="label">
              <span class="name">${entry.name}</span>
              ${entry.disabled ? html`<span class="sub">${entry.state}</span>` : nothing}
            </span>
            <button class="up" aria-label=${`Move ${entry.name} up`} ?disabled=${i === 0} @click=${() => this._move(entry.key, -1)}>&#9650;</button>
            <button class="down" aria-label=${`Move ${entry.name} down`} ?disabled=${i === last} @click=${() => this._move(entry.key, 1)}>&#9660;</button>
            <button class="remove" aria-label=${`Remove ${entry.name}`} @click=${() => this._remove(entry.key)}>&times;</button>
          </li>`;
        },
      )}
    </ol>`;
  }

  private _renderGroup(group: Group): TemplateResult {
    const ticked = new Set(this._draft.map(keyOf));
    return html`<section class="group">
      <h4>${group.title}</h4>
      ${group.rows.map((row) => {
        const checked = ticked.has(row.key);
        return html`<label class=${classMap({ 'check-row': true, blocked: row.blocked && !checked })}>
          <input
            type="checkbox"
            data-key=${row.key}
            .checked=${checked}
            ?disabled=${row.blocked && !checked}
            @change=${(e: Event) => this._toggleRow(row, (e.target as HTMLInputElement).checked)}
          />
          <span class="label">
            <span class="name">${row.name}</span>
            ${row.note ? html`<span class="sub">${row.note}</span>` : nothing}
          </span>
        </label>`;
      })}
    </section>`;
  }

  private _renderSheet(): TemplateResult | typeof nothing {
    if (!this._editing) return nothing;
    return html`<div class="overlay" @keydown=${(e: KeyboardEvent) => e.key === 'Escape' && this._close()}>
      <div class="backdrop" @click=${this._close}></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <header>
          <h3 id="edit-title">Edit quick panel</h3>
          <button class="close" aria-label="Close" @click=${this._close}>&times;</button>
        </header>
        <div class="body">
          <section class="order">
            <h4>On the quick panel</h4>
            ${this._renderOrder()}
          </section>
          <section class="choose">
            <h4 class="section-title">Choose</h4>
            ${this._groups().map((g) => this._renderGroup(g))}
          </section>
        </div>
        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
        <footer>
          <button class="cancel" @click=${this._close}>Cancel</button>
          <button class="save primary" ?disabled=${this._saving} @click=${() => void this._save()}>Save</button>
        </footer>
      </div>
    </div>`;
  }

  override render(): TemplateResult {
    const entries = (this.home?.quick_panel ?? []).map((item) => this._entry(item));
    return html`
      <div class="head">
        <h3>Quick panel</h3>
        <div class="actions">
          <slot name="actions"></slot>
          <button class="edit" @click=${this._open}>Edit</button>
        </div>
      </div>
      ${entries.length === 0
        ? html`<p class="empty">Nothing here yet. Tap Edit to choose what goes on this panel.</p>`
        : html`<div class="tiles">${entries.map((e) => this._renderTile(e))}</div>`}
      ${this._renderSheet()}
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
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0 8px;
      padding: 8px 12px 0 16px;
    }
    .head h3 {
      font-size: 18px;
      font-weight: 600;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .edit {
      min-height: 44px;
      padding: 0 20px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: transparent;
      font-size: 16px;
    }
    .empty,
    .hint {
      padding: 12px 16px;
      font-size: 16px;
      line-height: 1.5;
      color: var(--secondary-text-color, #5b6168);
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
      padding: 8px 12px 12px;
    }
    .tile {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
      min-height: 68px;
      padding: 8px 14px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 14px;
      background: var(--card-background-color, #fff);
      text-align: left;
    }
    .tile.on {
      border-color: var(--primary-color, #2f6fed);
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 14%, var(--card-background-color, #fff));
    }
    .tile:disabled {
      opacity: 0.5;
    }
    .tile .name {
      font-size: 16px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .tile .state {
      font-size: 14px;
      color: var(--secondary-text-color, #5b6168);
    }

    .overlay {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
    }
    .sheet {
      position: relative;
      display: flex;
      flex-direction: column;
      width: min(560px, 100%);
      max-height: 92%;
      border-radius: 16px 16px 0 0;
      background: var(--card-background-color, #fff);
      box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.25);
    }
    @media (min-width: 700px) {
      .overlay {
        align-items: center;
      }
      .sheet {
        border-radius: 16px;
      }
    }
    .sheet header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px 4px 20px;
      border-bottom: 1px solid var(--divider-color, #e3e6ea);
    }
    .sheet header h3 {
      font-size: 18px;
    }
    .sheet button {
      min-height: 44px;
      min-width: 44px;
      border: 0;
      border-radius: 22px;
      background: transparent;
    }
    .sheet .close {
      font-size: 28px;
      line-height: 1;
    }
    .sheet .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 8px 8px 0;
    }
    .sheet h4 {
      padding: 12px 12px 4px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--secondary-text-color, #5b6168);
    }
    .order-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .order-row,
    .check-row {
      display: flex;
      align-items: center;
      gap: 4px;
      min-height: 48px;
      padding: 0 4px 0 8px;
      border-radius: 10px;
    }
    .order-row {
      background: var(--secondary-background-color, #f4f5f7);
      margin-bottom: 4px;
    }
    .order-row.dragging {
      background: color-mix(in srgb, var(--primary-color, #2f6fed) 18%, var(--card-background-color, #fff));
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    }
    .handle {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      min-height: 44px;
      color: var(--secondary-text-color, #5b6168);
      font-size: 18px;
      letter-spacing: -4px;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .label {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      padding: 6px 0;
    }
    .label .name {
      font-size: 16px;
      overflow-wrap: anywhere;
    }
    .label .sub {
      font-size: 13px;
      color: var(--secondary-text-color, #5b6168);
    }
    .check-row {
      cursor: pointer;
    }
    .check-row.blocked {
      opacity: 0.55;
      cursor: default;
    }
    .check-row input {
      flex: none;
      width: 22px;
      height: 22px;
      margin: 0 12px 0 4px;
      accent-color: var(--primary-color, #2f6fed);
    }
    .error {
      margin: 0;
      padding: 10px 20px;
      font-size: 15px;
      color: var(--error-color, #c62828);
    }
    .sheet footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 8px 12px;
      border-top: 1px solid var(--divider-color, #e3e6ea);
    }
    .sheet footer button {
      padding: 0 22px;
      font-size: 16px;
    }
    .sheet footer .primary {
      background: var(--primary-color, #2f6fed);
      color: var(--text-primary-color, #fff);
      font-weight: 600;
    }
    .sheet footer .primary:disabled {
      opacity: 0.6;
    }
  `;
}

if (!customElements.get('maxsen-quick-panel')) {
  customElements.define('maxsen-quick-panel', MaxsenQuickPanel);
}

declare global {
  interface HTMLElementTagNameMap {
    'maxsen-quick-panel': MaxsenQuickPanel;
  }
}
