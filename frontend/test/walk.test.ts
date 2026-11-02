import { describe, expect, it } from 'vitest';
import { buildQueue, Walk } from '../src/walk.ts';
import type { CategoryId, HomeElement, HomeResponse, Link, SceneItem, StoredHomePackage } from '../src/types.ts';
import { element } from './helpers.ts';
import { homeResponse } from './view-helpers.ts';

const link = (id: string): Link => ({ type: 'device', id });

const ids = (steps: { elementId: string }[]) => steps.map((s) => s.elementId);

/** The fixture's order: Level 1 smart-home top to bottom, then its lights, then Level 2. */
const FIXTURE_ORDER = ['cur1', 'sen1', 'sw1', 'dl1', 'dl2', 'dl3', 'led1', 'sen2'];

function withLinks(links: Record<string, Link>): HomeResponse {
  return homeResponse({ links });
}

/** A home with one smart-home plan per level made from (element, position) rows. */
function customHome(
  levels: {
    name: string;
    sortOrder: number;
    rows: { el: HomeElement; at?: { x: number; y: number } | { points: { x: number; y: number }[] } }[];
  }[],
  links: Record<string, Link> = {},
): HomeResponse {
  const base = homeResponse({ links });
  const pkg = base.package as StoredHomePackage;
  const customLevels = levels.map((lv, i) => {
    const items: SceneItem[] = [];
    for (const r of lv.rows) {
      if (!r.at) continue;
      if ('points' in r.at) {
        items.push({ type: 'path', elementId: r.el.id, points: r.at.points } as unknown as SceneItem);
      } else {
        items.push({ type: 'marker', elementId: r.el.id, x: r.at.x, y: r.at.y } as unknown as SceneItem);
      }
    }
    return {
      id: `lv${i}`,
      name: lv.name,
      sortOrder: lv.sortOrder,
      plans: [
        {
          id: `plan${i}`,
          type: 'smart-home' as const,
          revision: 1,
          width: 1000,
          height: 700,
          background: { imageId: 'x', key: 'x' },
          scene: { width: 1000, height: 700, items, legend: [] },
          elements: lv.rows.map((r) => r.el),
        },
      ],
    };
  });
  return { ...base, package: { ...pkg, levels: customLevels } };
}

function el(id: string, categoryId: CategoryId = 'smart-switches', extra: Partial<HomeElement> = {}) {
  return element({ id, categoryId, ...extra });
}

