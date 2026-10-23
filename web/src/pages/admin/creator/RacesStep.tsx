import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { SCOPE_LABEL, defaultRaceList, type RaceScope } from '../../../lib/defaultRaces';
import { isLocked, newSessionName, sectionName, type CreatorDraft, type SectionDraft } from '../../../lib/creatorDraft';
import { raceCountFor } from '../../../lib/creatorPlan';
import { RaceListDialog } from '../RaceListDialog';
import { StepIntro, type StepProps } from './parts';

/** Races for each session. Nothing here is required: races can be chosen now or left until the day. */
export function RacesStep({ draft, change, templates }: StepProps<CreatorDraft> & { templates: string[] }) {
  const [editing, setEditing] = useState<{ section: number; session: number } | null>(null);
  const setRaces = (si: number, ji: number, races: string[] | null) =>
    change({ sections: draft.sections.map((s, i) => (i !== si ? s : { ...s, sessions: s.sessions.map((x, j) => (j === ji && !isLocked(x) ? { ...x, races } : x)) })) });
  const setAll = (si: number, races: (s: SectionDraft) => string[] | null) =>
    change({ sections: draft.sections.map((s, i) => (i !== si ? s : { ...s, sessions: s.sessions.map((x) => (isLocked(x) ? x : { ...x, races: races(s) })) })) });

  const target = editing ? draft.sections[editing.section]?.sessions[editing.session] : undefined;
  const targetSection = editing ? draft.sections[editing.section] : undefined;

  return (
    <section aria-labelledby="cw-races" className="flex flex-col gap-[18px]">
      <StepIntro title="Races">
        The races each heat will run. You can skip this and choose them later, right up to the day.
      </StepIntro>
      <div className="flex flex-col gap-4">
        {draft.sections.map((s, si) => (
          <div key={s.existingId ?? `new-${si}`} role="group" aria-label={`Races for ${sectionName(s)}`} className="mg-card flex flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-[rgb(var(--mg-rule-soft))] px-4 py-3">
              <strong className="min-w-0 flex-1 text-[17px] text-[rgb(var(--mg-heading))]">{sectionName(s)}</strong>
              {(['Zone', 'Area'] as RaceScope[]).map((scope) => (
                <button key={scope} type="button" className="mg-small-btn" onClick={() => setAll(si, (cur) => defaultRaceList(scope, cur.format, cur.ageGroup))}>
                  {SCOPE_LABEL[scope]} list for all
                </button>
              ))}
              <button type="button" className="mg-small-btn" onClick={() => setAll(si, () => null)}>Leave for later</button>
            </div>
            <ul>
              {s.sessions.map((x, ji) => {
                const name = x.name ?? newSessionName(s, ji);
                const count = raceCountFor(s, x);
                return (
                  <li key={x.existingId ?? `new-${ji}`} className={`flex min-h-[60px] items-center gap-3 px-4 py-2 ${ji ? 'border-t border-[rgb(var(--mg-rule-soft))]' : ''}`}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <strong className="truncate text-[15px] font-semibold">{name}</strong>
                      <span className="text-xs text-[rgb(var(--mg-muted))]">
                        {isLocked(x) ? 'Heats are made. Change the races on the On the day page.'
                          : x.races ? `${x.races.length} ${x.races.length === 1 ? 'race' : 'races'}: ${x.races.slice(0, 2).join(', ')}${x.races.length > 2 ? '…' : ''}`
                            : `Left for later (planning for about ${count} races)`}
                      </span>
                    </span>
                    {!isLocked(x) && (
                      <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-sm" aria-label={`Choose races for ${name}`} onClick={() => setEditing({ section: si, session: ji })}>
                        {x.races ? 'Change' : 'Choose'}<ChevronRight aria-hidden="true" className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {editing && target && targetSection && (
        <RaceListDialog title={`Races for ${target.name ?? newSessionName(targetSection, editing.session)}`}
          races={target.races ?? defaultRaceList('Zone', targetSection.format, targetSection.ageGroup)} format={targetSection.format} ageGroup={targetSection.ageGroup}
          templates={templates} onSave={(races) => { setRaces(editing.section, editing.session, races.length > 0 ? races : null); setEditing(null); }} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
