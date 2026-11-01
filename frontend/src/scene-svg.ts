import type { Scene, SceneBadge, SceneLabel, SceneMarker, SceneNote, ScenePath } from './types.ts';

/** A renderer-neutral SVG element; the view turns these into real nodes. */
export interface SvgNode {
  tag: 'path' | 'text' | 'g';
  attrs: Record<string, string>;
  /** Set on the top-level node of each scene item, so a tap can be traced back to its element. */
  elementId?: string;
  children?: SvgNode[];
  /** The content of a `text` node. */
  text?: string;
}

const INK = '#1F1D1A';
const WHITE = '#FFFFFF';
/** Unit square and circle in the same −0.5…0.5 box the icon shapes use. */
const UNIT_SQUARE = 'M-0.5 -0.5 H0.5 V0.5 H-0.5 Z';
const UNIT_CIRCLE = 'M0 -0.5 A0.5 0.5 0 1 1 0 0.5 A0.5 0.5 0 1 1 0 -0.5 Z';

/** Numbers as short strings; the planner's floats carry noise like 6.6000000000000005. */
const num = (n: number): string => String(Math.round(n * 10000) / 10000);

const place = (x: number, y: number, rotation: number, scale?: number): string =>
  `translate(${num(x)} ${num(y)}) rotate(${num(rotation)})${scale === undefined ? '' : ` scale(${num(scale)})`}`;

function textNode(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fill: string,
  extra: Record<string, string> = {},
): SvgNode {
  return {
    tag: 'text',
    text,
    attrs: {
      x: num(x),
      y: num(y),
      'font-size': num(fontSize),
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      fill,
      ...extra,
    },
  };
}

function labelNode(label: SceneLabel, extra: Record<string, string> = {}): SvgNode {
  return textNode(label.text, label.x, label.y, label.fontSize, INK, extra);
}

function badgeNode(badge: SceneBadge, m: SceneMarker): SvgNode {
  // The badge turns with the icon, as in the planner.
  return textNode(badge.text, badge.dx, badge.dy, badge.fontSize, badge.color, {
    'font-weight': '600',
    transform: place(m.x, m.y, m.rotation),
  });
}

function markerNode(m: SceneMarker): SvgNode {
  const filled = m.badgeStyle === 'filled';
  const children: SvgNode[] = [
    {
      tag: 'path',
      attrs: {
        d: m.pathD,
        transform: place(m.x, m.y, m.rotation, m.size),
        fill: filled ? m.color : WHITE,
        'fill-rule': 'evenodd',
        stroke: filled ? 'none' : m.color,
        'stroke-width': filled ? '0' : '0.08',
      },
    },
  ];
  if (m.badge.text) children.push(badgeNode(m.badge, m));
  // Planner label y is the top of the text; centre the line on it.
  if (m.label) children.push(labelNode(m.label, { y: num(m.label.y + m.label.fontSize * 0.3) }));
  return { tag: 'g', elementId: m.elementId, attrs: {}, children };
}

function pathNode(p: ScenePath): SvgNode {
  const dashed = p.dash !== undefined;
  const magnetic = p.shape === 'magnetic';
  const line: Record<string, string> = {
    d: p.d,
    fill: 'none',
    stroke: p.color,
    'stroke-width': num(p.strokeWidth),
    'stroke-linecap': p.kind === 'track' && !magnetic && !dashed ? 'square' : 'round',
    'stroke-linejoin': 'round',
  };
  if (p.dash) line['stroke-dasharray'] = p.dash.map(num).join(' ');
  if (p.kind === 'led-strip') line['opacity'] = '0.9';

  const children: SvgNode[] = [
    // Wide and invisible, so a thin line can be tapped.
    {
      tag: 'path',
      attrs: {
        d: p.d,
        fill: 'none',
        stroke: 'transparent',
        'stroke-width': num(Math.max(p.strokeWidth * 3, 12)),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
    },
    { tag: 'path', attrs: line },
  ];
  for (const h of p.heads) {
    children.push({
      tag: 'path',
      attrs: {
        d: magnetic ? UNIT_CIRCLE : UNIT_SQUARE,
        transform: place(h.x, h.y, magnetic ? 0 : h.angle, h.size),
        fill: p.color,
        stroke: WHITE,
        'stroke-width': '0.12',
      },
    });
  }
  if (p.label) {
    const curtain = p.kind === 'curtain';
    children.push(
      textNode(p.label.text, p.label.x, p.label.y, p.label.fontSize, curtain ? p.color : INK, {
        'font-weight': curtain ? '700' : '400',
        // A white halo keeps the text readable over the plan.
        stroke: WHITE,
        'stroke-width': num(p.label.fontSize * 0.3),
        'stroke-linejoin': 'round',
        'paint-order': 'stroke',
      }),
    );
  }
  return { tag: 'g', elementId: p.elementId, attrs: {}, children };
}

function noteNode(n: SceneNote): SvgNode {
  const lines = n.text.split('\n');
  const lineHeight = n.fontSize * 1.2;
  const pad = n.highlight ? n.fontSize * 0.3 : 0;
  const children: SvgNode[] = [];
  if (n.highlight) {
    // Text width is estimated; the real metrics are only known in a browser.
    const widest = Math.max(...lines.map((l) => l.length));
    const w = widest * n.fontSize * 0.55 + pad * 2;
    const h = lines.length * lineHeight + pad * 2;
    children.push({
      tag: 'path',
      attrs: {
        d: `M${num(n.x)} ${num(n.y)} h${num(w)} v${num(h)} h${num(-w)} Z`,
        fill: n.highlight,
      },
    });
  }
  lines.forEach((line, i) => {
    children.push(
      textNode(line, n.x + pad, n.y + pad + lineHeight * (i + 0.5), n.fontSize, n.color, {
        'text-anchor': 'start',
        'font-weight': n.bold ? '600' : '400',
      }),
    );
  });
  return { tag: 'g', elementId: n.elementId, attrs: {}, children };
}

/** Everything in the scene as SVG nodes, in the scene's z order. */
export function sceneToSvg(scene: Scene): SvgNode[] {
  return scene.items.map((item) => {
    switch (item.type) {
      case 'marker':
        return markerNode(item);
      case 'path':
        return pathNode(item);
      case 'note':
        return noteNode(item);
    }
  });
}