describe('buildQueue', () => {
  it('orders the fixture by level, non-lighting before lighting, top to bottom then left to right', () => {
    expect(ids(buildQueue(homeResponse()))).toEqual(FIXTURE_ORDER);
  });

  it('is empty without a package', () => {
    expect(buildQueue(homeResponse({ package: null }))).toEqual([]);
  });

  it('holds only unlinked elements (any link type counts as linked)', () => {
    const q = buildQueue(withLinks({ sen1: link('d1'), dl2: { type: 'entity', id: 'light.x' } }));
    expect(ids(q)).toEqual(['cur1', 'sw1', 'dl1', 'dl3', 'led1', 'sen2']);
  });

  it('orders levels by sortOrder, not by package position', () => {
    const home = customHome([
      { name: 'Upstairs', sortOrder: 2, rows: [{ el: el('up'), at: { x: 10, y: 10 } }] },
      { name: 'Ground', sortOrder: 1, rows: [{ el: el('gr'), at: { x: 900, y: 900 } }] },
    ]);
    expect(ids(buildQueue(home))).toEqual(['gr', 'up']);
  });

  it('sorts by y, then x; a path uses the midpoint of its points', () => {
    const home = customHome([
      {
        name: 'L',
        sortOrder: 1,
        rows: [
          { el: el('right'), at: { x: 500, y: 100 } },
          { el: el('low'), at: { x: 10, y: 300 } },
          { el: el('left'), at: { x: 100, y: 100 } },
          {
            el: el('curtain', 'curtains-blinds'),
            at: {
              points: [
                { x: 0, y: 190 },
                { x: 1000, y: 210 },
              ],
            },
          },
        ],
      },
    ]);
    expect(ids(buildQueue(home))).toEqual(['left', 'right', 'curtain', 'low']);
  });

  it('puts elements that are not drawn last in their group, in package order', () => {
    const home = customHome([
      {
        name: 'L',
        sortOrder: 1,
        rows: [
          { el: el('hidden1', 'smart-switches', { drawn: false }) },
          { el: el('shown', 'smart-switches'), at: { x: 5, y: 5 } },
          { el: el('hidden2', 'sensors', { drawn: false }) },
          { el: el('light', 'downlights'), at: { x: 1, y: 1 } },
          { el: el('lighthidden', 'downlights', { drawn: false }) },
        ],
      },
    ]);
    expect(ids(buildQueue(home))).toEqual(['shown', 'hidden1', 'hidden2', 'light', 'lighthidden']);
  });

  it('gives each category the right step kind and prompt', () => {
    const rows = (
      [
        ['a', 'smart-switches'],
        ['b', 'control-panels'],
        ['c', 'curtains-blinds'],
        ['d', 'sensors'],
        ['e', 'downlights'],
        ['f', 'led-strips'],
        ['g', 'ceiling-fans'],
        ['h', 'gateways'],
        ['i', 'cameras'],
        ['j', 'smart-locks'],
        ['k', 'aircon-controllers'],
      ] as [string, CategoryId][]
    ).map(([id, cat], i) => ({ el: el(id, cat, { label: '' }), at: { x: i, y: 0 } }));
    const q = buildQueue(customHome([{ name: 'L', sortOrder: 1, rows }]));
    const byId = Object.fromEntries(q.map((s) => [s.elementId, s]));

    expect(byId.a).toMatchObject({ kind: 'device', mode: 'device', kinds: ['switch'] });
    expect(byId.b).toMatchObject({ kind: 'device', mode: 'device', kinds: ['switch'] });
    expect(byId.c).toMatchObject({ kind: 'device', mode: 'device', kinds: ['cover'] });
    expect(byId.d).toMatchObject({ kind: 'device', mode: 'device', kinds: ['binary_sensor'] });
    for (const id of ['e', 'f', 'g']) {
      expect(byId[id]).toMatchObject({ kind: 'lights', mode: 'entity', kinds: ['light_gang'] });
    }
    for (const id of ['h', 'i', 'j', 'k']) {
      expect(byId[id]).toEqual({ kind: 'pick', elementId: id, prompt: 'Pick it from the list' });
    }
  });

  it('uses the exact prompt texts', () => {
    const q = buildQueue(
      customHome([
        {
          name: 'L',
          sortOrder: 1,
          rows: [
            { el: el('sw', 'smart-switches', { label: 'Entrance switch', productName: 'Ark' }), at: { x: 0, y: 0 } },
            { el: el('sw2', 'control-panels', { label: '', productName: 'Panel X' }), at: { x: 1, y: 0 } },
            { el: el('cu', 'curtains-blinds'), at: { x: 2, y: 0 } },
            { el: el('se', 'sensors'), at: { x: 3, y: 0 } },
            { el: el('li', 'downlights'), at: { x: 4, y: 0 } },
            { el: el('pi', 'gateways'), at: { x: 5, y: 0 } },
          ],
        },
      ]),
    );
    expect(q.map((s) => s.prompt)).toEqual([
      'Press any button on the switch at Entrance switch',
      'Press any button on the switch at Panel X',
      'Press open or close on the curtain switch',
      "Wave at the sensor, or open the door it's on",
      'Pick it from the list',
      'Press the gang that turns this on',
    ]);
  });

  it('passes the gang count from the product name; none stays null', () => {
    const q = buildQueue(
      customHome([
        {
          name: 'L',
          sortOrder: 1,
          rows: [
            { el: el('g3', 'smart-switches', { productName: 'Ark Series 3 Gang' }), at: { x: 0, y: 0 } },
            { el: el('g2', 'smart-switches', { productName: 'Ark 2-gang' }), at: { x: 1, y: 0 } },
            { el: el('g1', 'control-panels', { productName: 'Panel 1G' }), at: { x: 2, y: 0 } },
            { el: el('gn', 'smart-switches', { productName: 'Ark Series' }), at: { x: 3, y: 0 } },
            { el: el('sn', 'sensors', { productName: 'Sensor 2 Gang' }), at: { x: 4, y: 0 } },
          ],
        },
      ]),
    );
    const gangs = Object.fromEntries(q.map((s) => [s.elementId, s.kind === 'device' ? s.gangs : 'n/a']));
    expect(gangs).toEqual({ g3: 3, g2: 2, g1: 1, gn: null, sn: null });
  });
});

