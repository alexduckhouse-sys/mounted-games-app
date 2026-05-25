import { useMemo, useRef, useState } from 'react';
import { Trash2, Plus, X, ChevronUp, ArrowUp, ArrowDown } from 'lucide-react';
import type { DiagramElement, DiagramPos, DiagramTool, ConeKind, ItemKind } from '../types';
import { DIAGRAM_TOOLS } from '../types';
import { ElementShape, LANE, CENTRE_Y, pctToPx, pxToPct, clampPct, resolveX } from './RaceDiagram';

interface Props {
  value: string;
  onChange: (json: string) => void;
}

/**
 * Drag-and-drop editor for race diagrams.
 *
 * - Tap a tool then click on the lane to place — the tool stays selected so
 *   you can rapid-place multiple of the same kind. Tap the tool again or pick
 *   another to stop.
 * - Drag any top-level element along the lane; snaps to poles / midline /
 *   start / top / changeover.
 * - Tap an element to edit its label, anchor, or stack equipment on it.
 */
export function DiagramEditor({ value, onChange }: Props) {
  const elements = useMemo(() => parseElements(value), [value]);
  const [tool, setTool] = useState<DiagramTool | 'midline' | null>(null);
  const [selectedPath, setSelectedPath] = useState<number[] | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef<{ path: number[]; pointerId: number } | null>(null);

  function commit(next: DiagramElement[]) {
    onChange(JSON.stringify(next));
  }

  /** Snap to a named anchor if the cursor is within 1.5% of it. */
  function snap(p: number, polesX: number[]): { x: number; anchor?: string; offset?: number } {
    const candidates: { name: string; x: number }[] = [
      { name: 'start', x: 0 },
      { name: 'top', x: 100 },
      { name: 'midline', x: 50 },
      { name: 'changeover', x: 85 },
      ...polesX.map((x, i) => ({ name: `pole${i + 1}`, x })),
    ];
    const hit = candidates.find((c) => Math.abs(c.x - p) <= 1.5);
    if (hit) return { x: hit.x, anchor: hit.name, offset: 0 };
    return { x: Math.round(p) };
  }

  function addAt(percent: number) {
    if (!tool) return;
    const polesX = collectPoleXs(elements);
    if (tool === 'midline') {
      if (elements.some((e) => e.t === 'midline')) return;
      commit([...elements, { t: 'midline' }]);
      return;
    }
    const snapped = snap(percent, polesX);
    const base: DiagramPos & { t: DiagramElement['t'] } = {
      t: tool.t,
      ...(snapped.anchor ? { anchor: snapped.anchor, offset: snapped.offset } : { x: snapped.x }),
    };
    if (tool.kind) (base as DiagramPos & { kind?: ConeKind | ItemKind }).kind = tool.kind;
    commit([...elements, base as DiagramElement]);
    setSelectedPath([elements.length]);
    // Sticky: tool stays selected for rapid placement; tap another tool or the
    // same tool again to deselect.
  }

  function elementAtPath(path: number[]): DiagramElement | null {
    let cur: DiagramElement | undefined = elements[path[0]];
    if (!cur) return null;
    for (let i = 1; i < path.length; i++) {
      const kids: DiagramElement[] = (cur as DiagramPos).on ?? [];
      cur = kids[path[i]];
      if (!cur) return null;
    }
    return cur;
  }

  function updateAtPath(path: number[], patch: Partial<DiagramPos>): void {
    function recur(arr: DiagramElement[], depth: number): DiagramElement[] {
      return arr.map((el, idx) => {
        if (idx !== path[depth]) return el;
        if (depth === path.length - 1) {
          if (el.t === 'midline') return el;
          return { ...el, ...patch };
        }
        if (el.t === 'midline') return el;
        return { ...el, on: recur((el as DiagramPos).on ?? [], depth + 1) };
      });
    }
    commit(recur(elements, 0));
  }

  function removeAtPath(path: number[]): void {
    function recur(arr: DiagramElement[], depth: number): DiagramElement[] {
      if (depth === path.length - 1) {
        return arr.filter((_, idx) => idx !== path[depth]);
      }
      return arr.map((el, idx) => {
        if (idx !== path[depth] || el.t === 'midline') return el;
        return { ...el, on: recur((el as DiagramPos).on ?? [], depth + 1) };
      });
    }
    commit(recur(elements, 0));
    setSelectedPath(null);
  }

  function addOnPath(path: number[], child: DiagramTool): void {
    function recur(arr: DiagramElement[], depth: number): DiagramElement[] {
      return arr.map((el, idx) => {
        if (idx !== path[depth] || el.t === 'midline') return el;
        if (depth === path.length - 1) {
          const newChild: DiagramElement = child.kind
            ? ({ t: child.t, kind: child.kind } as DiagramElement)
            : ({ t: child.t } as DiagramElement);
          const onArr: DiagramElement[] = [...((el as DiagramPos).on ?? []), newChild];
          return { ...el, on: onArr };
        }
        return { ...el, on: recur((el as DiagramPos).on ?? [], depth + 1) };
      });
    }
    commit(recur(elements, 0));
  }

  function pointerEvtToPct(e: { clientX: number }): number {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 50;
    const svgX = ((e.clientX - rect.left) / rect.width) * 800;
    return pxToPct(svgX);
  }

  function onLanePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!tool) return;
    const pct = pointerEvtToPct(e);
    if (pct < 0 || pct > LANE.xMax) return;
    addAt(pct);
  }

  function onElementPointerDown(path: number[]) {
    return (e: React.PointerEvent<SVGGElement>) => {
      e.stopPropagation();
      setSelectedPath(path);
      if (path.length !== 1) return;
      try { svgRef.current?.setPointerCapture?.(e.pointerId); } catch { /* unsupported */ }
      draggingRef.current = { path, pointerId: e.pointerId };
    };
  }

  function onLanePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draggingRef.current) return;
    const path = draggingRef.current.path;
    const polesX = collectPoleXs(elements);
    const snapped = snap(pointerEvtToPct(e), polesX);
    updateAtPath(path, snapped.anchor
      ? { anchor: snapped.anchor, offset: snapped.offset, x: undefined }
      : { x: snapped.x, anchor: undefined, offset: undefined });
  }
  function onLanePointerUp() {
    draggingRef.current = null;
  }

  const polesX = collectPoleXs(elements);
  const selected = selectedPath ? elementAtPath(selectedPath) : null;
  const laneSvgWidth = LANE.topLineX - LANE.left;

  return (
    <div className="space-y-2">
      <Toolbar
        currentTool={tool}
        onPick={(t) => setTool((cur) => toolEquals(cur, t) ? null : t)}
        onClear={() => commit([])}
      />

      <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden bg-amber-100/40 select-none">
        <svg
          ref={svgRef}
          viewBox="0 0 800 240"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Race diagram editor"
          style={{ width: '100%', height: 220, cursor: tool ? 'crosshair' : 'default', touchAction: 'none' }}
          onPointerDown={onLanePointerDown}
          onPointerMove={onLanePointerMove}
          onPointerUp={onLanePointerUp}
          onPointerCancel={onLanePointerUp}
        >
          <rect x="0" y="0" width="800" height="240" fill="#fef3c7" />
          <rect x={LANE.left - 10} y={LANE.top - 10} width={laneSvgWidth + 20} height={LANE.bottom - LANE.top + 20}
                fill="#fde68a" rx="6" />
          <rect x={LANE.topLineX} y={LANE.top - 10} width={LANE.beyondRight - LANE.topLineX} height={LANE.bottom - LANE.top + 20}
                fill="#fef3c7" rx="6" />

          <line x1={LANE.left} y1={LANE.top} x2={LANE.topLineX} y2={LANE.top} stroke="#92400e" strokeWidth="1.5" />
          <line x1={LANE.left} y1={LANE.bottom} x2={LANE.topLineX} y2={LANE.bottom} stroke="#92400e" strokeWidth="1.5" />

          <line x1={LANE.left} y1={LANE.top - 8} x2={LANE.left} y2={LANE.bottom + 8} stroke="#16a34a" strokeWidth="4" />
          <text x={LANE.left} y={LANE.top - 18} textAnchor="middle" fontSize="14" fontWeight="700" fill="#15803d">START</text>

          <line x1={LANE.topLineX} y1={LANE.top - 8} x2={LANE.topLineX} y2={LANE.bottom + 8} stroke="#dc2626" strokeWidth="4" />
          <text x={LANE.topLineX} y={LANE.top - 18} textAnchor="middle" fontSize="14" fontWeight="700" fill="#b91c1c">TOP</text>
          <text x={(LANE.topLineX + LANE.beyondRight) / 2} y={LANE.bottom + 22} textAnchor="middle" fontSize="10" fill="#92400e" fontStyle="italic">
            behind top
          </text>

          {/* Snap hints for poles + named anchors */}
          {[0, 50, 85, 100].concat(polesX).map((p, i) => (
            <line key={`hint-${i}-${p}`} x1={pctToPx(p)} y1={LANE.top + 4} x2={pctToPx(p)} y2={LANE.bottom - 4}
                  stroke="#fbbf24" strokeWidth="0.5" strokeDasharray="2 4" />
          ))}

          {elements.some((e) => e.t === 'midline') && (
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
            return (
              <EditorNode
                key={i}
                el={el}
                x={x}
                y={baseY}
                path={[i]}
                isSelectedPath={selectedPath}
                onPointerDown={onElementPointerDown}
              />
            );
          })}
        </svg>
      </div>

      {selected && selected.t !== 'midline' && selectedPath && (
        <SelectedDetail
          el={selected as DiagramPos & { t: DiagramElement['t'] }}
          path={selectedPath}
          polesCount={polesX.length}
          onUpdate={(patch) => updateAtPath(selectedPath, patch)}
          onRemove={() => removeAtPath(selectedPath)}
          onAddOn={(child) => addOnPath(selectedPath, child)}
          onSelectChild={(childPath) => setSelectedPath(childPath)}
          onRemoveChild={(childPath) => removeAtPath(childPath)}
        />
      )}

      {!selected && elements.length > 0 && (
        <p className="text-[11px] text-slate-500">
          Tap an element on the lane to edit its name, move it, or stack equipment on top.
        </p>
      )}
      {elements.length === 0 && (
        <p className="text-[11px] text-slate-500">
          Pick a tool above and click on the lane to place elements.
        </p>
      )}
    </div>
  );
}

