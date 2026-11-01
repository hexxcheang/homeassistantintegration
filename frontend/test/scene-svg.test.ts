import { describe, expect, it } from 'vitest';
import { sceneToSvg, type SvgNode } from '../src/scene-svg.ts';
import type { Scene, SceneMarker, ScenePath } from '../src/types.ts';
import { home } from './helpers.ts';

const marker = (overrides: Partial<SceneMarker> = {}): SceneMarker => ({
  type: 'marker',
  elementId: 'm1',
  z: 1,
  categoryId: 'downlights',
  shape: 'circle',
  x: 100,
  y: 200,
  rotation: 90,
  size: 20,
  color: '#D28A00',
  badgeStyle: 'filled',
  badge: { text: 'DL', color: '#1F1D1A', dx: 0, dy: 0, fontSize: 8.4 },
  pathD: 'M-0.5 -0.5 H0.5 V0.5 H-0.5 Z',
  ...overrides,
});

const curtain: ScenePath = {
  type: 'path',
  elementId: 'c1',
  z: 2,
  categoryId: 'curtains-blinds',
  kind: 'curtain',
  shape: 'curtain',
  d: 'M600 80 L860 80',
  points: [
    { x: 600, y: 80 },
    { x: 860, y: 80 },
  ],
  closed: false,
  smooth: false,
  strokeWidth: 6.6,
  color: '#177A68',
  dash: [0.001, 12.54],
  heads: [],
  label: { text: 'S. Curtains', x: 730, y: 80, fontSize: 10 },
};

const sceneOf = (...items: Scene['items']): Scene => ({ width: 1000, height: 800, items, legend: [] });

/** Every node in the tree, depth first. */
function all(nodes: SvgNode[]): SvgNode[] {
  return nodes.flatMap((n) => [n, ...all(n.children ?? [])]);
}

describe('sceneToSvg markers', () => {
  it('translates, rotates and scales the icon path', () => {
    const [group] = sceneToSvg(sceneOf(marker()));
    expect(group?.tag).toBe('g');
    expect(group?.elementId).toBe('m1');
    const icon = group?.children?.find((n) => n.tag === 'path' && n.attrs['d']?.startsWith('M-0.5'));
    expect(icon?.attrs['transform']).toBe('translate(100 200) rotate(90) scale(20)');
    expect(icon?.attrs['d']).toBe('M-0.5 -0.5 H0.5 V0.5 H-0.5 Z');
  });

  it('fills a filled badge style and outlines the other', () => {
    const iconOf = (m: SceneMarker) => sceneToSvg(sceneOf(m))[0]?.children?.[0];
    const filled = iconOf(marker());
    expect(filled?.attrs['fill']).toBe('#D28A00');
    expect(filled?.attrs['fill-rule']).toBe('evenodd');
    const outline = iconOf(marker({ badgeStyle: 'outline' }));
    expect(outline?.attrs['fill']).toBe('#FFFFFF');
    expect(outline?.attrs['stroke']).toBe('#D28A00');
  });

  it('draws the badge as text in the badge colour, rotating with the icon', () => {
    const [group] = sceneToSvg(sceneOf(marker({ badge: { text: 'DL', color: '#123456', dx: 2, dy: 3, fontSize: 8 } })));
    const badge = group?.children?.find((n) => n.tag === 'text');
    expect(badge?.text).toBe('DL');
    expect(badge?.attrs['fill']).toBe('#123456');
    expect(badge?.attrs['font-size']).toBe('8');
    expect(badge?.attrs['transform']).toBe('translate(100 200) rotate(90)');
    expect(badge?.attrs['x']).toBe('2');
    expect(badge?.attrs['y']).toBe('3');
  });

  it('omits the badge text node when the badge is empty', () => {
    const [group] = sceneToSvg(sceneOf(marker({ badge: { text: '', color: '#000', dx: 0, dy: 0, fontSize: 8 } })));
    expect(group?.children?.some((n) => n.tag === 'text')).toBe(false);
  });

  it('draws a label upright at its own position', () => {
    const [group] = sceneToSvg(sceneOf(marker({ label: { text: 'Entrance', x: 100, y: 217, fontSize: 10 } })));
    const label = group?.children?.find((n) => n.text === 'Entrance');
    expect(label?.tag).toBe('text');
    expect(label?.attrs['x']).toBe('100');
    expect(label?.attrs['transform']).toBeUndefined();
    expect(label?.attrs['text-anchor']).toBe('middle');
  });
});

