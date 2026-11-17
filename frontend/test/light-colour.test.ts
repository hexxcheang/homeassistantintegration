import { describe, expect, it } from 'vitest';
import { lightColour } from '../src/light-colour.ts';
import type { HassState } from '../src/types.ts';

const on = (attributes: Record<string, unknown> = {}): HassState => ({ state: 'on', attributes });
const channels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

describe('lightColour', () => {
  it('uses an RGB colour as it is', () => {
    expect(lightColour([on({ rgb_color: [255, 0, 0], brightness: 255 })])).toEqual({ color: '#ff0000', level: 1 });
  });

  it('makes a warm white from a low colour temperature', () => {
    const [r, , b] = channels(lightColour([on({ color_temp_kelvin: 2700, brightness: 255 })]).color);
    expect(r).toBeGreaterThan(b);
  });

  it('makes a cool white from a high colour temperature', () => {
    const [r, , b] = channels(lightColour([on({ color_temp_kelvin: 6500, brightness: 255 })]).color);
    expect(b).toBeGreaterThanOrEqual(r * 0.9);
  });

  it('falls back to warm white without colour attributes', () => {
    expect(lightColour([on({ brightness: 255 })]).color).toBe('#ffb22e');
  });

  it('maps brightness 1 to 255 onto 0.35 to 1', () => {
    expect(lightColour([on({ brightness: 1 })]).level).toBeCloseTo(0.35, 10);
    expect(lightColour([on({ brightness: 255 })]).level).toBe(1);
    expect(lightColour([on({ brightness: 128 })]).level).toBeCloseTo(0.35 + (0.65 * 127) / 254, 10);
  });

  it('treats a missing brightness as full', () => {
    expect(lightColour([on({ rgb_color: [10, 20, 30] })]).level).toBe(1);
  });

  it('mixes several lights that are on, weighted by their level', () => {
    const states = [
      on({ rgb_color: [255, 0, 0], brightness: 255 }), // level 1
      on({ rgb_color: [0, 0, 255], brightness: 1 }), // level 0.35
    ];
    const [r, g, b] = channels(lightColour(states).color);
    expect(g).toBe(0);
    expect(r).toBe(Math.round((255 * 1) / 1.35));
    expect(b).toBe(Math.round((255 * 0.35) / 1.35));
  });

  it('ignores lights that are off or unavailable', () => {
    const states: HassState[] = [
      { state: 'off', attributes: { rgb_color: [0, 0, 255] } },
      { state: 'unavailable', attributes: {} },
      on({ rgb_color: [0, 255, 0], brightness: 255 }),
    ];
    expect(lightColour(states)).toEqual({ color: '#00ff00', level: 1 });
  });

  it('gives warm white at full level for no states, or none on', () => {
    expect(lightColour([])).toEqual({ color: '#ffb22e', level: 1 });
    expect(lightColour([{ state: 'off', attributes: {} }])).toEqual({ color: '#ffb22e', level: 1 });
  });
});
