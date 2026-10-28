import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { useT } from '../../../i18n/LanguageContext';
import { defaultRaceList, SCOPE_LABEL, type RaceScope } from '../../../lib/defaultRaces';
import { finalCountOf, sectionHasFinal, sectionName, type CreatorDraft, type SectionDraft } from '../../../lib/creatorDraft';
import {
  dropIndex, followsFirst, isFinalKey, isKeyLocked, makeRoom, moveItem, raceKeyLabel, raceKeys, racesOf, withFollowsFirst, withRaces, type RaceKey,
} from '../../../lib/creatorRaces';
import { RefineSwitchRow } from '../../refine/Refine';
import { AddBar, SecHead, StepHeading } from './controls';
import type { StepProps } from './parts';

/** Six dots: the grip for dragging a race. */
function GripIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="6" r="1.7" /><circle cx="9" cy="12" r="1.7" /><circle cx="15" cy="12" r="1.7" /><circle cx="9" cy="18" r="1.7" /><circle cx="15" cy="18" r="1.7" />
    </svg>
  );
}

interface Drag { name: string; from: number; to: number; dy: number; height: number }

/**
 * Races for each age group, a tab for each session and each final. Rows are put in order by dragging the six-dot grip,
 * or with the up and down arrow keys while the grip has focus. Nothing here is required: a list can be left for later.
 */