function toolEquals(a: DiagramTool | 'midline' | null, b: DiagramTool | 'midline' | null): boolean {
  if (a === null || b === null) return a === b;
  if (a === 'midline' || b === 'midline') return a === b;
  return a.t === b.t && a.kind === b.kind;
}

function Toolbar({
  currentTool, onPick, onClear,
}: {
  currentTool: DiagramTool | 'midline' | null;
  onPick: (t: DiagramTool | 'midline') => void;
  onClear: () => void;
}) {
  const cones = DIAGRAM_TOOLS.filter((t) => t.t === 'cone');
  const items = DIAGRAM_TOOLS.filter((t) => t.t === 'item');
  const others = DIAGRAM_TOOLS.filter((t) => t.t !== 'cone' && t.t !== 'item');

  return (
    <div className="space-y-1.5 text-xs">
      <ToolGroup label="Lane">
        {others.map((t) => (
          <ToolButton key={t.t + (t.kind ?? '')} tool={t} current={currentTool} onPick={onPick} />
        ))}
        <ToolButton midline current={currentTool} onPick={onPick} />
      </ToolGroup>
      <ToolGroup label="Cones">
        {cones.map((t) => (
          <ToolButton key={t.t + (t.kind ?? '')} tool={t} current={currentTool} onPick={onPick} />
        ))}
      </ToolGroup>
      <ToolGroup label="Equipment">
        {items.map((t) => (
          <ToolButton key={t.t + (t.kind ?? '')} tool={t} current={currentTool} onPick={onPick} />
        ))}
        <button
          type="button"
          onClick={onClear}
          className="btn-ghost !py-0.5 !px-1.5 text-[11px] text-rose-500 ml-auto"
          title="Clear all elements"
        >
          <Trash2 className="w-3 h-3" /> Clear
        </button>
      </ToolGroup>
      {currentTool && (
        <p className="text-[10px] text-amber-700 dark:text-amber-200">
          Click on the lane to place. The tool stays selected so you can place multiple — tap the button again to stop.
        </p>
      )}
    </div>
  );
}

function ToolGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 w-16 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function ToolButton({
  tool, midline, current, onPick,
}: {
  tool?: DiagramTool;
  midline?: boolean;
  current: DiagramTool | 'midline' | null;
  onPick: (t: DiagramTool | 'midline') => void;
}) {
  const isActive = midline
    ? current === 'midline'
    : tool != null && current !== 'midline' && current?.t === tool.t && current?.kind === tool.kind;
  if (midline) {
    return (
      <button
        type="button"
        onClick={() => onPick('midline')}
        className={`btn-ghost !py-0.5 !px-1.5 text-[11px] ${isActive ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-200 ring-1 ring-brand-300' : ''}`}
      >
        <Plus className="w-3 h-3" /> Midline
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onPick(tool!)}
      className={`btn-ghost !py-0.5 !px-1.5 text-[11px] ${isActive ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-200 ring-1 ring-brand-300' : ''}`}
      title={`Add a ${tool!.label.toLowerCase()}`}
    >
      <ToolPreview t={tool!.t} kind={tool!.kind} /> {tool!.label}
    </button>
  );
}

/** Tiny inline SVG preview of the tool's shape, used inside toolbar buttons. */
function ToolPreview({ t, kind }: { t: DiagramElement['t']; kind?: ConeKind | ItemKind }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <ElementShape el={{ t, kind } as DiagramElement} x={12} y={12} />
    </svg>
  );
}

