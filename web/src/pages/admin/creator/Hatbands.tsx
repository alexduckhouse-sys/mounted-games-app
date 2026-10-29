import { useState } from 'react';
import { useT } from '../../../i18n/LanguageContext';
import { GripButton } from '../../../components/GripButton';
import { useRowDrag } from '../../../hooks/useRowDrag';
import { moveItem } from '../../../lib/creatorRaces';
import {
  arenaOf, hatbandsFor, lanesOfArena, MAX_LANES, HATBAND_COLOURS, type CreatorDraft,
} from '../../../lib/creatorDraft';
import { formatHatband, HATBAND_PALETTE, hatbandColour, hatbandHex, hatbandName, isHatbandHex } from '../../../lib/hatbands';
import { RefineMenu } from '../../refine/Refine';
import { AddRow, SmallHead } from './controls';

const dotStyle = (stored: string) => ({ background: hatbandColour(stored), borderColor: hatbandColour(stored).toUpperCase() === '#FFFFFF' ? 'rgb(var(--mg-faint))' : undefined });

/** A name and a colour: the two rows used to add a hatband and to change one. */
function BandFields({ name, hex, onName, onHex }: { name: string; hex: string; onName: (v: string) => void; onHex: (v: string) => void }) {
  const t = useT();
  return (
    <div>
      <label className="cw-vrow"><span>{t('admin.creator.name')}</span>
        <input aria-label={t('admin.creator.hat.bandName')} value={name} placeholder={t('admin.creator.hat.anyName')} style={{ width: 170 }} onChange={(e) => onName(e.target.value)} />
      </label>
      <label className="cw-vrow"><span>{t('admin.creator.hat.colour')}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input type="color" aria-label={t('admin.creator.hat.colour')} value={isHatbandHex(hex) ? hex.toLowerCase() : '#ffffff'} onChange={(e) => onHex(e.target.value.toUpperCase())} />
          <input aria-label={t('admin.creator.hat.colourCode')} value={hex} style={{ width: 100, fontFamily: 'ui-monospace, monospace' }} onChange={(e) => onHex(e.target.value)} />
        </span>
      </label>
    </div>
  );
}

/**
 * The hatbands, one for each lane in order, as many as the biggest arena has lanes. Each has any name and any colour.
 * Rows are put in order by dragging the six-dot grip (or the arrow keys while it has focus), and a ⋯ menu changes a colour or removes one.
 */
export function HatbandEditor({ draft, change }: { draft: CreatorDraft; change: (patch: Partial<CreatorDraft>) => void }) {
  const t = useT();
  const list = hatbandsFor(draft);
  const room = Math.min(MAX_LANES, Math.max(...draft.arenas.map(lanesOfArena), ...draft.sections.map((s) => lanesOfArena(arenaOf(draft, s)))));
  const [editing, setEditing] = useState<{ index: number; name: string; hex: string } | null>(null);
  const [adding, setAdding] = useState<{ name: string; hex: string } | null>(null);
  const save = (next: string[]) => change({ laneHatbands: next, noHatbands: next.length === 0 });

  const { grab, keys, lifted, rowStyle } = useRowDrag();
  const onMove = (from: number, to: number) => {
    setEditing(null);
    save(moveItem(list, from, to));
  };

  return (
    <div role="group" aria-label={t('admin.creator.hat.heading')}>
      <SmallHead>{t('admin.creator.hat.heading')}</SmallHead>
      <div className="cw-card" data-row-list="">
        {list.map((stored, i) => {
          const name = hatbandName(stored) || t('admin.creator.hat.lane', { n: i + 1 });
          const open = editing?.index === i;
          return (
            <div key={i}>
              <div className="cw-row" data-race-row="" data-lifted={lifted(i)} style={{ gap: 8, ...rowStyle(i) }}>
                <GripButton label={t('admin.creator.hat.move', { name })} onPointerDown={(e) => { setEditing(null); grab(e, i, list.length, onMove); }} onKeyDown={(e) => keys(e, i, list.length, onMove)} />
                <span className="cw-lane" aria-hidden="true">{i + 1}</span>
                <span className="cw-dot" aria-hidden="true" style={dotStyle(stored)} />
                <span className="cw-grow cw-t1">{name}</span>
                <RefineMenu label={t('admin.creator.hat.moreFor', { name })} items={[
                  { label: t('admin.creator.hat.change'), onSelect: () => { setAdding(null); setEditing({ index: i, name: hatbandName(stored), hex: hatbandHex(stored) }); } },
                  { label: t('admin.creator.remove'), danger: true, onSelect: () => { setEditing(null); save(list.filter((_, j) => j !== i)); } },
                ]} />
              </div>
              {open && editing && (
                <div className="cw-edit">
                  <BandFields name={editing.name} hex={editing.hex}
                    onName={(v) => { setEditing({ ...editing, name: v }); save(list.map((x, j) => (j === i ? formatHatband(v, hatbandHex(x)) : x))); }}
                    onHex={(v) => {
                      setEditing({ ...editing, hex: v });
                      if (isHatbandHex(v)) save(list.map((x, j) => (j === i ? formatHatband(editing.name, v) : x)));
                    }} />
                  <div className="cw-acts" style={{ justifyContent: 'flex-end', paddingTop: 6 }}>
                    <button type="button" className="cw-btn cw-btn-p cw-btn-s" onClick={() => {
                      if (!editing.name.trim()) save(list.map((x, j) => (j === i ? formatHatband(t('admin.creator.hat.lane', { n: i + 1 }), hatbandHex(x)) : x)));
                      setEditing(null);
                    }}>{t('common.done')}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="cw-row"><span className="cw-grow cw-t2">{t('admin.creator.hat.none')}</span>
            <button type="button" className="cw-btn cw-btn-s" onClick={() => save(HATBAND_COLOURS.slice(0, Math.min(6, room)))}>{t('admin.creator.hat.usual')}</button>
          </div>
        )}
        {list.length < room && !adding && <AddRow onClick={() => { setEditing(null); setAdding({ name: '', hex: '#C8202F' }); }}>{t('admin.creator.hat.addRow')}</AddRow>}
        {adding && (
          <div className="cw-panel" style={{ background: 'rgb(var(--mg-subtle))' }}>
            <div role="group" aria-label={t('admin.creator.hat.quick')} className="cw-palette">
              {Object.entries(HATBAND_PALETTE).map(([name, hex]) => (
                <button key={name} type="button" disabled={list.some((x) => hatbandName(x) === name)} onClick={() => setAdding({ name, hex })}>
                  <span className="cw-dot" aria-hidden="true" style={{ width: 14, height: 14, background: hex }} />{name}
                </button>
              ))}
            </div>
            <BandFields name={adding.name} hex={adding.hex} onName={(name) => setAdding({ ...adding, name })} onHex={(hex) => setAdding({ ...adding, hex })} />
            <div className="cw-acts">
              <button type="button" className="cw-btn cw-btn-p cw-btn-s" disabled={!adding.name.trim() || !isHatbandHex(adding.hex)}
                onClick={() => { save([...list, formatHatband(adding.name, adding.hex)]); setAdding(null); }}>{t('admin.creator.hat.add')}</button>
              <button type="button" className="cw-btn cw-btn-s" onClick={() => setAdding(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        )}
      </div>
      {list.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="cw-btn cw-btn-s cw-btn-d" onClick={() => { setEditing(null); setAdding(null); save([]); }}>{t('admin.creator.hat.removeAll')}</button>
        </div>
      )}
    </div>
  );
}
