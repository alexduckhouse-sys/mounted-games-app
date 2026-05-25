import type { DiagramElement, DiagramPos, ConeKind, ItemKind } from '../types';

interface Props {
  diagramJson?: string | null;
  height?: number;
  className?: string;
}

function parse(json?: string | null): DiagramElement[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && typeof e === 'object' && typeof e.t === 'string') as DiagramElement[];
  } catch {
    return [];
  }
}

/**
 * Lane geometry shared by renderer + editor. The lane proper runs from the
 * START line (left) to the TOP line (right). Past x=100% there's a "behind top"
 * zone (extending to xMax) where equipment placed beyond the top line lives.
 */
export const LANE = {
  left: 80, top: 60, bottom: 180, topLineX: 660,
  beyondRight: 770,         // right boundary of the behind-top zone
  xMax: 120,                // max percentage we render (0 = start, 100 = top, 120 = ~3m beyond)
} as const;

export function pctToPx(p: number): number {
  // Linear mapping: x=0 → LANE.left, x=100 → LANE.topLineX, x>100 extrapolates.
  const span = LANE.topLineX - LANE.left;
  return LANE.left + (p / 100) * span;
}
export function pxToPct(x: number): number {
  const span = LANE.topLineX - LANE.left;
  return ((x - LANE.left) / span) * 100;
}
export function clampPct(n: number): number {
  return Math.max(0, Math.min(LANE.xMax, n));
}
export const CENTRE_Y = (LANE.top + LANE.bottom) / 2;

/**
 * Resolve an element's position along the lane (0..xMax) using either the
 * absolute `x` or a named anchor with optional offset.
 *   `pole<N>` → x of the Nth pole in the elements array (1-indexed)
 *   `start` → 0; `top` / `finish` → 100; `midline` → 50; `changeover` → 85
 */
export function resolveX(el: DiagramPos, allElements: DiagramElement[]): number {
  if (el.anchor) {
    const offset = el.offset ?? 0;
    const named: Record<string, number> = {
      start: 0, finish: 100, top: 100, midline: 50, changeover: 85,
    };
    if (el.anchor in named) return clampPct(named[el.anchor] + offset);
    const poleMatch = /^pole(\d+)$/i.exec(el.anchor);
    if (poleMatch) {
      const n = parseInt(poleMatch[1], 10);
      const poles = allElements.filter((e) => e.t === 'pole');
      const target = poles[n - 1];
      if (target && 'x' in target && typeof target.x === 'number') return clampPct(target.x + offset);
    }
  }
  if (typeof (el as DiagramPos).x === 'number') return clampPct((el as DiagramPos).x!);
  return 50;
}

/**
 * Renders an arena lane as SVG. Lane proper from the START line on the left to
 * the TOP line on the right; a "behind top" zone past x=100% where equipment
 * placed beyond the top line is drawn. Poles render along the bottom edge of
 * the lane; everything else (cones, items, ins) renders inside the lane.
 */
export function RaceDiagram({ diagramJson, height = 140, className }: Props) {
  const elements = parse(diagramJson);
  const hasMidline = elements.some((e) => e.t === 'midline');
  const laneWidth = LANE.topLineX - LANE.left;

  return (
    <svg
      viewBox="0 0 800 240"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Arena setup diagram"
      className={className}
      style={{ height: `${height}px`, width: '100%', display: 'block' }}
    >
      <rect x="0" y="0" width="800" height="240" fill="#fef3c7" />
      {/* lane proper */}
      <rect x={LANE.left - 10} y={LANE.top - 10} width={laneWidth + 20} height={LANE.bottom - LANE.top + 20}
            fill="#fde68a" rx="6" />
      {/* behind-top zone (lighter) */}
      <rect x={LANE.topLineX} y={LANE.top - 10} width={LANE.beyondRight - LANE.topLineX} height={LANE.bottom - LANE.top + 20}
            fill="#fef3c7" rx="6" />

      <line x1={LANE.left} y1={LANE.top} x2={LANE.topLineX} y2={LANE.top} stroke="#92400e" strokeWidth="1.5" />
      <line x1={LANE.left} y1={LANE.bottom} x2={LANE.topLineX} y2={LANE.bottom} stroke="#92400e" strokeWidth="1.5" />

      {/* START line (left) */}
      <line x1={LANE.left} y1={LANE.top - 8} x2={LANE.left} y2={LANE.bottom + 8} stroke="#16a34a" strokeWidth="4" />
      <text x={LANE.left} y={LANE.top - 18} textAnchor="middle" fontSize="14" fontWeight="700" fill="#15803d">START</text>

      {/* TOP line (right edge of lane proper) */}
      <line x1={LANE.topLineX} y1={LANE.top - 8} x2={LANE.topLineX} y2={LANE.bottom + 8} stroke="#dc2626" strokeWidth="4" />
      <text x={LANE.topLineX} y={LANE.top - 18} textAnchor="middle" fontSize="14" fontWeight="700" fill="#b91c1c">TOP</text>

      {/* Behind-top label */}
      <text x={(LANE.topLineX + LANE.beyondRight) / 2} y={LANE.bottom + 22} textAnchor="middle" fontSize="10" fill="#92400e" fontStyle="italic">
        behind top
      </text>

      {hasMidline && (
        <>
          <line x1={pctToPx(50)} y1={LANE.top - 4} x2={pctToPx(50)} y2={LANE.bottom + 4}
                stroke="#475569" strokeWidth="1.5" strokeDasharray="6 6" />
          <text x={pctToPx(50)} y={LANE.bottom + 22} textAnchor="middle" fontSize="11" fill="#475569">midline</text>
        </>
      )}

      {elements.map((el, i) => {
        if (el.t === 'midline') return null;
        const x = pctToPx(resolveX(el, elements));
        const baseY = el.t === 'pole' ? LANE.bottom + 4 : CENTRE_Y;
        return <DiagramNode key={i} el={el} x={x} y={baseY} />;
      })}
    </svg>
  );
}

