import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, Minus, Plus, Trash2 } from 'lucide-react';
import type { ConeKind, DiagramElement, DiagramPos, DiagramTool, ItemKind } from '../types';
import { DIAGRAM_TOOLS } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import type { MessageKey } from '../i18n/en';
import type { Translate } from '../i18n/translate';
import { ElementShape, LaneCanvas } from './RaceDiagram';
import { LANE, pxToPct } from './diagramGeometry';
import {
  MAX_POLES, MIN_POLES, addContent, allowedSlotKinds, buildSlots, contentsOf, duplicateItem, fillPoles,
  fromLaneModel, isContainer, moveToSlot, nearestSlot, parseDiagram, patchItem, placeTool, removeContent,
  removeItem, setPoleCount, slotById, stepSlot, toLaneModel, toolLabel, type LaneModel, type Slot,
} from './diagramSlots';

const TOOL_KEYS: Record<string, MessageKey> = {
  'pole:': 'admin.format.diagram.tool.pole',
  'cone:flag': 'admin.format.diagram.tool.cone:flag',
  'cone:ball': 'admin.format.diagram.tool.cone:ball',
  'in:': 'admin.format.diagram.tool.in',
  'item:bucket': 'admin.format.diagram.tool.item:bucket',
  'item:bin': 'admin.format.diagram.tool.item:bin',
  'item:mug': 'admin.format.diagram.tool.item:mug',
  'item:ball': 'admin.format.diagram.tool.item:ball',
  'item:flag': 'admin.format.diagram.tool.item:flag',
  'item:sock': 'admin.format.diagram.tool.item:sock',
  'item:sack': 'admin.format.diagram.tool.item:sack',
  'item:bottle': 'admin.format.diagram.tool.item:bottle',
  'item:baton': 'admin.format.diagram.tool.item:baton',
  'item:sword': 'admin.format.diagram.tool.item:sword',
  'item:quoit': 'admin.format.diagram.tool.item:quoit',
  'item:card': 'admin.format.diagram.tool.item:card',
  'item:penny': 'admin.format.diagram.tool.item:penny',
  'item:box': 'admin.format.diagram.tool.item:box',
  'lane:': 'admin.format.diagram.tool.lane',
  'midline:': 'admin.format.diagram.midline',
};

/** The name of a kind of equipment in the chosen language; `fallback` is the English name from diagramSlots. */
function toolName(t: Translate, kind: { t: string; kind?: string }, fallback: string): string {
  const key = TOOL_KEYS[`${kind.t === 'table' ? 'in' : kind.t}:${kind.kind ?? ''}`]
    ?? (kind.t === 'item' || kind.t === 'cone' ? 'admin.format.diagram.tool.item' : undefined);
  return key ? t(key) : fallback;
}

const elementName = (t: Translate, el: DiagramElement) => toolName(t, { t: el.t, kind: (el as DiagramPos).kind }, toolLabel(el));

/** The chip label for a place on the lane ("Pole 2", "1–2"), in the chosen language. */
function slotLabel(t: Translate, slot: Slot, poleCount: number): string {
  switch (slot.kind) {
    case 'start': return t('admin.format.diagram.slot.start');
    case 'top': return t('admin.format.diagram.slot.top');
    case 'beyond': return t('admin.format.diagram.slot.beyond');
    case 'pole': return t('admin.format.diagram.slot.pole', { n: slot.index });
    default: return `${slot.index === 0 ? t('admin.format.diagram.slot.start') : slot.index}–${slot.index === poleCount ? t('admin.format.diagram.slot.top') : slot.index + 1}`;
  }
}