describe('gang count from the variant name', () => {
  it('reads 3 from the real fixture sw1 (product "Ark Series", variant "3-gang, White")', () => {
    const sw1 = buildQueue(homeResponse()).find((s) => s.elementId === 'sw1');
    expect(sw1).toMatchObject({ kind: 'device', gangs: 3 });
  });

  it('prefers the product name over the variant name', () => {
    const q = buildQueue(
      customHome([
        {
          name: 'L',
          sortOrder: 1,
          rows: [
            { el: el('a', 'smart-switches', { productName: 'Ark 2 Gang', variantName: '3-gang' }), at: { x: 0, y: 0 } },
            { el: el('b', 'smart-switches', { productName: 'Ark', variantName: 'White' }), at: { x: 1, y: 0 } },
          ],
        },
      ]),
    );
    expect(q.map((s) => (s.kind === 'device' ? s.gangs : 'n/a'))).toEqual([2, null]);
  });
});

describe('Walk', () => {
  const walk = () => new Walk(homeResponse());

  it('starts at the first step with the totals set', () => {
    const w = walk();
    expect(w.current?.elementId).toBe('cur1');
    expect(w.total).toBe(8);
    expect(w.done).toBe(0);
  });

  it('has no current step for an empty queue', () => {
    const w = new Walk(homeResponse({ package: null }));
    expect(w.current).toBeUndefined();
    expect(w.total).toBe(0);
    expect(w.done).toBe(0);
  });

  it('linked advances to the next step', () => {
    const w = walk();
    w.linked(['cur1'], link('d1'));
    expect(w.current?.elementId).toBe('sen1');
    expect(w.done).toBe(1);
    expect(w.total).toBe(8);
  });

  it('linked with several elements removes them all', () => {
    const w = walk();
    w.jump('dl1');
    w.linked(['dl1', 'dl3'], { type: 'entity', id: 'light.a' });
    expect(w.current?.elementId).toBe('dl2');
    expect(w.done).toBe(2);
  });

  it('linking the last step ends the walk', () => {
    const w = new Walk(withLinks(Object.fromEntries(FIXTURE_ORDER.slice(1).map((i) => [i, link(i)]))));
    expect(w.current?.elementId).toBe('cur1');
    w.linked(['cur1'], link('x'));
    expect(w.current).toBeUndefined();
    expect(w.done).toBe(1);
    expect(w.total).toBe(1);
  });

  it('skip moves the step to the end and shows the next one', () => {
    const w = walk();
    w.skip();
    expect(w.current?.elementId).toBe('sen1');
    expect(w.done).toBe(0);
    // Link everything else: the skipped step comes back last.
    for (const id of ['sen1', 'sw1', 'dl1', 'dl2', 'dl3', 'led1', 'sen2']) {
      expect(w.current?.elementId).toBe(id);
      w.linked([id], link(id));
    }
    expect(w.current?.elementId).toBe('cur1');
  });

  it('skipping the only step keeps it current', () => {
    const w = new Walk(withLinks(Object.fromEntries(FIXTURE_ORDER.slice(1).map((i) => [i, link(i)]))));
    w.skip();
    expect(w.current?.elementId).toBe('cur1');
  });

  it('skipping the last step goes round to the first', () => {
    const w = walk();
    w.jump('sen2');
    w.skip();
    expect(w.current?.elementId).toBe('cur1');
  });

  it('back returns to the previous step without unlinking anything', () => {
    const w = walk();
    w.linked(['cur1'], link('d1'));
    w.linked(['sen1'], link('d2'));
    expect(w.current?.elementId).toBe('sw1');
    w.jump('dl1');
    w.back();
    expect(w.current?.elementId).toBe('sw1');
    expect(w.done).toBe(2);
  });

  it('back steps one earlier in the walk order, skipped steps included', () => {
    const w = walk();
    w.skip(); // cur1 to the end: sen1 sw1 dl1 dl2 dl3 led1 sen2 cur1
    w.jump('sw1');
    w.back();
    expect(w.current?.elementId).toBe('sen1');
    w.jump('cur1'); // a skipped step sits at the end
    w.back();
    expect(w.current?.elementId).toBe('sen2');
    expect(w.done).toBe(0);
  });

  it('back at the first step stays there', () => {
    const w = walk();
    w.back();
    expect(w.current?.elementId).toBe('cur1');
  });

  it('undo returns the last link and puts its elements back at the front', () => {
    const w = walk();
    w.linked(['cur1'], link('d1'));
    w.jump('dl1');
    const l2: Link = { type: 'entity', id: 'light.a' };
    w.linked(['dl1', 'dl2'], l2);
    expect(w.current?.elementId).toBe('dl3');
    expect(w.undo()).toEqual({ elementIds: ['dl1', 'dl2'], link: l2 });
    expect(w.current?.elementId).toBe('dl1');
    expect(w.done).toBe(1);
    w.linked(['dl1'], link('x'));
    expect(w.current?.elementId).toBe('dl2');
    // The next undo is the link made after that, then the first link.
    expect(w.undo()?.elementIds).toEqual(['dl1']);
    expect(w.undo()).toEqual({ elementIds: ['cur1'], link: link('d1') });
    expect(w.current?.elementId).toBe('cur1');
    expect(w.done).toBe(0);
    expect(w.undo()).toBeUndefined();
  });

  it('undo of a skipped step\'s link puts it at the front again', () => {
    const w = walk();
    w.skip();
    w.linked(['sen1'], link('d1'));
    w.undo();
    expect(w.current?.elementId).toBe('sen1');
  });

  it('jump makes that element current and ignores unknown or linked ones', () => {
    const w = walk();
    w.jump('led1');
    expect(w.current?.elementId).toBe('led1');
    w.jump('nope');
    expect(w.current?.elementId).toBe('led1');
    w.linked(['sw1'], link('d1'));
    w.jump('sw1');
    expect(w.current?.elementId).toBe('led1');
  });

  it('jump does not reorder; the walk continues from there', () => {
    const w = walk();
    w.jump('dl2');
    w.linked(['dl2'], link('d1'));
    expect(w.current?.elementId).toBe('dl3');
  });
});