function EditorNode({
  el, x, y, path, isSelectedPath, onPointerDown,
}: {
  el: DiagramElement;
  x: number;
  y: number;
  path: number[];
  isSelectedPath: number[] | null;
  onPointerDown: (path: number[]) => (e: React.PointerEvent<SVGGElement>) => void;
}) {
  if (el.t === 'midline') return null;
  const isSelected = isSelectedPath?.length === path.length
    && isSelectedPath.every((p, i) => p === path[i]);
  const label = (el as DiagramPos).label;
  const children = (el as DiagramPos).on ?? [];
  const childGap = 22;

  return (
    <g style={{ cursor: 'grab' }} onPointerDown={onPointerDown(path)}>
      {isSelected && (
        <circle cx={x} cy={y} r="18" fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeDasharray="3 3" />
      )}
      <ElementShape el={el} x={x} y={y} />
      {label && (
        <text x={x} y={el.t === 'pole' ? y + 28 : y + 26} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1e293b">
          {label}
        </text>
      )}
      {children.map((c, i) => (
        <EditorNode
          key={i}
          el={c}
          x={x}
          y={y - (i + 1) * childGap}
          path={[...path, i]}
          isSelectedPath={isSelectedPath}
          onPointerDown={onPointerDown}
        />
      ))}
    </g>
  );
}

