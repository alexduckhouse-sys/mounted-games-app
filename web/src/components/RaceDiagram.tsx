import type { RefObject } from 'react';
import type { DiagramElement, DiagramPos, ConeKind, ItemKind } from '../types';
import { LANE, CENTRE_Y, pctToPx } from './diagramGeometry';
import {
  PAD_R,
  POLE_LABELS,
  POLE_X,
  contentsSummary,
  parseDiagram,
  placeElements,
  toLaneModel,
  type LaneModel,
  type PlacedElement,
  type Slot,
} from './diagramSlots';

interface Props {
  diagramJson?: string | null;
  height?: number;
  className?: string;
  /** Set up the arena in front of the viewer: each pole and piece of kit drops in, from the start line to the top. */
  drop?: boolean;
}

/** Handlers the editor passes in; the read-only diagram leaves them out. */
export interface LaneEditing {
  svgRef: RefObject<SVGSVGElement | null>;
  selectedIndex: number | null;
  activeSlotId: string | null;
  onBackgroundDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onElementDown: (index: number, e: React.PointerEvent<SVGGElement>) => void;
  onMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onUp: () => void;
  placing: boolean;
}

/**
 * Renders an arena lane as SVG from the pole-based slot model (see
 * diagramSlots.ts). Old diagrams are mapped to the nearest slot on read.
 */
export function RaceDiagram({ diagramJson, height = 140, className, drop = false }: Props) {
  const model = toLaneModel(parseDiagram(diagramJson));
  // Keyed on the race, so moving to another race sets its arena up afresh.
  return <LaneCanvas key={drop ? diagramJson ?? '' : undefined} model={model} height={height} className={className} ariaLabel="Arena setup diagram" drop={drop} />;
}

/** Seconds before the first piece of kit lands, and between one piece and the next. */
const DROP_START_S = 0.15;
const DROP_STEP_S = 0.09;

const MAX_STACK = 3;
const CHILD_GAP = 22;

const SLOT_RENDER_X: Record<string, number> = {
  start: 0,
  gap0: 11,
  pole1: 22,
  gap1: 33,
  pole2: 44,
  gap2: 55,
  pole3: 66,
  gap3: 77,
  pole4: 88,
  gap4: 94,
  gap5: 104,
  top: 108,
  pole5: 110,
  beyond: 116,
};

function resolveRenderX(p: PlacedElement, model: LaneModel): number {
  const rawX = (p.el as DiagramPos).x;
  if (p.slot.id === 'pole3' && model.midline && (rawX === 50 || rawX === 55)) return 55;
  if (p.slot.id in SLOT_RENDER_X && (model.poleCount === 4 || model.poleCount === 5 || p.slot.id === 'top' || p.slot.id === 'pole5' || p.slot.id === 'beyond')) {
    return SLOT_RENDER_X[p.slot.id];
  }
  return p.x;
}