describe('sceneToSvg paths', () => {
  it('keeps the dot pattern of a dashed curtain and rounds its caps', () => {
    const [group] = sceneToSvg(sceneOf(curtain));
    expect(group?.elementId).toBe('c1');
    const line = group?.children?.find((n) => n.attrs['stroke'] === '#177A68');
    expect(line?.attrs['d']).toBe('M600 80 L860 80');
    expect(line?.attrs['stroke-dasharray']).toBe('0.001 12.54');
    expect(line?.attrs['stroke-linecap']).toBe('round');
    expect(line?.attrs['stroke-width']).toBe('6.6');
    expect(line?.attrs['fill']).toBe('none');
  });

  it('draws a solid path without a dash pattern', () => {
    const strip: ScenePath = { ...curtain, kind: 'led-strip', dash: undefined, label: undefined };
    delete strip.dash;
    const [group] = sceneToSvg(sceneOf(strip));
    const line = group?.children?.find((n) => n.attrs['stroke'] === '#177A68');
    expect(line?.attrs['stroke-dasharray']).toBeUndefined();
  });

  it('gives a path a wide transparent hit area so a thin line can be tapped', () => {
    const [group] = sceneToSvg(sceneOf(curtain));
    const hit = group?.children?.find((n) => n.attrs['stroke'] === 'transparent');
    expect(hit?.attrs['d']).toBe('M600 80 L860 80');
    expect(Number(hit?.attrs['stroke-width'])).toBeGreaterThanOrEqual(12);
  });

  it('draws track heads as shapes rotated to the track', () => {
    const track: ScenePath = {
      ...curtain,
      kind: 'track',
      shape: 'track',
      dash: undefined,
      label: undefined,
      heads: [{ x: 10, y: 20, angle: 45, size: 12 }],
    };
    delete track.dash;
    const [group] = sceneToSvg(sceneOf(track));
    const head = group?.children?.find((n) => n.attrs['transform']?.startsWith('translate(10 20)'));
    expect(head?.attrs['transform']).toBe('translate(10 20) rotate(45) scale(12)');
    expect(head?.attrs['fill']).toBe('#177A68');
  });

  it('puts a path label in a text node', () => {
    const [group] = sceneToSvg(sceneOf(curtain));
    const label = group?.children?.find((n) => n.tag === 'text');
    expect(label?.text).toBe('S. Curtains');
    expect(label?.attrs['x']).toBe('730');
  });
});

describe('sceneToSvg notes', () => {
  it('draws a plain note as text', () => {
    const [group] = sceneToSvg(
      sceneOf({
        type: 'note', elementId: 'n1', z: 3, x: 500, y: 420, text: 'Hub goes in the DB closet',
        fontSize: 16, bold: false, color: '#000000', highlight: null,
      }),
    );
    expect(group?.elementId).toBe('n1');
    expect(group?.children?.filter((n) => n.tag === 'text').map((n) => n.text)).toEqual(['Hub goes in the DB closet']);
    expect(group?.children?.some((n) => n.tag === 'path')).toBe(false);
  });

  it('puts a highlight behind the text and splits lines', () => {
    const [group] = sceneToSvg(
      sceneOf({
        type: 'note', elementId: 'n1', z: 3, x: 500, y: 420, text: 'one\ntwo',
        fontSize: 10, bold: true, color: '#111111', highlight: '#FFFF00',
      }),
    );
    expect(group?.children?.[0]?.tag).toBe('path');
    expect(group?.children?.[0]?.attrs['fill']).toBe('#FFFF00');
    const lines = group?.children?.filter((n) => n.tag === 'text');
    expect(lines?.map((n) => n.text)).toEqual(['one', 'two']);
    expect(lines?.[0]?.attrs['font-weight']).toBe('600');
  });
});

describe('sceneToSvg with the planner fixture', () => {
  it('produces one top-level node per scene item, in order, tagged with its element id', () => {
    const plan = home.levels[0]!.plans[0]!;
    const nodes = sceneToSvg(plan.scene);
    expect(nodes.map((n) => n.elementId)).toEqual(plan.scene.items.map((i) => i.elementId));
    const curtainNode = nodes.find((n) => n.elementId === 'cur1');
    const dashed = all([curtainNode!]).find((n) => n.attrs['stroke-dasharray']);
    expect(dashed?.attrs['stroke-dasharray']).toBe('0.001 12.54');
    const sw = nodes.find((n) => n.elementId === 'sw1');
    expect(all([sw!]).some((n) => n.text === 'Entrance switch')).toBe(true);
  });
});
