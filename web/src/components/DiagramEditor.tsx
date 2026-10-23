import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, Minus, Plus, Trash2 } from 'lucide-react';
import type { ConeKind, DiagramElement, DiagramPos, DiagramTool, ItemKind } from '../types';
import { DIAGRAM_TOOLS } from '../types';
import { ElementShape, LaneCanvas } from './RaceDiagram';
import { LANE, pxToPct } from './diagramGeometry';
import {
  MAX_POLES, MIN_POLES, addContent, allowedSlotKinds, buildSlots, contentsOf, duplicateItem, fillPoles,
  fromLaneModel, isContainer, moveToSlot, nearestSlot, parseDiagram, patchItem, placeTool, removeContent,
  removeItem, setPoleCount, slotById, stepSlot, toLaneModel, toolLabel, type LaneModel,
} from './diagramSlots';

interface Props {
  value: string;
  onChange: (json: string) => void;
}

/**
 * Editor for race diagrams, built on the lane's slots (see diagramSlots.ts).
 *
 * 1. Tap a spot on the lane, or one of the slot buttons under it: a pole, a
 *    gap between two poles, the start line, the top line or beyond it.
 * 2. Pick what goes there.
 * 3. Tap an element to rename it, move it slot to slot (arrow buttons, or
 *    drag it on the lane), duplicate it, delete it, or say what's on it.
 */
