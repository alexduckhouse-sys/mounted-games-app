import { useId, useMemo, useState } from 'react';
import { ChevronDown, Flag, Shield } from 'lucide-react';
import { RoundSearch } from '../../components/RoundSearch';
import type { CompetitionSection, DeclarationForm, RiderEntry, Team } from '../../types';
import { parseBibAndFlag } from '../../lib/bib';
import { heightText } from '../../lib/decForm';
import type { DecFormConfig } from '../../lib/decFormConfig';
import { displaySectionName } from '../../lib/section';
import '../../components/sitePages.css';
import '../../components/eventPages.css';

/** The extra answers a rider gave, as one quiet line. Only staff and the submitter are ever sent them. */
function detailLine(r: RiderEntry, config: DecFormConfig): string {
  const parts = [
    r.birthYear != null ? `born ${r.birthYear}` : null,
    r.ageGroup,
    r.weightKg != null ? `${r.weightKg} kg` : null,
    r.ponyAge != null ? `pony ${r.ponyAge} yrs` : null,
    r.ponyPassportNumber ? `passport ${r.ponyPassportNumber}` : null,
    r.ponyOwnerFullName ? `owner ${r.ponyOwnerFullName}` : null,
    r.membershipNumber ? `member ${r.membershipNumber}` : null,
    r.emergencyContactName ? `emergency: ${r.emergencyContactName}${r.emergencyContactPhone ? ` ${r.emergencyContactPhone}` : ''}` : null,
    r.medicalNotes ? `medical: ${r.medicalNotes}` : null,
    ...config.customFields.map((c) => (r.customValues?.[c.id] ? `${c.label}: ${r.customValues[c.id]}${c.unit ? ` ${c.unit}` : ''}` : null)),
  ];
  return parts.filter(Boolean).join(' · ');
}

const sentOn = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/**
 * The dec forms already sent, grouped by age group. Search by team, rider or pony; tap a form to open it in place and
 * see its riders and ponies.
 */
export function DecFormList({ forms, teams, sections, config, canDelete, onDelete }: {
  forms: DeclarationForm[];
  teams: Team[];
  sections: CompetitionSection[];
  config: DecFormConfig;
  canDelete: (form: DeclarationForm) => boolean;
  onDelete: (form: DeclarationForm) => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const baseId = useId();
  const q = search.trim().toLowerCase();

  const groups = useMemo(() => {
    const sectionOf = (form: DeclarationForm) => teams.find((t) => t.id === form.teamId)?.competitionSectionId ?? null;
    const matches = (form: DeclarationForm) => !q || [form.teamName, form.entryTeamName ?? '', ...form.riders.flatMap((r) => [r.fullName, r.horseName ?? ''])].some((text) => text.toLowerCase().includes(q));
    const shown = forms.filter(matches);
    const known = sections.map((section) => ({
      key: String(section.id),
      name: displaySectionName(section.displayName),
      forms: shown.filter((form) => sectionOf(form) === section.id),
    }));
    const other = shown.filter((form) => !sections.some((section) => section.id === sectionOf(form)));
    return [...known, { key: 'other', name: 'Other', forms: other }]
      .filter((group) => group.forms.length > 0)
      .map((group) => ({ ...group, forms: group.forms.slice().sort((a, b) => a.teamName.localeCompare(b.teamName)) }));
  }, [forms, teams, sections, q]);

  function toggle(id: number) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <section aria-label="Dec forms sent" className="flex flex-col">
      {forms.length > 0 && <RoundSearch label="Find a team, rider or pony" placeholder="Team, rider or pony" value={search} onChange={setSearch} />}
      {forms.length === 0 && <p className="sp-note">No declaration forms submitted yet.</p>}
      {forms.length > 0 && groups.length === 0 && <p className="sp-note">No dec form matches “{search.trim()}”.</p>}
      {groups.map((group) => (
        <section key={group.key} aria-label={group.name}>
          <h2 className="sp-sec">{group.name}</h2>
          <div className="sp-card">
            {group.forms.map((form) => {
              const isOpen = open.has(form.id);
              const panelId = `${baseId}-${form.id}`;
              const parsedBib = parseBibAndFlag(form.bibDescription);
              const trainer = form.trainerName ?? form.submittedByName;
              const phone = form.trainerPhone ?? form.submittedByPhone;
              return (
                <div key={form.id}>
                  <button type="button" className="sp-row" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(form.id)}>
                    <span className="sp-grow">
                      <span className="sp-t1 flex items-center gap-1.5">
                        {parsedBib.flag && <img src={`/flags/${parsedBib.flag}.png`} alt="" className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover" />}
                        <span className="min-w-0 truncate">{form.teamName}</span>
                        {(form.flagCount ?? 0) > 0 && (
                          <span className="mg-flag inline-flex shrink-0 items-center gap-1 !px-1.5 !py-0.5 !text-[11px]" title="Someone's answer is outside the limits set for this event">
                            <Flag aria-hidden="true" className="h-3 w-3" />{form.flagCount} flagged
                          </span>
                        )}
                      </span>
                      <span className="sp-t2">Sent {sentOn(form.submittedAt)}</span>
                    </span>
                    <ChevronDown aria-hidden="true" className={`sp-chev h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} strokeWidth={2.5} />
                  </button>
                  {isOpen && (
                    <div id={panelId} className="mg-reveal px-4 pb-3.5">
                      {form.entryTeamName && form.entryTeamName.trim().toLowerCase() !== form.teamName.trim().toLowerCase() && (
                        <p className="sp-t2 m-0 pb-1">Entered as {form.entryTeamName}</p>
                      )}
                      <ol className="m-0 list-none p-0">
                        {form.riders.map((r) => (
                          <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-[rgb(var(--mg-rule-soft))] py-2 text-[15px] first:border-t-0">
                            <span className="min-w-0 font-medium">
                              {r.fullName}
                              {r.isReserve && <Shield aria-label="Reserve" className="ml-1 inline h-3 w-3 text-[rgb(var(--mg-heading))]" />}
                              {r.isGuestRider && <span className="mg-tag mg-tag-ok ml-1.5 !px-1 !py-0.5 !text-[9px] font-bold uppercase">Guest</span>}
                            </span>
                            <span className="text-[rgb(var(--mg-muted))]">{r.horseName ?? '—'}{r.ponyHeightHands != null ? ` · ${heightText(r.ponyHeightHands)} hh` : ''}</span>
                            {detailLine(r, config) && <span className="basis-full text-xs text-[rgb(var(--mg-muted))]">{detailLine(r, config)}</span>}
                            {r.flags?.map((flag) => <span key={flag} className="mg-flag basis-full">{flag}</span>)}
                          </li>
                        ))}
                      </ol>
                      <div className="flex flex-col gap-0.5 border-t border-[rgb(var(--mg-rule-soft))] pt-2 text-[13px] text-[rgb(var(--mg-muted))]">
                        {parsedBib.bib && <span>Bibs: {parsedBib.bib}</span>}
                        {trainer && <span>Trainer: <span className="font-medium text-[rgb(var(--mg-ink))]">{trainer}</span>{phone ? ` · ${phone}` : ''}</span>}
                        {form.notes && <span className="italic">“{form.notes}”</span>}
                      </div>
                      {canDelete(form) && (
                        <div className="pt-1">
                          <button type="button" className="ev-danger !px-0" aria-label={`Delete the dec form for ${form.teamName}`} onClick={() => onDelete(form)}>Delete this form</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </section>
  );
}