export function LaneCanvas({
  model, height, className, ariaLabel, editing, drop = false,
}: {
  model: LaneModel;
  height: number;
  className?: string;
  ariaLabel: string;
  editing?: LaneEditing;
  drop?: boolean;
}) {
  const { slots, placed } = placeElements(model);
  const laneWidth = LANE.topLineX - LANE.left;
  const beyondRight = LANE.topLineX + PAD_R;
  const svgWidth = beyondRight + 40;
  const active = editing?.activeSlotId ? slots.find((s) => s.id === editing.activeSlotId) : undefined;
  const landmarks = POLE_LABELS.map((label, i) => ({ label, x: POLE_X[i] }));

  // Elements sharing a slot spread across the lane's height so none hides another.
  const bySlot = new Map<string, PlacedElement[]>();
  for (const p of placed) bySlot.set(p.slot.id, [...(bySlot.get(p.slot.id) ?? []), p]);

  // Kit lands in order down the lane, the way a steward walks it out from the start.
  const dropOrder = new Map([...placed].sort((a, b) => resolveRenderX(a, model) - resolveRenderX(b, model)).map((p, rank) => [p.index, rank]));

  return (
    <svg
      ref={editing?.svgRef}
      viewBox={`0 0 ${svgWidth} 240`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ height: `${height}px`, width: '100%', display: 'block', ...(editing ? { touchAction: 'none', cursor: editing.placing ? 'crosshair' : 'default' } : {}) }}
      onPointerDown={editing?.onBackgroundDown}
      onPointerMove={editing?.onMove}
      onPointerUp={editing?.onUp}
      onPointerCancel={editing?.onUp}
    >
      <rect x="0" y="0" width={svgWidth} height="240" fill="#fef3c7" />
      <rect x={LANE.left - 10} y={LANE.top - 10} width={laneWidth + 20} height={LANE.bottom - LANE.top + 20}
            fill="#fde68a" rx="6" />
      <rect x={LANE.topLineX} y={LANE.top - 10} width={beyondRight - LANE.topLineX} height={LANE.bottom - LANE.top + 20}
            fill="#fde68a" opacity="0.55" rx="6" />

      <line x1={LANE.left} y1={LANE.top} x2={LANE.topLineX} y2={LANE.top} stroke="#92400e" strokeWidth="1.5" />
      <line x1={LANE.left} y1={LANE.bottom} x2={LANE.topLineX} y2={LANE.bottom} stroke="#92400e" strokeWidth="1.5" />
      <line x1={LANE.topLineX} y1={LANE.top} x2={beyondRight} y2={LANE.top} stroke="#92400e" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.6" />
      <line x1={LANE.topLineX} y1={LANE.bottom} x2={beyondRight} y2={LANE.bottom} stroke="#92400e" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.6" />

      {landmarks.map((m) => (
        <PoleLandmark key={m.label} label={m.label} x={pctToPx(m.x)} />
      ))}

      {active && (
        <rect data-testid="active-slot" x={pctToPx(active.id in SLOT_RENDER_X ? SLOT_RENDER_X[active.id] : active.x) - 22} y={LANE.top - 10} width="44" height={LANE.bottom - LANE.top + 20}
              fill="#0ea5e9" opacity="0.18" stroke="#0284c7" strokeWidth="2" strokeDasharray="5 4" rx="6" />
      )}
      {editing && slots.map((s) => <SlotMarker key={s.id} slot={s} />)}

      {/* START line: thick green bar with a chequered edge so it reads as a line to cross */}
      <rect x={LANE.left - 4} y={LANE.top - 8} width="8" height={LANE.bottom - LANE.top + 16} fill="#16a34a" data-testid="start-line" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={LANE.left + (i % 2 === 0 ? -4 : 0)} y={LANE.top - 8 + i * ((LANE.bottom - LANE.top + 16) / 8)}
              width="4" height={(LANE.bottom - LANE.top + 16) / 8} fill="#f0fdf4" />
      ))}
      <text x={LANE.left} y={LANE.top - 16} textAnchor="middle" fontSize="16" fontWeight="800" fill="#14532d">START</text>

      <line x1={LANE.topLineX} y1={LANE.top - 8} x2={LANE.topLineX} y2={LANE.bottom + 8} stroke="#dc2626" strokeWidth="4" />
      <text x={LANE.topLineX} y={LANE.top - 16} textAnchor="middle" fontSize="16" fontWeight="800" fill="#991b1b">TOP</text>
      <text x={(LANE.topLineX + beyondRight) / 2} y={LANE.bottom + 22} textAnchor="middle" fontSize="11" fill="#92400e" fontStyle="italic">
        beyond
      </text>

      {model.midline && (
        <>
          <line x1={pctToPx(55)} y1={LANE.top - 4} x2={pctToPx(55)} y2={LANE.bottom + 4}
                stroke="#475569" strokeWidth="1.5" strokeDasharray="6 6" />
          <text x={pctToPx(55)} y={LANE.top - 16} textAnchor="middle" fontSize="12" fill="#334155">midline</text>
        </>
      )}

      {placed.map((p) => {
        const group = bySlot.get(p.slot.id) ?? [];
        const at = group.indexOf(p);
        const y = CENTRE_Y + (at - (group.length - 1) / 2) * 36;
        return (
          <DiagramNode
            key={p.index}
            el={p.el}
            x={pctToPx(resolveRenderX(p, model))}
            y={y}
            index={p.index}
            selected={editing?.selectedIndex === p.index}
            onDown={editing?.onElementDown}
            dropDelay={drop && !editing ? DROP_START_S + (dropOrder.get(p.index) ?? 0) * DROP_STEP_S : undefined}
          />
        );
      })}
    </svg>
  );
}

