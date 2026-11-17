import type { HassState } from './types.ts';

/** The colour of a warm white light, used when a light reports no colour. */
const WARM_WHITE = '#ffb22e';
/** A light at its lowest brightness still shows up. */
const LEVEL_FLOOR = 0.35;

type Rgb = [number, number, number];

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function hex(rgb: Rgb): string {
  return `#${rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(color: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) as Rgb;
}

/** An approximate colour of white light at `kelvin` (the usual black-body fit, 1000 to 40000 K). */
function kelvinToRgb(kelvin: number): Rgb {
  const t = clamp(kelvin, 1000, 40000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function rgbOf(attributes: Record<string, unknown>): Rgb {
  const rgb = attributes['rgb_color'];
  if (Array.isArray(rgb) && rgb.length >= 3 && rgb.slice(0, 3).every(isNumber)) {
    return rgb.slice(0, 3).map((c) => clamp(c as number, 0, 255)) as Rgb;
  }
  const kelvin = attributes['color_temp_kelvin'];
  if (isNumber(kelvin) && kelvin > 0) return kelvinToRgb(kelvin);
  return parseHex(WARM_WHITE);
}

/** Brightness 1 to 255 onto 0.35 to 1; a light that reports none is at full. */
function levelOf(attributes: Record<string, unknown>): number {
  const brightness = attributes['brightness'];
  if (!isNumber(brightness)) return 1;
  return LEVEL_FLOOR + ((1 - LEVEL_FLOOR) * (clamp(brightness, 1, 255) - 1)) / 254;
}

/**
 * The glow of a group of lights: the colour of the ones that are on, mixed in proportion to how
 * bright each is, and the brightest level among them. Warm white at full level when none is on.
 */
export function lightColour(states: readonly HassState[]): { color: string; level: number } {
  let weight = 0;
  let level = 0;
  const sum: Rgb = [0, 0, 0];
  for (const { state, attributes } of states) {
    if (state !== 'on') continue;
    const own = levelOf(attributes);
    const rgb = rgbOf(attributes);
    for (let i = 0; i < 3; i++) sum[i] = (sum[i] as number) + (rgb[i] as number) * own;
    weight += own;
    level = Math.max(level, own);
  }
  if (weight === 0) return { color: WARM_WHITE, level: 1 };
  return { color: hex(sum.map((c) => c / weight) as Rgb), level };
}