function SelectedDetail({
  el, path, polesCount, onUpdate, onRemove, onAddOn, onSelectChild, onRemoveChild,
}: {
  el: DiagramPos & { t: DiagramElement['t'] };
  path: number[];
  polesCount: number;
  onUpdate: (patch: Partial<DiagramPos>) => void;
  onRemove: () => void;
  onAddOn: (child: DiagramTool) => void;
  onSelectChild: (path: number[]) => void;
  onRemoveChild: (path: number[]) => void;
}) {
  const stackOptions = DIAGRAM_TOOLS.filter((t) => t.t !== 'pole');
  return (
    <div className="card p-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Selected · {el.t}{el.kind ? ` · ${el.kind}` : ''}
          {path.length > 1 && <span className="ml-1 text-slate-400">(on parent)</span>}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="btn-ghost !py-1 !px-2 text-[11px] text-rose-500 ml-auto"
        >
          <Trash2 className="w-3 h-3" /> Remove
        </button>
      </div>
      <label className="block">
        <span className="text-[11px] text-slate-500">Name / label</span>
        <input
          className="input mt-0.5 text-sm"
          value={el.label ?? ''}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder={el.t === 'pole' ? 'e.g. 1, 2, 3' : 'e.g. EGUK flag, blue mug'}
        />
      </label>
      {path.length === 1 && (
        <PositionRow el={el} polesCount={polesCount} onChange={onUpdate} />
      )}
      <div className="pt-1 border-t border-slate-100 dark:border-slate-700/60">
        <span className="text-[11px] text-slate-500 block mb-1">Stack equipment on this:</span>
        <div className="flex items-center gap-1 flex-wrap">
          {stackOptions.map((t) => (
            <button
              key={t.t + (t.kind ?? '')}
              type="button"
              onClick={() => onAddOn(t)}
              className="btn-ghost !py-0.5 !px-1.5 text-[11px]"
              title={`Stack a ${t.label.toLowerCase()} on this`}
            >
              <ChevronUp className="w-3 h-3" /> {t.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-slate-400">
          {(el.on?.length ?? 0)} stacked
        </span>
      </div>
      {el.on && el.on.length > 0 && (
        <ul className="text-[11px] divide-y divide-slate-100 dark:divide-slate-700/60">
          {el.on.map((child, i) => {
            const childPath = [...path, i];
            const cp = child as DiagramPos & { t: DiagramElement['t']; kind?: ConeKind | ItemKind };
            return (
              <li key={i} className="py-1 flex items-center gap-1">
                <ArrowUp className="w-3 h-3 text-slate-400" />
                <button
                  type="button"
                  onClick={() => onSelectChild(childPath)}
                  className="flex-1 text-left truncate hover:underline"
                >
                  <span className="font-semibold">{cp.t}{cp.kind ? ` · ${cp.kind}` : ''}</span>
                  {cp.label && <span className="text-slate-500"> · {cp.label}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveChild(childPath)}
                  className="text-rose-500"
                  title="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PositionRow({
  el, polesCount, onChange,
}: {
  el: DiagramPos;
  polesCount: number;
  onChange: (patch: Partial<DiagramPos>) => void;
}) {
  const isAnchored = !!el.anchor;
  const anchors = ['start', 'top', 'midline', 'changeover']
    .concat(Array.from({ length: polesCount }, (_, i) => `pole${i + 1}`));
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      <label className="block col-span-2 sm:col-span-1">
        <span className="text-[11px] text-slate-500">Anchored to</span>
        <select
          className="input mt-0.5 text-sm"
          value={el.anchor ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') onChange({ anchor: undefined, offset: undefined });
            else onChange({ anchor: v, offset: el.offset ?? 0, x: undefined });
          }}
        >
          <option value="">— Absolute —</option>
          {anchors.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      {isAnchored ? (
        <label className="block">
          <span className="text-[11px] text-slate-500">Offset (% from anchor)</span>
          <input
            type="number" step={1}
            className="input mt-0.5 text-sm"
            value={el.offset ?? 0}
            onChange={(e) => onChange({ offset: parseInt(e.target.value, 10) || 0 })}
          />
        </label>
      ) : (
        <label className="block">
          <span className="text-[11px] text-slate-500">Position (0–120)</span>
          <input
            type="number" min={0} max={LANE.xMax} step={1}
            className="input mt-0.5 text-sm"
            value={el.x ?? 50}
            onChange={(e) => onChange({ x: clampPct(parseInt(e.target.value, 10) || 0) })}
          />
        </label>
      )}
      <div className="text-[10px] text-slate-500 col-span-2 sm:col-span-1 flex items-center gap-1">
        <ArrowDown className="w-3 h-3" /> Drag the element on the lane to move it; it snaps to anchors.
      </div>
    </div>
  );
}

// --- helpers ----------------------------------------------------------------

function collectPoleXs(elements: DiagramElement[]): number[] {
  return elements
    .filter((e) => e.t === 'pole')
    .map((e) => resolveX(e as DiagramPos, elements));
}

function parseElements(json: string): DiagramElement[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && typeof e === 'object' && typeof e.t === 'string') as DiagramElement[];
  } catch {
    return [];
  }
}