export function DiagramEditor({ value, onChange }: Props) {
  const model = useMemo(() => toLaneModel(parseDiagram(value)), [value]);
  const slots = useMemo(() => buildSlots(model.poleCount), [model.poleCount]);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef<number | null>(null);

  const selected = selectedIndex !== null ? model.items[selectedIndex] : undefined;
  const activeSlot = slotById(slots, activeSlotId ?? undefined);

  function commit(next: LaneModel) {
    onChange(JSON.stringify(fromLaneModel(next)));
  }

  function slotFromPointer(e: { clientX: number }, kinds?: ReturnType<typeof allowedSlotKinds>) {
    const rect = svgRef.current?.getBoundingClientRect();
    const svgX = rect && rect.width > 0 ? ((e.clientX - rect.left) / rect.width) * 800 : LANE.left;
    return nearestSlot(slots, pxToPct(svgX), kinds);
  }

  function selectSlot(id: string) {
    setActiveSlotId(id);
    setSelectedIndex(null);
  }

  function place(tool: DiagramTool) {
    if (!activeSlot) return;
    const next = placeTool(model, tool, activeSlot.id);
    if (next === model) return;
    commit(next);
    setSelectedIndex(next.items.length - 1);
  }

  function selectItem(index: number) {
    setSelectedIndex(index);
    setActiveSlotId(model.items[index]?.slot ?? null);
  }

  function moveSelected(direction: -1 | 1) {
    if (selectedIndex === null) return;
    const to = stepSlot(model, selectedIndex, direction);
    if (!to) return;
    commit(moveToSlot(model, selectedIndex, to));
    setActiveSlotId(to);
  }

  const canvasEditing = {
    svgRef,
    selectedIndex,
    activeSlotId,
    placing: false,
    onBackgroundDown: (e: React.PointerEvent<SVGSVGElement>) => selectSlot(slotFromPointer(e).id),
    onElementDown: (index: number, e: React.PointerEvent<SVGGElement>) => {
      e.stopPropagation();
      selectItem(index);
      try { svgRef.current?.setPointerCapture?.(e.pointerId); } catch { /* unsupported */ }
      dragging.current = index;
    },
    onMove: (e: React.PointerEvent<SVGSVGElement>) => {
      const index = dragging.current;
      if (index === null) return;
      const item = model.items[index];
      if (!item) return;
      const slot = slotFromPointer(e, allowedSlotKinds(item.el));
      if (slot.id === item.slot) return;
      commit(moveToSlot(model, index, slot.id));
      setActiveSlotId(slot.id);
    },
    onUp: () => { dragging.current = null; },
  };

  const itemsHere = activeSlot ? model.items.map((it, i) => ({ it, i })).filter(({ it }) => it.slot === activeSlot.id) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="font-semibold text-slate-600 dark:text-slate-300">Bending poles</span>
        <button type="button" className="btn-ghost min-h-[44px] min-w-[44px] justify-center" aria-label="Fewer poles"
                disabled={model.poleCount <= MIN_POLES} onClick={() => commit(setPoleCount(model, model.poleCount - 1))}>
          <Minus className="w-4 h-4" />
        </button>
        <span className="w-6 text-center text-sm font-semibold" data-testid="pole-count">{model.poleCount}</span>
        <button type="button" className="btn-ghost min-h-[44px] min-w-[44px] justify-center" aria-label="More poles"
                disabled={model.poleCount >= MAX_POLES} onClick={() => commit(setPoleCount(model, model.poleCount + 1))}>
          <Plus className="w-4 h-4" />
        </button>
        <button type="button" className="btn-ghost min-h-[44px]" onClick={() => commit(fillPoles(model))}>
          Put a pole in every position
        </button>
        <button
          type="button"
          aria-pressed={model.midline}
          className={`btn-ghost min-h-[44px] ${model.midline ? 'bg-brand-100 dark:bg-brand-900/40 ring-1 ring-brand-300' : ''}`}
          onClick={() => commit({ ...model, midline: !model.midline })}
        >
          Midline
        </button>
        <button type="button" className="btn-ghost min-h-[44px] text-rose-500 ml-auto" onClick={() => { commit({ ...model, items: [], midline: false }); setSelectedIndex(null); }}>
          <Trash2 className="w-4 h-4" /> Clear
        </button>
      </div>

      <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden select-none">
        <LaneCanvas model={model} height={220} ariaLabel="Race diagram editor" editing={canvasEditing} />
      </div>

      <div className="overflow-x-auto -mx-1 px-1 pb-1" role="group" aria-label="Places on the lane">
        <div className="flex gap-1.5 min-w-max">
          {slots.map((s) => {
            const count = model.items.filter((it) => it.slot === s.id).length;
            const on = s.id === activeSlotId;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                aria-label={s.description}
                onClick={() => selectSlot(s.id)}
                className={`relative min-h-[44px] min-w-[52px] px-2 rounded-lg border text-xs font-semibold whitespace-nowrap
                  ${on ? 'bg-sky-100 border-sky-500 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100' : 'bg-white/70 border-slate-300 text-slate-700 dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200'}
                  ${s.kind === 'pole' ? '' : 'italic font-medium'}`}
              >
                {s.label}
                {count > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-amber-500 text-white text-[10px] leading-[18px] text-center">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {!activeSlot && !selected && (
        <p className="text-sm text-slate-500">
          {model.items.length === 0 ? 'Tap a pole or a gap on the lane (or a button above) to start placing equipment.' : 'Tap an element to edit it, or a spot on the lane to add something.'}
        </p>
      )}

      {activeSlot && !selected && (
        <div className="card p-3 space-y-2" data-testid="slot-panel">
          <div className="text-sm font-semibold">{activeSlot.description}</div>
          {itemsHere.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {itemsHere.map(({ it, i }) => (
                <button key={i} type="button" className="btn-ghost min-h-[44px]" onClick={() => selectItem(i)}>
                  {toolLabel(it.el)}{(it.el as DiagramPos).label ? ` · ${(it.el as DiagramPos).label}` : ''}
                </button>
              ))}
            </div>
          )}
          <span className="text-xs text-slate-500 block">Add here:</span>
          <ToolGrid onPick={place} disablePoles={activeSlot.kind !== 'pole'} />
        </div>
      )}

      {selected && selectedIndex !== null && (
        <SelectedPanel
          model={model}
          index={selectedIndex}
          slotLabel={slotById(slots, selected.slot)?.description ?? ''}
          canBack={stepSlot(model, selectedIndex, -1) !== null}
          canForward={stepSlot(model, selectedIndex, 1) !== null}
          onMove={moveSelected}
          onChange={commit}
          onDuplicate={() => { commit(duplicateItem(model, selectedIndex)); setSelectedIndex(selectedIndex + 1); }}
          onDelete={() => { commit(removeItem(model, selectedIndex)); setSelectedIndex(null); }}
          onDone={() => setSelectedIndex(null)}
        />
      )}
    </div>
  );
}

const GROUPS: { label: string; match: (t: DiagramTool) => boolean }[] = [
  { label: 'Lane', match: (t) => t.t !== 'cone' && t.t !== 'item' },
  { label: 'Cones', match: (t) => t.t === 'cone' },
  { label: 'Equipment', match: (t) => t.t === 'item' },
];

