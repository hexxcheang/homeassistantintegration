import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { findEntry, getHome, subscribe } from './api.ts';
import './floorplan-view.ts';
import './link-mode.ts';
import './quick-panel.ts';
import type { HassConnection, HassLike, HomeResponse } from './types.ts';

/** Floor plan and quick panel sit side by side when the space is landscape and this wide. */
const SIDE_BY_SIDE_MIN_WIDTH = 900;

const NO_SELECTION: string[] = [];

/** How long to wait before loading again after a failed load or subscribe: 2 s, 5 s, 10 s, then every 30 s. */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
const RETRY_EVERY_MS = 30_000;

/**
 * Maxsen is not ready to answer yet (its entry is still loading, or its commands are not registered):
 * Home Assistant is starting. Unlike other failures this is shown as a wait, not an error.
 */
class StillStarting extends Error {}

/** A websocket error that means "no such Maxsen home or command (yet)". */
function isNotReady(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return code === 'not_found' || code === 'unknown_command';
}

export function retryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[attempt] ?? RETRY_EVERY_MS;
}

/** End a subscription without caring whether it still exists (after a reconnect it may not). */
function release(unsubscribe: (() => void | Promise<void>) | undefined): void {
  try {
    void Promise.resolve(unsubscribe?.()).catch(() => undefined);
  } catch {
    // Already gone.
  }
}

export type PanelLayout = 'side' | 'stacked';

export function layoutFor(width: number, height: number): PanelLayout {
  return width >= SIDE_BY_SIDE_MIN_WIDTH && width > height ? 'side' : 'stacked';
}

type Status = 'loading' | 'starting' | 'ready' | 'none' | 'error';

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
  /** The entry id the card or panel was configured with when the current run started, if any. */
  private _configuredEntryId: string | undefined;
  private _started = false;
  /** Bumped on every stop, so a load that finishes late can tell it is no longer wanted. */
  private _run = 0;
  private _unsubscribe: (() => void | Promise<void>) | undefined;
  private _observer: ResizeObserver | undefined;
  /** Failed loads in a row, for the retry delay. */
  private _attempt = 0;
  private _retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** The connection whose `ready` (reconnected) event this panel listens to. */
  private _connection: HassConnection | undefined;

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
    if (this.hass) this._listen(this.hass.connection);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._observer?.disconnect();
    this._observer = undefined;
    this._listen(undefined);
    this._stop();
  }

  /**
   * After Home Assistant restarts, the websocket reconnects but the maxsen subscription is gone
   * (or is refused while Maxsen is still loading). On `ready` the panel loads and subscribes again.
   */
  private _onReconnect = (): void => {
    if (!this._started) return;
    this._attempt = 0;
    this._resubscribe();
  };

  private _listen(connection: HassConnection | undefined): void {
    if (connection === this._connection) return;
    this._connection?.removeEventListener?.('ready', this._onReconnect);
    this._connection = connection;
    connection?.addEventListener?.('ready', this._onReconnect);
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
    if (this.isConnected) this._listen(this.hass.connection);
    // The card can be pointed at another home while it is on screen. Home Assistant also hands the
    // panel a new `panel` object after a reconnect; only a different configured id restarts.
    if (
      this._started &&
      changed.has('panel') &&
      this.panel?.config?.entry_id !== this._configuredEntryId
    ) {
      this._stop();
    }
    if (!this._started) void this._start();
  }

  private _stop(): void {
    this._run++;
    this._started = false;
    this._attempt = 0;
    clearTimeout(this._retryTimer);
    this._retryTimer = undefined;
    release(this._unsubscribe);
    this._unsubscribe = undefined;
  }

  /**
   * Load and subscribe again, keeping what is on screen meanwhile. Only called once the old
   * subscription is gone with its connection (a reconnect, or a retry after nothing was
   * subscribed), so its unsubscribe function is dropped, not called: it would name an id the
   * server no longer knows.
   */
  private _resubscribe(): void {
    const attempt = this._attempt;
    this._unsubscribe = undefined;
    this._stop();
    this._attempt = attempt;
    void this._start(true);
  }

  /** `quiet` keeps showing the current home (or error) instead of "Loading…". */
  private async _start(quiet = false): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this._started = true;
    const run = this._run;
    this._configuredEntryId = this.panel?.config?.entry_id;
    if (!quiet) this._status = 'loading';
    try {
      let entryId = this._configuredEntryId;
      if (!entryId) {
        const entry = await findEntry(hass);
        if (run !== this._run) return;
        if (!entry) {
          // After a reconnect or retry with a home on screen, "no entry" is retry-later too: keep it.
          if (quiet && this._home) throw new Error('No Maxsen entry listed yet');
          this._entryId = undefined;
          this._status = 'none';
          return;
        }
        // Listed but not loaded: Maxsen is still starting. Try again rather than say it is missing.
        if (entry.state !== 'loaded') throw new StillStarting(`Maxsen is ${entry.state}`);
        entryId = entry.entryId;
      }
      this._entryId = entryId;
      const home = await getHome(hass, entryId).catch((err: unknown) => {
        throw isNotReady(err) ? new StillStarting('Maxsen is not answering yet') : err;
      });
      if (run !== this._run) return;
      this._home = home;
      this._status = 'ready';
      const unsubscribe = await subscribe(hass, entryId, () => void this._reload(run));
      if (run !== this._run) {
        release(unsubscribe);
        return;
      }
      this._unsubscribe = unsubscribe;
      this._attempt = 0;
    } catch (err) {
      if (run !== this._run) return;
      // A quiet retry keeps showing the home we have; otherwise say it could not be loaded, or that
      // Home Assistant is starting while the waits are still short (2, 5, 10 s). Either way try
      // again by itself: right after a restart Maxsen may still be loading.
      if (!quiet || !this._home) {
        this._status = err instanceof StillStarting && this._attempt < RETRY_DELAYS_MS.length ? 'starting' : 'error';
      }
      this._retryTimer = setTimeout(() => {
        this._retryTimer = undefined;
        if (run === this._run) this._resubscribe();
      }, retryDelay(this._attempt++));
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
      case 'starting':
        return html`<div class="message">Home Assistant is starting…</div>`;
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
