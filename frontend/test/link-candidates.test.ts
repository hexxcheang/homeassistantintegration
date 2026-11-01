import { describe, expect, it } from 'vitest';
import { linkCandidates } from '../src/link-candidates.ts';
import { element, makeHass } from './helpers.ts';

const hass = makeHass({
  areas: { living: 'Living Room', bed: 'Bedroom' },
  devices: {
    d_curtain: { name: 'Curtain motor', area_id: 'living' },
    d_ac: { name: 'AC controller', area_id: 'bed' },
    d_sensor: { name: 'Door sensor', area_id: 'living' },
    d_cam: { name: 'Porch cam' },
    d_lock: { name: 'Front lock', area_id: 'living' },
    d_switch: { name: 'Entrance switch', name_by_user: 'Entry panel', area_id: 'living' },
    d_hub: { name: 'Hub' },
  },
  entities: {
    'light.dl_living': { area_id: 'living', name: 'Living downlight' },
    'light.dl_bed': { area_id: 'bed', name: 'Bed downlight' },
    'light.hall': { device_id: 'd_switch', name: 'Hall' },
    'switch.pump': { name: 'Pump' },
    'sensor.temp': { device_id: 'd_sensor' },
    'binary_sensor.door': { device_id: 'd_sensor' },
    'cover.curtain': { device_id: 'd_curtain' },
    'climate.ac': { device_id: 'd_ac' },
    'camera.porch': { device_id: 'd_cam' },
    'lock.front': { device_id: 'd_lock' },
    'switch.entry_1': { device_id: 'd_switch' },
    'fan.ceiling': { area_id: 'bed', name: 'Bedroom fan' },
  },
  states: {
    'light.dl_living': { state: 'on', attributes: { friendly_name: 'Living downlight' } },
    'light.dl_bed': { state: 'off' },
    'light.hall': { state: 'off' },
    'switch.pump': { state: 'off' },
    'sensor.temp': { state: '21' },
    'binary_sensor.door': { state: 'off' },
    'cover.curtain': { state: 'open' },
    'climate.ac': { state: 'cool' },
    'camera.porch': { state: 'idle' },
    'lock.front': { state: 'locked' },
    'switch.entry_1': { state: 'on' },
    'fan.ceiling': { state: 'off' },
    'light.yaml_only': { state: 'on', attributes: { friendly_name: 'Yaml light' } },
  },
});

const ids = (cs: ReturnType<typeof linkCandidates>) => cs.map((c) => c.link.id);

describe('linkCandidates', () => {
  it('offers a downlight only light and switch entities', () => {
    const cs = linkCandidates(element({ categoryId: 'downlights' }), hass);
    expect(ids(cs).sort()).toEqual(['light.dl_bed', 'light.dl_living', 'light.hall', 'light.yaml_only', 'switch.entry_1', 'switch.pump']);
    expect(cs.every((c) => c.link.type === 'entity')).toBe(true);
    expect(cs.every((c) => /^(light|switch)\./.test(c.link.id))).toBe(true);
  });

  it('offers a ceiling fan fan entities as well as lights and switches', () => {
    const cs = linkCandidates(element({ categoryId: 'ceiling-fans' }), hass);
    expect(ids(cs)).toContain('fan.ceiling');
    expect(ids(cs)).toContain('light.hall');
  });

  it('offers a curtain only devices that have a cover', () => {
    const cs = linkCandidates(element({ categoryId: 'curtains-blinds', kind: 'curtain' }), hass);
    expect(cs).toEqual([
      { link: { type: 'device', id: 'd_curtain' }, name: 'Curtain motor', area: 'Living Room' },
    ]);
  });

  it('offers aircon controllers devices with climate', () => {
    const cs = linkCandidates(element({ categoryId: 'aircon-controllers' }), hass);
    expect(ids(cs)).toEqual(['d_ac']);
  });

  it('offers sensors devices with a sensor or binary sensor', () => {
    const cs = linkCandidates(element({ categoryId: 'sensors' }), hass);
    expect(ids(cs)).toEqual(['d_sensor']);
  });

  it('offers cameras and locks the devices that have them', () => {
    expect(ids(linkCandidates(element({ categoryId: 'cameras' }), hass))).toEqual(['d_cam']);
    expect(ids(linkCandidates(element({ categoryId: 'smart-locks' }), hass))).toEqual(['d_lock']);
  });

  it('offers smart switches and control panels devices with a switch or light', () => {
    expect(ids(linkCandidates(element({ categoryId: 'smart-switches' }), hass))).toEqual(['d_switch']);
    expect(ids(linkCandidates(element({ categoryId: 'control-panels' }), hass))).toEqual(['d_switch']);
  });

  it('offers any other category every device', () => {
    const cs = linkCandidates(element({ categoryId: 'gateways' }), hass);
    expect(ids(cs).sort()).toEqual(Object.keys(hass.devices).sort());
  });

  it('names a device by its user name first and falls back to the id', () => {
    const named = linkCandidates(element({ categoryId: 'smart-switches' }), hass)[0];
    expect(named?.name).toBe('Entry panel');
    const bare = makeHass({ devices: { dx: {} } });
    expect(linkCandidates(element({ categoryId: 'gateways' }), bare)[0]?.name).toBe('dx');
  });

  it('names an entity by its registry name, then friendly name, then id; area falls back to the device', () => {
    const cs = linkCandidates(element({ categoryId: 'downlights' }), hass);
    const byId = Object.fromEntries(cs.map((c) => [c.link.id, c]));
    expect(byId['light.dl_living']?.name).toBe('Living downlight');
    expect(byId['light.yaml_only']?.name).toBe('Yaml light');
    expect(byId['light.hall']?.area).toBe('Living Room');
    expect(byId['switch.entry_1']?.name).toBe('switch.entry_1');
    expect(byId['light.dl_living']?.detail).toBe('light.dl_living');
  });

  it('sorts by area name, then name, with no-area entries last', () => {
    const cs = linkCandidates(element({ categoryId: 'gateways' }), hass);
    expect(cs.map((c) => `${c.area}|${c.name}`)).toEqual([
      'Bedroom|AC controller',
      'Living Room|Curtain motor',
      'Living Room|Door sensor',
      'Living Room|Entry panel',
      'Living Room|Front lock',
      '|Hub',
      '|Porch cam',
    ]);
  });
});
