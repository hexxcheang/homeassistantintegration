import { describe, expect, it } from 'vitest';
import { deviceEntities, errorMessage, linkName } from '../src/hass-util.ts';
import { makeHass } from './helpers.ts';

describe('errorMessage', () => {
  it('uses the message of a Home Assistant error as it is', () => {
    const revoked = { code: 'revoked', message: 'Connection revoked: ask Maxsen for a new pairing code' };
    expect(errorMessage(revoked)).toBe('Connection revoked: ask Maxsen for a new pairing code');
    expect(errorMessage(new Error('Plain'))).toBe('Plain');
  });

  it('falls back to a plain sentence when there is no message', () => {
    expect(errorMessage(undefined)).toBe('Something went wrong. Try again.');
    expect(errorMessage({ code: 'x' })).toBe('Something went wrong. Try again.');
    expect(errorMessage({ message: '' }, 'Nope')).toBe('Nope');
  });
});

describe('linkName', () => {
  const hass = makeHass({
    devices: { d1: { name: 'Hall switch' }, d2: { name: 'Switch', name_by_user: 'Porch' } },
    entities: { 'switch.a': { name: 'Registry name' }, 'switch.b': {} },
    states: {
      'switch.a': { state: 'on' },
      'switch.b': { state: 'on', attributes: { friendly_name: 'Friendly' } },
    },
  });

  it('names devices after the name the user gave, else their own', () => {
    expect(linkName({ type: 'device', id: 'd1' }, hass)).toBe('Hall switch');
    expect(linkName({ type: 'device', id: 'd2' }, hass)).toBe('Porch');
  });

  it('names entities after their friendly name, else the registry name', () => {
    expect(linkName({ type: 'entity', id: 'switch.b' }, hass)).toBe('Friendly');
    expect(linkName({ type: 'entity', id: 'switch.a' }, hass)).toBe('Registry name');
  });

  it('is undefined for something Home Assistant no longer has', () => {
    expect(linkName({ type: 'entity', id: 'switch.gone' }, hass)).toBeUndefined();
    expect(linkName({ type: 'device', id: 'gone' }, hass)).toBeUndefined();
  });
});

describe('deviceEntities', () => {
  it('leaves out config, diagnostic and hidden entities: they are settings, not the device', () => {
    const hass = makeHass({
      devices: { d1: {} },
      entities: {
        'switch.gang1': { device_id: 'd1' },
        'switch.gang2': { device_id: 'd1', entity_category: null, hidden: false },
        'switch.backlight': { device_id: 'd1', entity_category: 'config' },
        'lock.child_lock': { device_id: 'd1', entity_category: 'config' },
        'sensor.rssi': { device_id: 'd1', entity_category: 'diagnostic' },
        'switch.hidden': { device_id: 'd1', hidden: true },
        'switch.other': { device_id: 'd2' },
      },
    });
    expect(deviceEntities(hass, 'd1').map((e) => e.entity_id)).toEqual(['switch.gang1', 'switch.gang2']);
  });
});
