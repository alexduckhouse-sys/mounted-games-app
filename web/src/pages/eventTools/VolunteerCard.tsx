import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { SelectField } from '../../components/SelectField';
import { equipmentLines } from '../operations/equipment';
import type { PrintableDraw, PrintableSession } from './eventToolsTypes';

interface KitLine { kind: string; bucket: string; count: number }
interface KitResponse { lines?: KitLine[] }

/** The games of a session in the order they are run, each name once (heats repeat the same races). */
function gameOrder(session: PrintableSession): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const heat of session.heats) {
    for (const race of heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex)) {
      const name = race.name.trim();
      if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); names.push(name); }
    }
  }
  return names;
}

function sessionLabel(session: PrintableSession) {
  return [session.sectionName || 'Open section', session.sessionName, session.arenaName].filter(Boolean).join(' · ');
}

/** A pocket-sized card for a ring volunteer: where they are, the games in order and the kit. Plain black on white, so it prints well on any printer. */
export function VolunteerCard({ data }: { data: PrintableDraw }) {
  const competitionId = data.competition.id;
  const sessions = data.sessions;
  const [selected, setSelected] = useState<number | null>(null);
  const [kit, setKit] = useState<KitLine[] | null>(null);
  const [kitFailed, setKitFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<KitResponse>(`/competitions/${competitionId}/equipment`)
      .then((r) => { if (!cancelled) setKit(Array.isArray(r.data?.lines) ? r.data.lines : []); })
      .catch(() => { if (!cancelled) setKitFailed(true); });
    return () => { cancelled = true; };
  }, [competitionId]);

  const lines = useMemo(() => equipmentLines((kit ?? []).map((l, i) => ({
    key: `${i}:${l.kind}`, kind: l.kind, bucket: l.bucket, count: l.count, acknowledged: false, acknowledgedAt: null,
  }))), [kit]);

  if (sessions.length === 0) return <p className="event-print-empty">No sessions have been set up yet.</p>;
  const session = sessions.find((s) => s.sessionId === selected) ?? sessions.find((s) => s.heats.length > 0) ?? sessions[0];
  const games = gameOrder(session);

  return <>
    <div className="event-print-controls mb-4 flex flex-wrap items-end gap-3">
      <label className="vc-pick">Session
        <SelectField value={String(session.sessionId)} onChange={(event) => setSelected(Number(event.target.value))}
          options={sessions.map((s) => ({ value: String(s.sessionId), label: sessionLabel(s) }))} />
      </label>
    </div>
    <section className="vc-card" aria-label="Volunteer card">
      <p className="vc-kicker">{data.competition.name}</p>
      <h2 className="vc-title">{session.arenaName?.trim() || 'Arena to be confirmed'}</h2>
      <p className="vc-sub">{[session.sectionName || 'Open section', session.sessionName].join(' · ')}</p>
      <h3 className="vc-head">Games in order</h3>
      {games.length === 0 ? <p className="vc-note">No games chosen yet.</p> : <ol className="vc-list">{games.map((name) => <li key={name}>{name}</li>)}</ol>}
      <h3 className="vc-head">Kit for the whole event</h3>
      <p className="vc-note">Totals for every session, not just this one.</p>
      {kitFailed && <p className="vc-note" role="status">The kit list didn’t load. Reconnect and reload this page before printing.</p>}
      {kit && (lines.length === 0 ? <p className="vc-note">No kit listed yet.</p> : <ul className="vc-list vc-kit">{lines.map((line) => <li key={line.name}>{line.label}</li>)}</ul>)}
    </section>
  </>;
}