function PoleLandmark({ label, x }: { label: string; x: number }) {
  return (
    <g data-testid={`pole-landmark-${label}`}>
      <line x1={x} y1={LANE.top - 4} x2={x} y2={LANE.top + 6} stroke="#b45309" strokeWidth="1.5" opacity="0.7" />
      <line x1={x} y1={LANE.bottom - 6} x2={x} y2={LANE.bottom + 4} stroke="#b45309" strokeWidth="1.5" opacity="0.7" />
      <line x1={x} y1={LANE.top + 6} x2={x} y2={LANE.bottom - 6} stroke="#b45309" strokeWidth="1" strokeDasharray="3 5" opacity="0.35" />
      <rect x={x - 12} y={LANE.top - 22} width="24" height="14" rx="4" fill="#fef3c7" stroke="#d97706" strokeWidth="1" />
      <text x={x} y={LANE.top - 12} textAnchor="middle" fontSize="10" fontWeight="700" fill="#92400e">{label}</text>
    </g>
  );
}

function SlotMarker({ slot }: { slot: Slot }) {
  const x = pctToPx(slot.id in SLOT_RENDER_X ? SLOT_RENDER_X[slot.id] : slot.x);
  if (slot.kind === 'pole') {
    return <line x1={x} y1={LANE.top + 6} x2={x} y2={LANE.bottom - 6} stroke="#b45309" strokeWidth="1.5" strokeDasharray="3 5" opacity="0.7" />;
  }
  if (slot.kind === 'gap' || slot.kind === 'beyond') {
    return <circle cx={x} cy={CENTRE_Y} r="4" fill="#d97706" opacity="0.55" />;
  }
  return null;
}

interface NodeProps { el: DiagramElement; x: number; y: number }

/**
 * Renders a single element at (x, y). What's on it stacks upward (about 22px
 * per item, at most three drawn plus a "+n" marker) with a text summary such
 * as "2 mugs" under the element.
 */
function DiagramNode({
  el, x, y, index, selected, onDown, dropDelay,
}: NodeProps & { index: number; selected: boolean; onDown?: LaneEditing['onElementDown']; dropDelay?: number }) {
  if (el.t === 'midline' || el.t === 'lane') return null;
  const label = (el as DiagramPos).label;
  const labelY = y + 28;
  const children = ((el as DiagramPos).on ?? []).filter((c) => c.t !== 'midline' && c.t !== 'lane');
  const shown = children.slice(0, MAX_STACK);
  const summary = contentsSummary(el);

  return (
    <g
      data-testid={`element-${index}`}
      className={dropDelay === undefined ? undefined : 'mg-kit-drop'}
      style={onDown ? { cursor: 'grab' } : dropDelay === undefined ? undefined : { animationDelay: `${dropDelay.toFixed(2)}s` }}
      onPointerDown={onDown ? (e) => onDown(index, e) : undefined}
    >
      {onDown && <rect x={x - 26} y={y - 34 - shown.length * CHILD_GAP} width="52" height={72 + shown.length * CHILD_GAP} fill="transparent" />}
      {selected && (
        <rect x={x - 22} y={y - 28 - shown.length * CHILD_GAP} width="44" height={62 + shown.length * CHILD_GAP}
              fill="none" stroke="#0284c7" strokeWidth="3" strokeDasharray="5 3" rx="8" />
      )}
      <ElementShape el={el} x={x} y={y} />
      {shown.map((c, i) => (
        <ElementShape key={i} el={c} x={x} y={y - (i + 1) * CHILD_GAP} />
      ))}
      {children.length > shown.length && (
        <text x={x + 16} y={y - (shown.length + 1) * CHILD_GAP + 8} fontSize="13" fontWeight="700" fill="#1e293b">+{children.length - shown.length}</text>
      )}
      {label && (
        <text x={x} y={labelY} textAnchor="middle" fontSize="14" fontWeight="700" fill={labelFor(el.t)}>
          {label}
        </text>
      )}
      {summary && (
        <text x={x} y={labelY + (label ? 15 : 0)} textAnchor="middle" fontSize="13" fontWeight="600" fill="#1e293b" data-testid="contents-summary">
          {summary}
        </text>
      )}
    </g>
  );
}

export function ElementShape({ el, x, y }: NodeProps) {
  if (el.t === 'midline' || el.t === 'lane') return null;
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

function labelFor(t: DiagramElement['t']): string {
  switch (t) {
    case 'pole': return '#7f1d1d';
    case 'cone': return '#7c2d12';
    case 'item': return '#1e293b';
    case 'table': case 'in': return '#92400e';
    default: return '#1e293b';
  }
}
