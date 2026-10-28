import { useT } from '../../i18n/LanguageContext';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { tr } from '../../i18n/translate';
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
  return [session.sectionName || tr('ops2.print.openSection'), session.sessionName, session.arenaName].filter(Boolean).join(' · ');
}

/** A pocket-sized card for a ring volunteer: where they are, the games in order and the kit. Plain black on white, so it prints well on any printer. */
export function VolunteerCard({ data }: { data: PrintableDraw }) {
  const t = useT();
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

  if (sessions.length === 0) return <p className="event-print-empty">{t('ops3.vc.noSessions')}</p>;
  const session = sessions.find((s) => s.sessionId === selected) ?? sessions.find((s) => s.heats.length > 0) ?? sessions[0];
  const games = gameOrder(session);

  return <>
    <div className="event-print-controls mb-4 flex flex-wrap items-end gap-3">
      <label className="vc-pick">{t('ops3.vc.session')}
        <SelectField value={String(session.sessionId)} onChange={(event) => setSelected(Number(event.target.value))}
          options={sessions.map((s) => ({ value: String(s.sessionId), label: sessionLabel(s) }))} />
      </label>
    </div>
    <section className="vc-card" aria-label={t('ops3.vc.card')}>
      <p className="vc-kicker">{data.competition.name}</p>
      <h2 className="vc-title">{session.arenaName?.trim() || t('ops3.vc.arenaTbc')}</h2>
      <p className="vc-sub">{[session.sectionName || t('ops2.print.openSection'), session.sessionName].join(' · ')}</p>
      <h3 className="vc-head">{t('ops3.vc.games')}</h3>
      {games.length === 0 ? <p className="vc-note">{t('ops3.vc.noGames')}</p> : <ol className="vc-list">{games.map((name) => <li key={name}>{name}</li>)}</ol>}
      <h3 className="vc-head">{t('ops3.vc.kit')}</h3>
      <p className="vc-note">{t('ops3.vc.totals')}</p>
      {kitFailed && <p className="vc-note" role="status">{t('ops3.vc.kitFailed')}</p>}
      {kit && (lines.length === 0 ? <p className="vc-note">{t('ops3.vc.noKit')}</p> : <ul className="vc-list vc-kit">{lines.map((line) => <li key={line.name}>{line.label}</li>)}</ul>)}
    </section>
  </>;
}