/** The long label for a place on the lane ("Between pole 2 and pole 3"), in the chosen language. */
function slotDescription(t: Translate, slot: Slot, poleCount: number): string {
  switch (slot.kind) {
    case 'start': return t('admin.format.diagram.slot.onStart');
    case 'top': return t('admin.format.diagram.slot.onTop');
    case 'beyond': return t('admin.format.diagram.slot.beyondTop');
    case 'pole': return t('admin.format.diagram.slot.onPole', { n: slot.index });
    default: {
      const k = slot.index;
      return t('admin.format.diagram.slot.between', {
        from: k === 0 ? t('admin.format.diagram.slot.theStart') : t('admin.format.diagram.slot.thePole', { n: k }),
        to: k === poleCount ? t('admin.format.diagram.slot.theTop') : t('admin.format.diagram.slot.thePole', { n: k + 1 }),
      });
    }
  }
}

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
  const { t } = useLanguage();
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
        <span className="font-semibold text-slate-600 dark:text-slate-300">{t('admin.format.diagram.bendingPoles')}</span>
        <button type="button" className="btn-ghost min-h-[44px] min-w-[44px] justify-center" aria-label={t('admin.format.diagram.fewerPoles')}
                disabled={model.poleCount <= MIN_POLES} onClick={() => commit(setPoleCount(model, model.poleCount - 1))}>
          <Minus className="w-4 h-4" />
        </button>
        <span className="w-6 text-center text-sm font-semibold" data-testid="pole-count">{model.poleCount}</span>
        <button type="button" className="btn-ghost min-h-[44px] min-w-[44px] justify-center" aria-label={t('admin.format.diagram.morePoles')}
                disabled={model.poleCount >= MAX_POLES} onClick={() => commit(setPoleCount(model, model.poleCount + 1))}>
          <Plus className="w-4 h-4" />
        </button>
        <button type="button" className="btn-ghost min-h-[44px]" onClick={() => commit(fillPoles(model))}>
          {t('admin.format.diagram.fillPoles')}
        </button>
        <button
          type="button"
          aria-pressed={model.midline}
          className={`btn-ghost min-h-[44px] ${model.midline ? 'bg-brand-100 dark:bg-brand-900/40 ring-1 ring-brand-300' : ''}`}
          onClick={() => commit({ ...model, midline: !model.midline })}
        >
          {t('admin.format.diagram.midline')}
        </button>
        <button type="button" className="btn-ghost min-h-[44px] text-rose-500 ml-auto" onClick={() => { commit({ ...model, items: [], midline: false }); setSelectedIndex(null); }}>
          <Trash2 className="w-4 h-4" /> {t('admin.format.diagram.clear')}
        </button>
      </div>

      <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden select-none">
        <LaneCanvas model={model} height={220} ariaLabel={t('admin.format.diagram.editorLabel')} editing={canvasEditing} />
      </div>

      <div className="overflow-x-auto -mx-1 px-1 pb-1" role="group" aria-label={t('admin.format.diagram.places')}>
        <div className="flex gap-1.5 min-w-max">
          {slots.map((s) => {
            const count = model.items.filter((it) => it.slot === s.id).length;
            const on = s.id === activeSlotId;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                aria-label={slotDescription(t, s, model.poleCount)}
                onClick={() => selectSlot(s.id)}
                className={`relative min-h-[44px] min-w-[52px] px-2 rounded-lg border text-xs font-semibold whitespace-nowrap
                  ${on ? 'bg-sky-100 border-sky-500 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100' : 'bg-white/70 border-slate-300 text-slate-700 dark:bg-slate-800/60 dark:border-slate-600 dark:text-slate-200'}
                  ${s.kind === 'pole' ? '' : 'italic font-medium'}`}
              >
                {slotLabel(t, s, model.poleCount)}
                {count > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-amber-400 text-slate-900 text-[10px] font-bold leading-[18px] text-center">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {!activeSlot && !selected && (
        <p className="text-sm text-slate-500">
          {model.items.length === 0 ? t('admin.format.diagram.tapToPlace') : t('admin.format.diagram.tapToEdit')}
        </p>
      )}

      {activeSlot && !selected && (
        <div className="card p-3 space-y-2" data-testid="slot-panel">
          <div className="text-sm font-semibold">{slotDescription(t, activeSlot, model.poleCount)}</div>
          {itemsHere.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {itemsHere.map(({ it, i }) => (
                <button key={i} type="button" className="btn-ghost min-h-[44px]" onClick={() => selectItem(i)}>
                  {elementName(t, it.el)}{(it.el as DiagramPos).label ? ` · ${(it.el as DiagramPos).label}` : ''}
                </button>
              ))}
            </div>
          )}
          <span className="text-xs text-slate-500 block">{t('admin.format.diagram.addHere')}</span>
          <ToolGrid onPick={place} disablePoles={activeSlot.kind !== 'pole'} />
        </div>
      )}

      {selected && selectedIndex !== null && (
        <SelectedPanel
          model={model}
          index={selectedIndex}
          slotLabel={(() => { const slot = slotById(slots, selected.slot); return slot ? slotDescription(t, slot, model.poleCount) : ''; })()}
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

const GROUPS: { label: MessageKey; match: (t: DiagramTool) => boolean }[] = [
  { label: 'admin.format.diagram.group.lane', match: (t) => t.t !== 'cone' && t.t !== 'item' },
  { label: 'admin.format.diagram.group.cones', match: (t) => t.t === 'cone' },
  { label: 'admin.format.diagram.group.equipment', match: (t) => t.t === 'item' },
];

function ToolGrid({ onPick, disablePoles, hidePoles }: { onPick: (t: DiagramTool) => void; disablePoles?: boolean; hidePoles?: boolean }) {
  const { t: tr } = useLanguage();
  return (
    <div className="space-y-2">
      {GROUPS.map((g) => {
        const tools = DIAGRAM_TOOLS.filter((d) => g.match(d) && !(hidePoles && d.t === 'pole'));
        if (tools.length === 0) return null;
        return (
          <div key={g.label}>
            <span className="text-[11px] uppercase tracking-wide text-slate-500 block mb-1">{tr(g.label)}</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {tools.map((d) => (
                <button
                  key={d.t + (d.kind ?? '')}
                  type="button"
                  className="btn-ghost min-h-[44px] justify-start gap-2 text-sm disabled:opacity-40"
                  disabled={disablePoles && d.t === 'pole'}
                  title={d.t === 'pole' && disablePoles ? tr('admin.format.diagram.polesOnly') : tr('admin.format.diagram.addA', { tool: toolName(tr, d, d.label).toLowerCase() })}
                  onClick={() => onPick(d)}
                >
                  <ToolPreview t={d.t} kind={d.kind} /> {toolName(tr, d, d.label)}
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
  const { t } = useLanguage();
  const item = model.items[index];
  const el = item.el as DiagramPos & { t: DiagramElement['t'] };
  const contents = contentsOf(item.el);
  const container = isContainer(item.el);
  return (
    <div className="card p-3 space-y-3" data-testid="selected-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{elementName(t, item.el)}</div>
          <div className="text-xs text-slate-500">{slotLabel}</div>
        </div>
        <button type="button" className="btn-ghost min-h-[44px]" onClick={onDone}>{t('common.done')}</button>
      </div>

      <label className="block">
        <span className="text-xs text-slate-500">{t('admin.format.diagram.nameLabel')}</span>
        <input
          className="input mt-0.5 text-sm"
          value={el.label ?? ''}
          onChange={(e) => onChange(patchItem(model, index, { label: e.target.value }))}
          placeholder={el.t === 'pole' ? t('admin.format.diagram.poleExample') : t('admin.format.diagram.itemExample')}
        />
      </label>

      <div className="grid grid-cols-4 gap-1.5">
        <button type="button" className="btn-ghost min-h-[44px] justify-center" aria-label={t('admin.format.diagram.towardsStart')} disabled={!canBack} onClick={() => onMove(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button type="button" className="btn-ghost min-h-[44px] justify-center" aria-label={t('admin.format.diagram.towardsTop')} disabled={!canForward} onClick={() => onMove(1)}>
          <ArrowRight className="w-5 h-5" />
        </button>
        <button type="button" className="btn-ghost min-h-[44px] justify-center" aria-label={t('admin.format.diagram.duplicate')} onClick={onDuplicate}>
          <Copy className="w-5 h-5" />
        </button>
        <button type="button" className="btn-ghost min-h-[44px] justify-center text-rose-500" aria-label={t('common.delete')} onClick={onDelete}>
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      {container && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 space-y-2" data-testid="contents-panel">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">{t('admin.format.diagram.whatsOnIt')}</span>
          {contents.length === 0 && <p className="text-xs text-slate-500">{t('admin.format.diagram.nothingYet')}</p>}
          {contents.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <ToolPreview t={c.tool.t} kind={c.tool.kind} />
              <span className="flex-1 text-sm">{toolName(t, c.tool, c.label)}</span>
              <button type="button" className="btn-ghost min-h-[44px] min-w-[44px] justify-center" aria-label={t('admin.format.diagram.removeA', { tool: toolName(t, c.tool, c.label).toLowerCase() })}
                      onClick={() => onChange(removeContent(model, index, c.key))}>
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-5 text-center text-sm font-semibold">{c.count}</span>
              <button type="button" className="btn-ghost min-h-[44px] min-w-[44px] justify-center" aria-label={t('admin.format.diagram.addA', { tool: toolName(t, c.tool, c.label).toLowerCase() })}
                      onClick={() => onChange(addContent(model, index, c.tool))}>
                <Plus className="w-4 h-4" />
              </button>
            </div>
          ))}
          <span className="text-xs text-slate-500 block">{t('admin.format.diagram.putOnIt')}</span>
          <ToolGrid hidePoles onPick={(t) => onChange(addContent(model, index, t))} />
        </div>
      )}
    </div>
  );
}
