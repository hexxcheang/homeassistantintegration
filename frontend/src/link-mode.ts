import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import {
  createStarterScenes,
  refreshApply,
  refreshPreview,
  setLinks,
  uploadHomeFile,
} from './api.ts';
import { errorMessage, linkName } from './hass-util.ts';
import { LIGHTING_CATEGORIES, linkCandidates } from './link-candidates.ts';
import type { ChangedElement, HassLike, HomeElement, HomeResponse, Link, RefreshSummary } from './types.ts';
import { visualState, type VisualStatus } from './visual-state.ts';

const NOTICE_MS = 5000;
const MIXED_KINDS = 'Select lights together, or other devices together, not both.';

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

  private _known = new Map<string, Known>();
  /** Bumped when the dialog is closed, so an answer that arrives later does not reopen it. */
  private _dialogRun = 0;
  private _noticeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this._selected = [];
    this._multi = false;
    this._search = '';
    this._busy = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._noticeTimer);
  }

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
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
  }

  // ---- selection ----

  /** An element was tapped on the drawing (or chosen from the list). */
  tap(elementId: string): void {
    const tapped = this._known.get(elementId)?.el;
    if (!tapped) return;
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
  }

  private _toggleMulti(): void {
    this._multi = !this._multi;
    if (!this._multi && this._selected.length > 1) this._select(this._selected.slice(0, 1));
  }

  private _say(text: string, error: boolean): void {
    this._notice = { text, error };
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => (this._notice = undefined), NOTICE_MS);
  }

  // ---- linking ----

  private async _link(link: Link | null): Promise<void> {
    const { hass, entryId } = this;
    if (!hass || !entryId || this._busy) return;
    const targets = link === null ? this._selected.filter((id) => this.home?.links[id]) : this._selected;
    if (targets.length === 0) return;
    this._busy = true;
    try {
      await setLinks(hass, entryId, Object.fromEntries(targets.map((id) => [id, link])));
      const many = targets.length > 1;
      const verb = link === null ? 'Unlinked' : 'Linked';
      this._say(many ? `${verb} ${targets.length} elements.` : `${verb}.`, false);
      this._select([]);
    } catch (err) {
      this._say(errorMessage(err, 'Could not save the link. Try again.'), true);
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

  private _done(): void {
    this.dispatchEvent(new CustomEvent('maxsen-link-done', { bubbles: true, composed: true }));
  }

  override render(): TemplateResult {
    // A home from a file is refreshed from a newer file. A paired home is refreshed from the
    // planner, or from a file when the planner cannot be used (no internet, connection revoked).
    const fromFile = this.home?.source === 'file';
    return html`
      <div class="toolbar">
        <button class="done primary" @click=${this._done}>Done</button>
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
        <input type="file" accept=".json,application/json" hidden @change=${(e: Event) => void this._chooseFile(e)} />
      </div>
      ${this._notice
        ? html`<p class=${classMap({ notice: true, error: this._notice.error })} role="status">${this._notice.text}</p>`
        : nothing}
      <div class="content">
        ${this._renderCounts()} ${this._renderSelection()} ${this._renderCandidates()} ${this._renderNotDrawn()}
      </div>
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