function ToolGrid({ onPick, disablePoles, hidePoles }: { onPick: (t: DiagramTool) => void; disablePoles?: boolean; hidePoles?: boolean }) {
  return (
    <div className="space-y-2">
      {GROUPS.map((g) => {
        const tools = DIAGRAM_TOOLS.filter((t) => g.match(t) && !(hidePoles && t.t === 'pole'));
        if (tools.length === 0) return null;
        return (
          <div key={g.label}>
            <span className="text-[11px] uppercase tracking-wide text-slate-500 block mb-1">{g.label}</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {tools.map((t) => (
                <button
                  key={t.t + (t.kind ?? '')}
                  type="button"
                  className="btn-ghost min-h-[44px] justify-start gap-2 text-sm disabled:opacity-40"
                  disabled={disablePoles && t.t === 'pole'}
                  title={t.t === 'pole' && disablePoles ? 'Poles only go on pole positions' : `Add a ${t.label.toLowerCase()}`}
                  onClick={() => onPick(t)}
                >
                  <ToolPreview t={t.t} kind={t.kind} /> {t.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Small inline SVG preview of the tool's shape, used inside buttons. */
function ToolPreview({ t, kind }: { t: DiagramElement['t']; kind?: ConeKind | ItemKind }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <ElementShape el={{ t, kind } as DiagramElement} x={12} y={12} />
    </svg>
  );
}

function SelectedPanel({
  model, index, slotLabel, canBack, canForward, onMove, onChange, onDuplicate, onDelete, onDone,
}: {
  model: LaneModel;
  index: number;
  slotLabel: string;
  canBack: boolean;
  canForward: boolean;
  onMove: (direction: -1 | 1) => void;
  onChange: (next: LaneModel) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const item = model.items[index];
  const el = item.el as DiagramPos & { t: DiagramElement['t'] };
  const contents = contentsOf(item.el);
  const container = isContainer(item.el);
  return (
    <div className="card p-3 space-y-3" data-testid="selected-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{toolLabel(item.el)}</div>
          <div className="text-xs text-slate-500">{slotLabel}</div>
        </div>
        <button type="button" className="btn-ghost min-h-[44px]" onClick={onDone}>Done</button>
      </div>

      <label className="block">
        <span className="text-xs text-slate-500">Name / label</span>
        <input
          className="input mt-0.5 text-sm"
          value={el.label ?? ''}
          onChange={(e) => onChange(patchItem(model, index, { label: e.target.value }))}
          placeholder={el.t === 'pole' ? 'e.g. 1, 2, 3' : 'e.g. EGUK flag, blue mug'}
        />
      </label>

      <div className="grid grid-cols-4 gap-1.5">
        <button type="button" className="btn-ghost min-h-[44px] justify-center" aria-label="Move towards the start" disabled={!canBack} onClick={() => onMove(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button type="button" className="btn-ghost min-h-[44px] justify-center" aria-label="Move towards the top" disabled={!canForward} onClick={() => onMove(1)}>
          <ArrowRight className="w-5 h-5" />
        </button>
        <button type="button" className="btn-ghost min-h-[44px] justify-center" aria-label="Duplicate" onClick={onDuplicate}>
          <Copy className="w-5 h-5" />
        </button>
        <button type="button" className="btn-ghost min-h-[44px] justify-center text-rose-500" aria-label="Delete" onClick={onDelete}>
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      {container && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 space-y-2" data-testid="contents-panel">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">What&apos;s on it</span>
          {contents.length === 0 && <p className="text-xs text-slate-500">Nothing yet. Pick something below to put it on.</p>}
          {contents.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <ToolPreview t={c.tool.t} kind={c.tool.kind} />
              <span className="flex-1 text-sm">{c.label}</span>
              <button type="button" className="btn-ghost min-h-[44px] min-w-[44px] justify-center" aria-label={`Remove a ${c.label.toLowerCase()}`}
                      onClick={() => onChange(removeContent(model, index, c.key))}>
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-5 text-center text-sm font-semibold">{c.count}</span>
              <button type="button" className="btn-ghost min-h-[44px] min-w-[44px] justify-center" aria-label={`Add a ${c.label.toLowerCase()}`}
                      onClick={() => onChange(addContent(model, index, c.tool))}>
                <Plus className="w-4 h-4" />
              </button>
            </div>
          ))}
          <span className="text-xs text-slate-500 block">Put on it:</span>
          <ToolGrid hidePoles onPick={(t) => onChange(addContent(model, index, t))} />
        </div>
      )}
    </div>
  );
}
