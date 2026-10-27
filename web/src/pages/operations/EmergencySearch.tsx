import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import { Notice } from '../../components/Notice';
import { telHref } from '../../lib/lorryAndVolunteers';
import type { EmergencyContactEntry } from '../../types';
import { MAX_SHOWN, MIN_SEARCH_LENGTH, fetchEmergencyContacts } from './contactLookup';
import { RefineList, RefineNote, RefineSection } from '../refine/Refine';
import './operations.css';

function CallLink({ name, phone }: { name?: string | null; phone?: string | null }) {
  const href = telHref(phone);
  if (!name && !phone) return null;
  return (
    <span className="rf-t2">
      {name || 'No name given'}
      {href ? <> · <a className="ops-call" href={href}><Phone className="inline h-4 w-4" aria-hidden="true" /> {phone}</a></> : ' · no number'}
    </span>
  );
}

/**
 * Organisers only, for when a rider is hurt and someone needs to ring their emergency contact or coach fast.
 * Results appear only after typing, and every search is recorded on the server. Nothing from here goes in an address, a toast or a log.
 */
export function EmergencySearch({ competitionId }: { competitionId: number }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<{ query: string; entries: EmergencyContactEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = text.trim();
  const ready = query.length >= MIN_SEARCH_LENGTH;

  useEffect(() => {
    if (!ready) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      fetchEmergencyContacts(competitionId, query).then(
        (entries) => { if (!stale) { setResults({ query, entries }); setError(null); } },
        () => { if (!stale) setError('Couldn’t search. Check your signal and try again.'); },
      );
    }, 350);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [competitionId, query, ready]);

  const shown = ready && results?.query === query ? results.entries : null;

  return (
    <div className="ops-cards">
      <Notice tone="info">Only organisers can see this. Every search is recorded with your name.</Notice>
      <label className="rf-fld">
        Find a rider
        <input type="search" value={text} autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="Rider, pony, team, club or bib colour" onChange={(event) => setText(event.target.value)} />
      </label>
      {error && ready && <Notice>{error}</Notice>}
      {!ready && <RefineNote>Type at least {MIN_SEARCH_LENGTH} letters to search. Nothing is listed until you do.</RefineNote>}
      {ready && !error && shown === null && <p role="status" className="rf-note">Searching…</p>}
      {shown !== null && shown.length === 0 && <p role="status" className="rf-note">Nobody matches that. Check the spelling or try the team name.</p>}
      {shown !== null && shown.length > 0 && (
        <section aria-label="Search results">
          <RefineSection title="Results" meta={shown.length} />
          <RefineList as="div">
            {shown.slice(0, MAX_SHOWN).map((entry) => (
              <div key={entry.riderEntryId} className="rf-row ops-wrap">
                <span className="rf-grow">
                  <span className="rf-t1">{entry.riderName}{entry.ponyName ? ` on ${entry.ponyName}` : ''}{entry.isReserve ? ' (reserve)' : ''}</span>
                  <span className="rf-t2">{[entry.teamName, entry.sectionName, entry.clubName, entry.bibColour].filter(Boolean).join(' · ')}</span>
                  <span className="rf-t2">Emergency contact</span>
                  <CallLink name={entry.emergencyContactName} phone={entry.emergencyContactPhone} />
                  {(entry.trainerName || entry.trainerPhone) && <span className="rf-t2">Coach</span>}
                  <CallLink name={entry.trainerName} phone={entry.trainerPhone} />
                  {entry.medicalNotes && <span className="rf-t2">Medical notes: {entry.medicalNotes}</span>}
                </span>
              </div>
            ))}
          </RefineList>
          {shown.length > MAX_SHOWN && <RefineNote>Showing the first {MAX_SHOWN} of {shown.length}. Add more of the name to narrow it down.</RefineNote>}
        </section>
      )}
    </div>
  );
}
