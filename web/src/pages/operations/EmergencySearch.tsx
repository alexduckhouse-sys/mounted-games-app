import { useT } from '../../i18n/LanguageContext';
import { useEffect, useState } from 'react';
import { ChevronRight, Phone } from 'lucide-react';
import { Notice } from '../../components/Notice';
import { RoundSearch } from '../../components/RoundSearch';
import { Sheet } from '../../components/Sheet';
import { telHref } from '../../lib/lorryAndVolunteers';
import type { EmergencyContactEntry } from '../../types';
import { MAX_SHOWN, MIN_SEARCH_LENGTH, fetchEmergencyContacts } from './contactLookup';
import { RefineList, RefineNote, RefineSection } from '../refine/Refine';
import './operations.css';
import { clubLabel } from '../../lib/clubName';
type Entry = EmergencyContactEntry;

function CallLink({ name, phone }: { name?: string | null; phone?: string | null }) {
  const t = useT();
  const href = telHref(phone);
  if (!name && !phone) return null;
  return (
    <span className="rf-t2">
      {name || t('ops2.sos.noName')}
      {href ? <> · <a className="ops-call" href={href}><Phone className="inline h-4 w-4" aria-hidden="true" /> {phone}</a></> : ` · ${t('ops2.sos.noNumber')}`}
    </span>
  );
}

const riderLabel = (entry: EmergencyContactEntry, t: ReturnType<typeof useT>) =>
  `${entry.ponyName ? t('ops2.sos.riderOnPony', { rider: entry.riderName, pony: entry.ponyName }) : entry.riderName}${entry.isReserve ? ` (${t('ops2.sos.reserve')})` : ''}`;

/** Everything held for one rider, with the numbers as big call buttons. Opens from a result; the sheet slides up and away. */
function RiderSheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet title={riderLabel(entry, t)} description={[entry.teamName, entry.sectionName, clubLabel(entry.clubName), entry.bibColour].filter(Boolean).join(' · ')} onClose={onClose}>
      {({ close }) => (
        <>
          <div className="mg-card flex flex-col gap-1 p-3">
            <span className="rf-t2">{t('ops2.sos.emergency')}</span>
            <CallLink name={entry.emergencyContactName} phone={entry.emergencyContactPhone} />
            {(entry.trainerName || entry.trainerPhone) && <span className="rf-t2 mt-2">{t('ops2.sos.coach')}</span>}
            <CallLink name={entry.trainerName} phone={entry.trainerPhone} />
            {entry.medicalNotes && <span className="rf-t2 mt-2">{t('ops2.sos.medical', { notes: entry.medicalNotes })}</span>}
          </div>
          <div className="kit-acts"><button type="button" className="kit-pill" onClick={() => close()}>{t('common.close')}</button></div>
        </>
      )}
    </Sheet>
  );
}

/**
 * Organisers only, for when a rider is hurt and someone needs to ring their emergency contact or coach fast.
 * Results appear only after typing, and every search is recorded on the server. Nothing from here goes in an address, a toast or a log.
 */
export function EmergencySearch({ competitionId }: { competitionId: number }) {
  const t = useT();
  const [text, setText] = useState('');
  const [results, setResults] = useState<{ query: string; entries: EmergencyContactEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Entry | null>(null);
  const query = text.trim();
  const ready = query.length >= MIN_SEARCH_LENGTH;

  useEffect(() => {
    if (!ready) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      fetchEmergencyContacts(competitionId, query).then(
        (entries) => { if (!stale) { setResults({ query, entries }); setError(null); } },
        () => { if (!stale) setError(t('ops2.sos.searchError')); },
      );
    }, 350);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [competitionId, query, ready, t]);

  const shown = ready && results?.query === query ? results.entries : null;

  return (
    <div className="ops-cards">
      <Notice tone="info">{t('ops2.sos.organisersOnly')}</Notice>
      <div className="mg-card p-3">
        <RoundSearch label={t('ops2.sos.findRider')} placeholder={t('ops2.sos.placeholder')} value={text} onChange={setText} />
      </div>
      {error && ready && <Notice>{error}</Notice>}
      {!ready && <RefineNote>{t('ops2.sos.typeMore', { min: MIN_SEARCH_LENGTH })}</RefineNote>}
      {ready && !error && shown === null && <p role="status" className="rf-note">{t('ops2.sos.searching')}</p>}
      {shown !== null && shown.length === 0 && <p role="status" className="rf-note">{t('ops2.sos.nobody')}</p>}
      {shown !== null && shown.length > 0 && (
        <section aria-label={t('ops2.sos.searchResults')}>
          <RefineSection title={t('ops2.sos.results')} meta={shown.length} />
          <RefineList as="div">
            {shown.slice(0, MAX_SHOWN).map((entry) => (
              <div key={entry.riderEntryId} className="rf-row ops-wrap">
                <button type="button" className="rf-grow ops-who" aria-haspopup="dialog" onClick={() => setOpen(entry)}>
                  <span className="rf-t1">{riderLabel(entry, t)}</span>
                  <span className="rf-t2">{[entry.teamName, entry.sectionName, clubLabel(entry.clubName), entry.bibColour].filter(Boolean).join(' · ')}</span>
                </button>
                <span className="ops-who-call">
                  <span className="rf-t2">{t('ops2.sos.emergency')}</span>
                  <CallLink name={entry.emergencyContactName} phone={entry.emergencyContactPhone} />
                </span>
                <ChevronRight className="rf-chev h-4 w-4" aria-hidden="true" />
              </div>
            ))}
          </RefineList>
          {shown.length > MAX_SHOWN && <RefineNote>{t('ops2.sos.firstOf', { shown: MAX_SHOWN, total: shown.length })}</RefineNote>}
        </section>
      )}
      {open && <RiderSheet entry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