export function RacesStep({ draft, change, templates }: StepProps<CreatorDraft> & { templates: string[] }) {
  const t = useT();
  const [tab, setTab] = useState<Record<number, RaceKey>>({});
  const [picker, setPicker] = useState<number | null>(null);
  const [presets, setPresets] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const edit = (si: number, next: (s: SectionDraft) => SectionDraft) => change({ sections: draft.sections.map((s, i) => (i === si ? next(s) : s)) });

  function grab(e: ReactPointerEvent<HTMLButtonElement>, si: number, key: RaceKey, list: string[], index: number) {
    if (e.button > 0) return;
    e.preventDefault();
    const row = e.currentTarget.closest('[data-race-row]');
    const height = row ? row.getBoundingClientRect().height : 56;
    const y0 = e.clientY;
    const start: Drag = { name: list[index], from: index, to: index, dy: 0, height };
    dragRef.current = start;
    setDrag(start);
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      const next = { ...start, dy, to: dropIndex(index, dy, height, list.length) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const done = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (done && done.to !== done.from) edit(si, (s) => withRaces(s, key, moveItem(list, done.from, done.to)));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function keys(e: ReactKeyboardEvent<HTMLButtonElement>, si: number, key: RaceKey, list: string[], index: number) {
    const by = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!by || index + by < 0 || index + by >= list.length) return;
    e.preventDefault();
    edit(si, (s) => withRaces(s, key, moveItem(list, index, index + by)));
  }

  return (
    <section aria-label={t('admin.creator.step.races')} className="flex flex-col">
      <StepHeading>{t('admin.creator.step.races')}</StepHeading>
      {draft.sections.map((s, si) => {
        const name = sectionName(s);
        const finals = finalCountOf(s);
        const all = raceKeys(s);
        const active: RaceKey = all.includes(tab[si] as RaceKey) ? (tab[si] as RaceKey) : 1;
        const same = followsFirst(s, active);
        const locked = isKeyLocked(s, active);
        const list = racesOf(s, active) ?? [];
        const editable = !same && !locked;
        const final = isFinalKey(active);
        const matches = templates.filter((tpl) => !list.includes(tpl) && tpl.toLowerCase().includes(query.trim().toLowerCase()));
        const typed = query.trim();
        const canAddTyped = typed.length > 0 && !list.some((x) => x.toLowerCase() === typed.toLowerCase()) && !templates.some((tpl) => tpl.toLowerCase() === typed.toLowerCase());
        const setList = (races: string[] | null) => edit(si, (cur) => withRaces(cur, active, races));
        return (
          <section key={s.existingId ?? `new-${si}`} aria-label={name}>
            <SecHead name={name} first={si === 0} sub={finals > 1 ? t('admin.creator.races.sub', { entries: s.maxParticipants, size: s.maxTeamsPerHeat, finals }) : undefined} />
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              {all.length > 1 && (
                <div className="cw-seg" role="tablist" aria-label={t('admin.creator.races.listFor')}>
                  {all.map((k) => (
                    <button key={String(k)} type="button" role="tab" aria-selected={k === active} onClick={() => { setTab({ ...tab, [si]: k }); setPicker(null); setPresets(null); }}>
                      {raceKeyLabel(k, finals)}
                    </button>
                  ))}
                </div>
              )}
              {!s.usesRaceFinals && !sectionHasFinal(s) && (
                <button type="button" className="cw-btn cw-btn-s" onClick={() => { edit(si, (cur) => ({ ...cur, hasFinal: true })); setTab({ ...tab, [si]: 'f' }); }}>
                  <Plus className="h-4 w-4" aria-hidden="true" />{t('admin.creator.races.addFinal')}
                </button>
              )}
              {final && !s.finalHasHeats && !s.finalScored && (
                <button type="button" className="cw-btn cw-btn-s cw-btn-d" onClick={() => { edit(si, (cur) => ({ ...cur, hasFinal: false })); setTab({ ...tab, [si]: 1 }); }}>
                  {finals > 1 ? t('admin.creator.races.removeFinals') : t('admin.creator.races.removeFinal')}
                </button>
              )}
            </div>

            <div className="cw-card" role="list" aria-label={t('admin.creator.races.listAria', { label: raceKeyLabel(active, finals) })}>
              {!final && active !== 1 && !locked && (
                <div className="cw-sw-row" role="listitem">
                  <RefineSwitchRow label={t('admin.creator.races.same')} on={same} onChange={(on) => edit(si, (cur) => withFollowsFirst(cur, active as number, on))} />
                </div>
              )}
              {locked && <div className="cw-row" role="listitem"><span className="cw-t2">{t('admin.creator.races.locked')}</span></div>}
              {list.length === 0 && !locked && <div className="cw-row" role="listitem"><span className="cw-t2">{t('admin.creator.races.none')}</span></div>}
              {list.map((race, i) => {
                const lifted = drag?.name === race;
                const shift = drag && !lifted ? makeRoom(i, drag.from, drag.to, drag.height) : 0;
                return (
                  <div key={race} role="listitem" data-race-row="" data-same={same} data-lifted={lifted} className="cw-race"
                    style={lifted && drag ? { transform: `translateY(${drag.dy}px)` } : shift ? { transform: `translateY(${shift}px)` } : undefined}>
                    {editable
                      ? (
                        <button type="button" className="cw-grip" aria-label={t('admin.creator.races.move', { race })}
                          onPointerDown={(e) => grab(e, si, active, list, i)} onKeyDown={(e) => keys(e, si, active, list, i)}><GripIcon /></button>
                      )
                      : <span style={{ width: 8 }} />}
                    <span className="cw-num">{i + 1}</span>
                    <span className="cw-grow cw-t1">{race}</span>
                    {editable && (
                      <button type="button" className="cw-ib cw-ib-red" aria-label={t('admin.creator.races.removeRace', { race })} onClick={() => setList(list.filter((_, j) => j !== i))}>
                        <X className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {editable && (
              <>
                {picker !== si && <div style={{ marginTop: 10 }}><AddBar onClick={() => { setPicker(si); setQuery(''); setPresets(null); }}>{t('admin.creator.races.add')}</AddBar></div>}
                <div className="cw-acts" style={{ marginTop: 10 }}>
                  <button type="button" className="cw-btn cw-btn-s" aria-expanded={presets === si} onClick={() => { setPresets(presets === si ? null : si); setPicker(null); }}>{t('admin.creator.races.preset')}</button>
                  <button type="button" className="cw-btn cw-btn-s" onClick={() => setList(null)}>{t('admin.creator.races.later')}</button>
                </div>
                {presets === si && (
                  <div className="cw-card" style={{ marginTop: 10 }}>
                    {(['Zone', 'Area'] as RaceScope[]).map((scope) => {
                      const races = defaultRaceList(scope, s.format, s.ageGroup);
                      return (
                        <div key={scope} className="cw-row">
                          <span className="cw-grow"><span className="cw-t1">{t('admin.creator.races.scopeList', { scope: SCOPE_LABEL[scope], count: races.length })}</span><span className="cw-t2">{races.join(', ')}</span></span>
                          <button type="button" className="cw-btn cw-btn-s" aria-label={t('admin.creator.races.useScope', { scope: SCOPE_LABEL[scope] })} onClick={() => { setList(races); setPresets(null); }}>{t('admin.creator.races.useThis')}</button>
                        </div>
                      );
                    })}
                    <div className="cw-row" style={{ minHeight: 48 }}><button type="button" className="cw-btn cw-btn-s" onClick={() => setPresets(null)}>{t('common.close')}</button></div>
                  </div>
                )}
                {picker === si && (
                  <div className="cw-card" style={{ marginTop: 10 }}>
                    <div className="cw-panel">
                      <label className="cw-fld">{t('admin.creator.races.find')}
                        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.creator.races.filter')} autoComplete="off" />
                      </label>
                      <div className="cw-libgrid">
                        {matches.map((tpl) => (
                          <button key={tpl} type="button" className="cw-pick" onClick={() => setList([...list, tpl])}><span>{tpl}</span><Plus className="h-4 w-4" aria-hidden="true" /></button>
                        ))}
                        {canAddTyped && (
                          <button type="button" className="cw-pick" onClick={() => { setList([...list, typed]); setQuery(''); }}><span>{t('admin.creator.races.addTyped', { typed })}</span><Plus className="h-4 w-4" aria-hidden="true" /></button>
                        )}
                      </div>
                      {matches.length === 0 && !canAddTyped && <span className="cw-t2">{t('admin.creator.noMatch')}</span>}
                      <div><button type="button" className="cw-btn cw-btn-s" onClick={() => { setPicker(null); setQuery(''); }}>{t('common.done')}</button></div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}
    </section>
  );
}
