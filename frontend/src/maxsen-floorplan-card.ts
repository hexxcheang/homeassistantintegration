import { LitElement, css, html, type TemplateResult } from 'lit';
import './maxsen-home-panel.ts';
import type { HassLike } from './types.ts';

interface CardConfig {
  entry_id?: string;
}

/** The floor plan as a dashboard card. Shows the first Maxsen home unless `entry_id` is set. */
export class MaxsenFloorplanCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _panel: { state: true },
  };

  declare hass: HassLike | undefined;
  /** In the shape the panel element expects, and kept stable so the panel is not restarted. */
  declare private _panel: { config: CardConfig };

  constructor() {
    super();
    this._panel = { config: {} };
  }

  setConfig(config: CardConfig): void {
    if (config.entry_id !== undefined && typeof config.entry_id !== 'string') {
      throw new Error('entry_id must be text');
    }
    this._panel = { config: config.entry_id === undefined ? {} : { entry_id: config.entry_id } };
  }

  getCardSize(): number {
    return 8;
  }

  static getStubConfig(): CardConfig {
    return {};
  }

  override render(): TemplateResult {
    return html`<maxsen-home-panel embedded .hass=${this.hass} .panel=${this._panel}></maxsen-home-panel>`;
  }

  static override styles = css`
    :host {
      display: block;
      height: min(560px, 80vh);
      overflow: hidden;
      border-radius: var(--ha-card-border-radius, 12px);
      background: var(--ha-card-background, var(--card-background-color, #fff));
      box-shadow: var(--ha-card-box-shadow, none);
      border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e3e6ea));
    }
  `;
}

if (!customElements.get('maxsen-floorplan-card')) {
  customElements.define('maxsen-floorplan-card', MaxsenFloorplanCard);
}

declare global {
  interface HTMLElementTagNameMap {
    'maxsen-floorplan-card': MaxsenFloorplanCard;
  }
  interface Window {
    customCards?: { type: string; name: string; description: string; preview?: boolean }[];
  }
}

window.customCards = window.customCards ?? [];
if (!window.customCards.some((c) => c.type === 'maxsen-floorplan-card')) {
  window.customCards.push({
    type: 'maxsen-floorplan-card',
    name: 'Maxsen floor plan',
    description: 'The floor plans of your Maxsen home, with live device state.',
    preview: false,
  });
}
