import { describe, expect, it } from 'vitest';
import { visualState } from '../src/visual-state.ts';
import type { Link } from '../src/types.ts';
import { element, makeHass } from './helpers.ts';

const entityLink = (id: string): Link => ({ type: 'entity', id });
const deviceLink = (id: string): Link => ({ type: 'device', id });
const light = element({ categoryId: 'downlights' });

describe('visualState: links', () => {
  it('is unlinked without a link', () => {
    expect(visualState(light, undefined, makeHass())).toEqual({ status: 'unlinked' });
  });

  it('is missing when the linked entity is gone from Home Assistant', () => {
    const hass = makeHass({ states: { 'light.other': { state: 'on' } } });
    expect(visualState(light, entityLink('light.deleted'), hass)).toEqual({ status: 'missing' });
  });

  it('is missing when the linked device is gone', () => {
    const hass = makeHass({ devices: { d2: {} } });
    expect(visualState(element(), deviceLink('d1'), hass)).toEqual({ status: 'missing' });
  });

  it('is unavailable (not missing) when the entity exists but is unavailable or unknown', () => {
    const hass = makeHass({
      states: { 'light.a': { state: 'unavailable' }, 'light.b': { state: 'unknown' } },
    });
    expect(visualState(light, entityLink('light.a'), hass)).toEqual({ status: 'unavailable' });
    expect(visualState(light, entityLink('light.b'), hass)).toEqual({ status: 'unavailable' });
  });

  it('is unavailable when every entity of a device is unavailable or unknown', () => {
    const hass = makeHass({
      devices: { d1: {} },
      entities: { 'switch.a': { device_id: 'd1' }, 'sensor.b': { device_id: 'd1' } },
      states: { 'switch.a': { state: 'unavailable' }, 'sensor.b': { state: 'unknown' } },
    });
    expect(visualState(element(), deviceLink('d1'), hass)).toEqual({ status: 'unavailable' });
  });

  it('ignores unavailable entities when others of the device still work', () => {
    const hass = makeHass({
      devices: { d1: {} },
      entities: { 'switch.a': { device_id: 'd1' }, 'light.b': { device_id: 'd1' } },
      states: { 'switch.a': { state: 'unavailable' }, 'light.b': { state: 'on' } },
    });
    expect(visualState(element(), deviceLink('d1'), hass).status).toBe('on');
  });

  it('is idle for a device with nothing worth showing', () => {
    const hass = makeHass({
      devices: { d1: {} },
      entities: { 'update.fw': { device_id: 'd1' }, 'button.identify': { device_id: 'd1' } },
      states: { 'update.fw': { state: 'on' }, 'button.identify': { state: 'unknown' } },
    });
    expect(visualState(element(), deviceLink('d1'), hass)).toEqual({ status: 'idle' });
  });
});

describe('visualState: lights and switches', () => {
  it('is on when the entity is on and off otherwise', () => {
    const hass = makeHass({ states: { 'light.a': { state: 'on' }, 'light.b': { state: 'off' } } });
    expect(visualState(light, entityLink('light.a'), hass).status).toBe('on');
    expect(visualState(light, entityLink('light.b'), hass).status).toBe('off');
  });

  it('is on when any entity of a device is on', () => {
    const hass = makeHass({
      devices: { d1: {} },
      entities: {
        'switch.g1': { device_id: 'd1' },
        'switch.g2': { device_id: 'd1' },
        'switch.other': { device_id: 'd2' },
      },
      states: {
        'switch.g1': { state: 'off' },
        'switch.g2': { state: 'on' },
        'switch.other': { state: 'off' },
      },
    });
    expect(visualState(element(), deviceLink('d1'), hass).status).toBe('on');
  });

  it('is off when all entities of a device are off', () => {
    const hass = makeHass({
      devices: { d1: {} },
      entities: { 'switch.g1': { device_id: 'd1' }, 'light.g2': { device_id: 'd1' } },
      states: { 'switch.g1': { state: 'off' }, 'light.g2': { state: 'off' } },
    });
    expect(visualState(element(), deviceLink('d1'), hass).status).toBe('off');
  });

  it('follows the gangs only, not a config backlight or child lock on the same device', () => {
    // A Zigbee2MQTT Tuya 2-gang switch: backlight is a config switch, child lock a config lock.
    const hass = makeHass({
      devices: { d1: {} },
      entities: {
        'switch.gang1': { device_id: 'd1' },
        'switch.gang2': { device_id: 'd1' },
        'switch.backlight': { device_id: 'd1', entity_category: 'config' },
        'lock.child_lock': { device_id: 'd1', entity_category: 'config' },
      },
      states: {
        'switch.gang1': { state: 'off' },
        'switch.gang2': { state: 'off' },
        'switch.backlight': { state: 'on' },
        'lock.child_lock': { state: 'unlocked' },
      },
    });
    expect(visualState(element(), deviceLink('d1'), hass)).toEqual({ status: 'off' });
  });

  it('treats a fan like a light', () => {
    const hass = makeHass({ states: { 'fan.a': { state: 'on' } } });
    expect(visualState(element({ categoryId: 'ceiling-fans' }), entityLink('fan.a'), hass).status).toBe('on');
  });
});