interface NodeProps { el: DiagramElement; x: number; y: number }

/**
 * Renders a single element at (x, y). Children in `on:` stack upward —
 * each child sits ~22px above the previous one.
 */
function DiagramNode({ el, x, y }: NodeProps) {
  if (el.t === 'midline') return null;
  const label = (el as DiagramPos).label;
  const labelY = el.t === 'pole' ? y + 28 : y + 26;
  const labelColour = labelFor(el.t, (el as DiagramPos).kind);
  const children = (el as DiagramPos).on ?? [];
  const childGap = 22;

  return (
    <g>
      <ElementShape el={el} x={x} y={y} />
      {label && (
        <text x={x} y={labelY} textAnchor="middle" fontSize="11" fontWeight="700" fill={labelColour}>
          {label}
        </text>
      )}
      {children.map((c, i) => (
        <DiagramNode key={i} el={c} x={x} y={y - (i + 1) * childGap} />
      ))}
    </g>
  );
}

export function ElementShape({ el, x, y }: NodeProps) {
  if (el.t === 'midline') return null;
  const kind = (el as DiagramPos).kind;
  switch (el.t) {
    case 'pole':
      // Thin yellow PC-style bending pole — drawn as a slim vertical bar.
      return (
        <>
          <rect x={x - 2} y={y - 22} width="4" height="24" fill="#fbbf24" stroke="#78350f" strokeWidth="1" />
          <rect x={x - 3} y={y - 16} width="6" height="3" fill="#1e293b" />
          <rect x={x - 3} y={y - 8} width="6" height="3" fill="#1e293b" />
        </>
      );
    case 'cone':
      return <Cone x={x} y={y} kind={(kind as ConeKind | undefined) ?? 'flag'} />;
    case 'item':
      return <Item x={x} y={y} kind={(kind as ItemKind | undefined) ?? 'mug'} />;
    case 'table':
    case 'in':
      return (
        <>
          <rect x={x - 14} y={y - 6} width="28" height="14" fill="#92400e" rx="2" />
          <line x1={x - 12} y1={y + 8} x2={x - 12} y2={y + 16} stroke="#92400e" strokeWidth="2.5" />
          <line x1={x + 12} y1={y + 8} x2={x + 12} y2={y + 16} stroke="#92400e" strokeWidth="2.5" />
        </>
      );
  }
}

function Cone({ x, y, kind }: { x: number; y: number; kind: ConeKind }) {
  // Flag cone: orange triangle with a white stripe. Ball cone: same flag-cone
  // shape with a silver dish/layer on top to hold a ball.
  const triangle = (
    <polygon points={`${x - 9},${y + 10} ${x + 9},${y + 10} ${x},${y - 14}`}
             fill="#f97316" stroke="#7c2d12" strokeWidth="1.5" />
  );
  const stripe = <line x1={x - 10} y1={y - 2} x2={x + 10} y2={y - 2} stroke="#fff" strokeWidth="2" />;
  if (kind === 'ball') {
    return (
      <>
        {triangle}
        {stripe}
        <ellipse cx={x} cy={y - 14} rx="8" ry="3" fill="#cbd5e1" stroke="#475569" strokeWidth="1" />
      </>
    );
  }
  return (
    <>
      {triangle}
      {stripe}
    </>
  );
}

