import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { findEntryId, getHome, subscribe } from './api.ts';
import './floorplan-view.ts';
import './link-mode.ts';
import './quick-panel.ts';
import type { HassLike, HomeResponse } from './types.ts';

/** Floor plan and quick panel sit side by side when the space is landscape and this wide. */
const SIDE_BY_SIDE_MIN_WIDTH = 900;

const NO_SELECTION: string[] = [];

export type PanelLayout = 'side' | 'stacked';

export function layoutFor(width: number, height: number): PanelLayout {
  return width >= SIDE_BY_SIDE_MIN_WIDTH && width > height ? 'side' : 'stacked';
}

type Status = 'loading' | 'ready' | 'none' | 'error';

interface PanelInfo {
  config?: { entry_id?: string };
}

/**
 * The Maxsen Home panel: the floor plan view and, beside or under it, the quick panel. An
 * administrator with installer mode on also gets an Installer button, which swaps the quick panel
 * for the link tools. Also the body of the Lovelace card, which sets `embedded` to drop the
 * sidebar toolbar.
 */
export class MaxsenHomePanel extends LitElement {
  static override properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    panel: { attribute: false },
    embedded: { type: Boolean },
    _home: { state: true },
    _status: { state: true },
    _layout: { state: true },
    _linking: { state: true },
    _selected: { state: true },
  };

  declare hass: HassLike | undefined;
  declare narrow: boolean;
  declare panel: PanelInfo | undefined;
  declare embedded: boolean;
  declare private _home: HomeResponse | undefined;
  declare private _status: Status;
  declare private _layout: PanelLayout;
  /** The installer tools are open. */
  declare private _linking: boolean;
  /** The elements selected in link mode, outlined on the drawing. */
  declare private _selected: string[];

  private _entryId: string | undefined;
  private _started = false;
  /** Bumped on every stop, so a load that finishes late can tell it is no longer wanted. */
  private _run = 0;
  private _unsubscribe: (() => void) | undefined;
  private _observer: ResizeObserver | undefined;

  constructor() {
    super();
    this.narrow = false;
    this.embedded = false;
    this._status = 'loading';
    this._layout = 'stacked';
    this._linking = false;
    this._selected = [];
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect;
        if (box) this._layout = layoutFor(box.width, box.height);
      });
      this._observer.observe(this);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._observer?.disconnect();
    this._observer = undefined;
    this._stop();
  }

  /** Installer tools need an administrator and installer mode; the server checks both too. */
  private _mayInstall(): boolean {
    return Boolean(this.hass?.user?.is_admin && this._home?.installer_mode);
  }

  override willUpdate(): void {
    if (this._linking && !this._mayInstall()) this._closeInstaller();
  }

  private _closeInstaller(): void {
    this._linking = false;
    this._selected = [];
  }

  override updated(changed: Map<PropertyKey, unknown>): void {
    if (!this.hass) return;
    // The card can be pointed at another home while it is on screen.
    if (this._started && changed.has('panel') && this.panel?.config?.entry_id !== this._entryId) {
      this._stop();
    }
    if (!this._started) void this._start();
  }

  private _stop(): void {
    this._run++;
    this._started = false;
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  private async _start(): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this._started = true;
    const run = this._run;
    this._status = 'loading';
    try {
      const entryId = this.panel?.config?.entry_id ?? (await findEntryId(hass));
      if (run !== this._run) return;
      this._entryId = entryId;
      if (!entryId) {
        this._status = 'none';
        return;
      }
      const home = await getHome(hass, entryId);
      if (run !== this._run) return;
      this._home = home;
      this._status = 'ready';
      const unsubscribe = await subscribe(hass, entryId, () => void this._reload(run));
      if (run !== this._run) unsubscribe();
      else this._unsubscribe = unsubscribe;
    } catch {
      if (run === this._run) this._status = 'error';
    }
  }

  /** Any change on the server (home, links, quick panel) is picked up by loading the home again. */
  private async _reload(run: number): Promise<void> {
    const hass = this.hass;
    if (!hass || !this._entryId) return;
    try {
      const home = await getHome(hass, this._entryId);
      if (run === this._run) this._home = home;
    } catch {
      // Keep showing what we have; the next change tries again.
    }
  }

  private _retry(): void {
    this._stop();
    void this._start();
  }

  private _renderBody(): TemplateResult {
    switch (this._status) {
      case 'loading':
        return html`<div class="message">Loading…</div>`;
      case 'none':
        return html`<div class="message">
          Maxsen Home is not set up yet. Add it under Settings, Devices &amp; services.
        </div>`;
      case 'error':
        return html`<div class="message">
          Could not load the home.
          <button class="retry" @click=${this._retry}>Try again</button>
        </div>`;
      case 'ready': {
        const linking = this._linking;
        return html`
          <div class="body ${this._layout} ${linking ? 'linking' : ''}">
            <maxsen-floorplan-view
              class="view"
              .hass=${this.hass}
              .home=${this._home}
              .selected=${linking ? this._selected : NO_SELECTION}
              mode=${linking ? 'link' : 'use'}
              @maxsen-element-tap=${this._onElementTap}
            ></maxsen-floorplan-view>
            <div class="quick-panel-slot">
              ${linking
                ? html`<maxsen-link-mode
                    .hass=${this.hass}
                    .home=${this._home}
                    .entryId=${this._entryId}
                    @maxsen-selection=${(e: CustomEvent<{ selected: string[] }>) => (this._selected = e.detail.selected)}
                    @maxsen-link-done=${this._closeInstaller}
                  ></maxsen-link-mode>`
                : html`<maxsen-quick-panel .hass=${this.hass} .home=${this._home} .entryId=${this._entryId}>
                    ${this._mayInstall()
                      ? html`<button slot="actions" class="installer" @click=${() => (this._linking = true)}>
                          Installer
                        </button>`
                      : nothing}
                  </maxsen-quick-panel>`}
            </div>
          </div>
        `;
      }
    }
  }

  private _onElementTap(e: CustomEvent<{ elementId: string }>): void {
    this.shadowRoot?.querySelector('maxsen-link-mode')?.tap(e.detail.elementId);
  }

  override render(): TemplateResult {
    const toolbar =
      this.embedded || !this.panel
        ? nothing
        : html`<div class="header">
            ${this.narrow
              ? html`<ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>`
              : nothing}
            <div class="title">${this._home?.package?.project.title ?? 'Home'}</div>
          </div>`;
    return html`${toolbar}${this._renderBody()}`;
  }

  static override styles = css`
    :host {
      /* The sheets and dialogs of the quick panel and link tools cover the panel, not the page. */
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--secondary-background-color, #f4f5f7);
      color: var(--primary-text-color, #1f1d1a);
      font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    }
    .header {
      display: flex;
      align-items: center;
      flex: none;
      height: var(--header-height, 56px);
      padding: 0 12px;
      background: var(--app-header-background-color, var(--primary-color, #2f6fed));
      color: var(--app-header-text-color, var(--text-primary-color, #fff));
    }
    .title {
      margin-left: 8px;
      font-size: 20px;
      font-weight: 500;
    }
    .body {
      display: flex;
      flex: 1 1 auto;
      min-height: 0;
    }
    .body.stacked {
      flex-direction: column;
    }
    .body.side {
      flex-direction: row;
    }
    .view {
      /* The view sizes itself to its parent elsewhere; here the panel decides. */
      flex: 1 1 0;
      height: auto;
      min-width: 0;
      min-height: 0;
    }
    .quick-panel-slot {
      flex: none;
      overflow: auto;
    }
    .side .quick-panel-slot {
      width: 340px;
      border-left: 1px solid var(--divider-color, #e3e6ea);
    }
    .side.linking .quick-panel-slot {
      width: 380px;
    }
    .stacked .quick-panel-slot {
      max-height: 40%;
      border-top: 1px solid var(--divider-color, #e3e6ea);
    }
    .stacked.linking .quick-panel-slot {
      max-height: 55%;
    }
    .installer {
      min-height: 44px;
      padding: 0 20px;
      border: 1px solid var(--divider-color, #cfd3d9);
      border-radius: 22px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 16px;
      cursor: pointer;
    }
    .message {
      margin: auto;
      padding: 32px 24px;
      max-width: 420px;
      text-align: center;
      font-size: 17px;
      line-height: 1.6;
      color: var(--secondary-text-color, #5b6168);
    }
    .retry {
      display: block;
      min-height: 44px;
      margin: 16px auto 0;
      padding: 0 24px;
      border: 0;
      border-radius: 22px;
      background: var(--primary-color, #2f6fed);
      color: var(--text-primary-color, #fff);
      font: inherit;
      cursor: pointer;
    }
  `;
}

if (!customElements.get('maxsen-home-panel')) {
  customElements.define('maxsen-home-panel', MaxsenHomePanel);
}

declare global {
  interface HTMLElementTagNameMap {
    'maxsen-home-panel': MaxsenHomePanel;
  }
}