describe('visualState: covers', () => {
  const cover = element({ categoryId: 'curtains-blinds', kind: 'curtain' });
  const withCover = (state: string, attributes: Record<string, unknown> = {}) =>
    makeHass({
      devices: { d1: {} },
      entities: { 'cover.c': { device_id: 'd1' } },
      states: { 'cover.c': { state, attributes } },
    });

  it('shows the position and Open for a fully open cover', () => {
    expect(visualState(cover, deviceLink('d1'), withCover('open', { current_position: 100 }))).toEqual({
      status: 'on', position: 100, text: 'Open',
    });
  });

  it('shows Closed at position 0', () => {
    expect(visualState(cover, deviceLink('d1'), withCover('closed', { current_position: 0 }))).toEqual({
      status: 'off', position: 0, text: 'Closed',
    });
  });

  it('shows the percentage in between', () => {
    expect(visualState(cover, deviceLink('d1'), withCover('open', { current_position: 40 }))).toEqual({
      status: 'on', position: 40, text: '40%',
    });
  });

  it('falls back to the state when there is no position', () => {
    expect(visualState(cover, deviceLink('d1'), withCover('open'))).toEqual({ status: 'on', text: 'Open' });
    expect(visualState(cover, deviceLink('d1'), withCover('closed'))).toEqual({ status: 'off', text: 'Closed' });
  });
});

describe('visualState: sensors', () => {
  const sensors = element({ categoryId: 'sensors' });
  const door = (state: string, device_class?: string) =>
    makeHass({
      devices: { d1: {} },
      entities: { 'binary_sensor.x': { device_id: 'd1' } },
      states: { 'binary_sensor.x': { state, attributes: device_class ? { device_class } : {} } },
    });

  it.each(['door', 'window', 'motion', 'occupancy', 'smoke', 'moisture', 'gas'])(
    'alerts when a %s binary sensor is on',
    (cls) => {
      expect(visualState(sensors, deviceLink('d1'), door('on', cls)).status).toBe('alert');
    },
  );

  it('is idle when an alerting binary sensor is off', () => {
    expect(visualState(sensors, deviceLink('d1'), door('off', 'door')).status).toBe('idle');
  });

  it('does not alert for a binary sensor of another class', () => {
    expect(visualState(sensors, deviceLink('d1'), door('on', 'plug')).status).toBe('on');
  });

  it('shows a sensor as idle with its value and unit', () => {
    const hass = makeHass({
      states: { 'sensor.t': { state: '21.5', attributes: { unit_of_measurement: '°C' } } },
    });
    expect(visualState(sensors, entityLink('sensor.t'), hass)).toEqual({ status: 'idle', text: '21.5 °C' });
  });

  it('shows a sensor without a unit as its bare state', () => {
    const hass = makeHass({ states: { 'sensor.t': { state: 'Clear' } } });
    expect(visualState(sensors, entityLink('sensor.t'), hass).text).toBe('Clear');
  });

  it('prefers an alert over the sensor reading on a device with both', () => {
    const hass = makeHass({
      devices: { d1: {} },
      entities: { 'binary_sensor.m': { device_id: 'd1' }, 'sensor.lux': { device_id: 'd1' } },
      states: {
        'binary_sensor.m': { state: 'on', attributes: { device_class: 'motion' } },
        'sensor.lux': { state: '40', attributes: { unit_of_measurement: 'lx' } },
      },
    });
    expect(visualState(sensors, deviceLink('d1'), hass).status).toBe('alert');
  });

  it('shows the reading, not the battery, for a quiet sensor device', () => {
    const hass = makeHass({
      devices: { d1: {} },
      entities: {
        'binary_sensor.m': { device_id: 'd1' },
        'sensor.battery': { device_id: 'd1' },
        'sensor.lux': { device_id: 'd1' },
      },
      states: {
        'binary_sensor.m': { state: 'off', attributes: { device_class: 'motion' } },
        'sensor.battery': { state: '90', attributes: { unit_of_measurement: '%', device_class: 'battery' } },
        'sensor.lux': { state: '40', attributes: { unit_of_measurement: 'lx' } },
      },
    });
    expect(visualState(sensors, deviceLink('d1'), hass)).toEqual({ status: 'idle', text: '40 lx' });
  });
});

describe('visualState: climate, locks and others', () => {
  it('shows the HVAC mode and current temperature', () => {
    const hass = makeHass({
      devices: { d1: {} },
      entities: { 'climate.ac': { device_id: 'd1' } },
      states: { 'climate.ac': { state: 'cool', attributes: { current_temperature: 24 } } },
    });
    expect(visualState(element({ categoryId: 'aircon-controllers' }), deviceLink('d1'), hass)).toEqual({
      status: 'on', text: 'cool · 24°',
    });
  });

  it('is off when the climate is off', () => {
    const hass = makeHass({ states: { 'climate.ac': { state: 'off', attributes: { current_temperature: 27 } } } });
    expect(visualState(element(), entityLink('climate.ac'), hass)).toEqual({ status: 'off', text: 'off · 27°' });
  });

  it('shows just the mode when no temperature is reported', () => {
    const hass = makeHass({ states: { 'climate.ac': { state: 'heat' } } });
    expect(visualState(element(), entityLink('climate.ac'), hass).text).toBe('heat');
  });

  it('shows a lock', () => {
    const lock = element({ categoryId: 'smart-locks' });
    const hass = makeHass({
      states: { 'lock.a': { state: 'locked' }, 'lock.b': { state: 'unlocked' }, 'lock.c': { state: 'jammed' } },
    });
    expect(visualState(lock, entityLink('lock.a'), hass)).toEqual({ status: 'off', text: 'Locked' });
    expect(visualState(lock, entityLink('lock.b'), hass)).toEqual({ status: 'on', text: 'Unlocked' });
    expect(visualState(lock, entityLink('lock.c'), hass)).toEqual({ status: 'alert', text: 'Jammed' });
  });

  it('shows a camera as idle with its state', () => {
    const hass = makeHass({
      devices: { d1: {} },
      entities: { 'camera.porch': { device_id: 'd1' } },
      states: { 'camera.porch': { state: 'recording' } },
    });
    expect(visualState(element({ categoryId: 'cameras' }), deviceLink('d1'), hass)).toEqual({
      status: 'idle', text: 'recording',
    });
  });
});