function Item({ x, y, kind }: { x: number; y: number; kind: ItemKind }) {
  switch (kind) {
    case 'bucket':
      return (
        <>
          <path d={`M ${x - 9} ${y - 6} L ${x - 7} ${y + 8} L ${x + 7} ${y + 8} L ${x + 9} ${y - 6} Z`}
                fill="#0f172a" stroke="#000" strokeWidth="1.5" />
          <path d={`M ${x - 9} ${y - 6} Q ${x} ${y - 12} ${x + 9} ${y - 6}`} fill="none" stroke="#000" strokeWidth="1.5" />
        </>
      );
    case 'bin':
      // Bin renders as a red circle per PC convention.
      return (
        <>
          <circle cx={x} cy={y} r="10" fill="#dc2626" stroke="#7f1d1d" strokeWidth="1.5" />
          <circle cx={x} cy={y} r="5" fill="none" stroke="#7f1d1d" strokeWidth="1" />
        </>
      );
    case 'mug':
      return (
        <>
          <rect x={x - 6} y={y - 6} width="10" height="12" fill="#fef3c7" stroke="#92400e" strokeWidth="1.5" rx="1" />
          <path d={`M ${x + 4} ${y - 3} Q ${x + 9} ${y} ${x + 4} ${y + 3}`} fill="none" stroke="#92400e" strokeWidth="1.5" />
        </>
      );
    case 'ball':
      return <circle cx={x} cy={y} r="6" fill="#fde047" stroke="#854d0e" strokeWidth="1.5" />;
    case 'flag':
      return (
        <>
          <line x1={x - 4} y1={y - 10} x2={x - 4} y2={y + 8} stroke="#1e293b" strokeWidth="1.5" />
          <polygon points={`${x - 4},${y - 10} ${x + 8},${y - 7} ${x - 4},${y - 4}`} fill="#dc2626" stroke="#7f1d1d" strokeWidth="1" />
        </>
      );
    case 'sock':
      return (
        <ellipse cx={x} cy={y} rx="8" ry="4" fill="#e2e8f0" stroke="#475569" strokeWidth="1.5" />
      );
    case 'sack':
      return (
        <>
          <ellipse cx={x} cy={y + 2} rx="9" ry="8" fill="#a16207" stroke="#3f2106" strokeWidth="1.5" />
          <path d={`M ${x - 5} ${y - 6} L ${x - 3} ${y - 9} L ${x + 3} ${y - 9} L ${x + 5} ${y - 6}`} fill="#a16207" stroke="#3f2106" strokeWidth="1.5" />
        </>
      );
    case 'baton':
      return <rect x={x - 10} y={y - 3} width="20" height="6" fill="#fbbf24" stroke="#78350f" strokeWidth="1.5" rx="3" />;
    case 'sword':
      return (
        <>
          <line x1={x} y1={y - 10} x2={x} y2={y + 8} stroke="#64748b" strokeWidth="2.5" />
          <line x1={x - 5} y1={y - 4} x2={x + 5} y2={y - 4} stroke="#64748b" strokeWidth="2.5" />
        </>
      );
    case 'quoit':
      return (
        <>
          <circle cx={x} cy={y} r="8" fill="none" stroke="#16a34a" strokeWidth="3" />
          <circle cx={x} cy={y} r="4" fill="none" stroke="#16a34a" strokeWidth="1" />
        </>
      );
    case 'card':
      return <rect x={x - 5} y={y - 7} width="10" height="14" fill="#fff" stroke="#1e293b" strokeWidth="1.5" rx="1" />;
    case 'penny':
      return <circle cx={x} cy={y} r="5" fill="#ca8a04" stroke="#713f12" strokeWidth="1.5" />;
    case 'bottle':
      return (
        <>
          <rect x={x - 4} y={y - 8} width="8" height="14" fill="#ffffff" stroke="#475569" strokeWidth="1.5" rx="1" />
          <rect x={x - 2} y={y - 11} width="4" height="3" fill="#ffffff" stroke="#475569" strokeWidth="1" />
        </>
      );
    case 'box':
      return <rect x={x - 8} y={y - 7} width="16" height="14" fill="#fde68a" stroke="#854d0e" strokeWidth="1.5" rx="1" />;
    default:
      return <rect x={x - 7} y={y - 7} width="14" height="14" fill="#a855f7" stroke="#581c87" strokeWidth="1.5" rx="2" />;
  }
}

function labelFor(t: DiagramElement['t'], _kind?: string): string {
  switch (t) {
    case 'pole': return '#7f1d1d';
    case 'cone': return '#7c2d12';
    case 'item': return '#1e293b';
    case 'table': case 'in': return '#92400e';
    default: return '#1e293b';
  }
}