describe('Walk.refresh (a walk resumed after being left half way)', () => {
  it('drops elements that got linked elsewhere and keeps the current one if still unlinked', () => {
    const w = new Walk(homeResponse());
    w.jump('sw1');
    w.refresh(withLinks({ cur1: link('d1'), dl2: link('d2') }));
    expect(w.current?.elementId).toBe('sw1');
    expect(w.done).toBe(2);
    expect(w.total).toBe(8);
    // The remaining steps keep their order.
    const seen: string[] = [];
    while (w.current) {
      seen.push(w.current.elementId);
      w.linked([w.current.elementId], link('z'));
    }
    expect(seen).toEqual(['sw1', 'dl1', 'dl3', 'led1', 'sen2', 'sen1']);
  });

  it('moves to the next step when the current one got linked elsewhere', () => {
    const w = new Walk(homeResponse());
    w.jump('sw1');
    w.refresh(withLinks({ sw1: link('d1') }));
    expect(w.current?.elementId).toBe('dl1');
    expect(w.done).toBe(1);
  });

  it('moves to the next step that survives, past several linked ones', () => {
    const w = new Walk(homeResponse());
    w.jump('sw1');
    w.refresh(withLinks({ sw1: link('a'), dl1: link('b'), dl2: link('c') }));
    expect(w.current?.elementId).toBe('dl3');
  });

  it('wraps to the first step when nothing after the current one survives', () => {
    const w = new Walk(homeResponse());
    w.jump('sen2');
    w.refresh(withLinks({ sen2: link('a') }));
    expect(w.current?.elementId).toBe('cur1');
  });

  it('keeps skipped steps at the end', () => {
    const w = new Walk(homeResponse());
    w.skip(); // cur1 to the end
    w.refresh(withLinks({ dl1: link('a') }));
    expect(w.current?.elementId).toBe('sen1');
    const seen: string[] = [];
    while (w.current) {
      seen.push(w.current.elementId);
      w.linked([w.current.elementId], link('z'));
    }
    expect(seen).toEqual(['sen1', 'sw1', 'dl2', 'dl3', 'led1', 'sen2', 'cur1']);
  });

  it('puts a new element before the skipped ones and ends with an empty queue when all are linked', () => {
    const w = new Walk(homeResponse());
    w.skip();
    const base = homeResponse();
    const pkg = base.package as StoredHomePackage;
    const lv1 = pkg.levels[0]!;
    const plan = lv1.plans[0]!;
    const extra = el('new1', 'smart-switches', { label: 'New one' });
    const home: HomeResponse = {
      ...base,
      package: {
        ...pkg,
        levels: [
          {
            ...lv1,
            plans: [
              {
                ...plan,
                elements: [...plan.elements, extra],
                scene: {
                  ...plan.scene,
                  items: [...plan.scene.items, { type: 'marker', elementId: 'new1', x: 1, y: 1 } as unknown as SceneItem],
                },
              },
              ...lv1.plans.slice(1),
            ],
          },
          ...pkg.levels.slice(1),
        ],
      },
    };
    w.refresh(home);
    const seen: string[] = [];
    while (w.current) {
      seen.push(w.current.elementId);
      w.linked([w.current.elementId], link('z'));
    }
    expect(seen).toEqual(['sen1', 'sw1', 'dl1', 'dl2', 'dl3', 'led1', 'sen2', 'new1', 'cur1']);
    expect(w.total).toBe(9);
    expect(w.done).toBe(9);
  });

  it('does not redo or lose what was linked before: undo still works after a refresh', () => {
    const w = new Walk(homeResponse());
    w.linked(['cur1'], link('d1'));
    w.refresh(withLinks({ cur1: link('d1') }));
    expect(w.current?.elementId).toBe('sen1');
    expect(w.done).toBe(1);
    expect(w.undo()).toEqual({ elementIds: ['cur1'], link: link('d1') });
    expect(w.current?.elementId).toBe('cur1');
    expect(w.done).toBe(0);
  });

  it('refreshes the step text from the new home', () => {
    const w = new Walk(homeResponse());
    w.refresh(homeResponse());
    expect(w.current).toMatchObject({ elementId: 'cur1', prompt: 'Press open or close on the curtain switch' });
  });

  it('is a clean empty walk when the package is gone', () => {
    const w = new Walk(homeResponse());
    w.refresh(homeResponse({ package: null }));
    expect(w.current).toBeUndefined();
  });
});
