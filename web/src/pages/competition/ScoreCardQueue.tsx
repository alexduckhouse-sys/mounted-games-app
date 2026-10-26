import { useState } from 'react';
import { Eye, Pencil, SkipForward } from 'lucide-react';
import { api } from '../../api';
import type { QueuedScoreCard } from '../../lib/scoreCard';
import { NumberField } from '../../components/NumberField';
import { formatPoints } from '../../lib/formatPoints';

type Action = 'show' | 'skip' | 'edit';

/** The latest score cards, newest first, with show now, skip and a display editor for each. */
export function ScoreCardQueue({ competitionId, cards, onError }: { competitionId: number; cards: QueuedScoreCard[]; onError: (message: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recent = [...cards].reverse().slice(0, 5);

  async function send(queued: QueuedScoreCard, action: Action, edit?: { hiddenTeamIds: number[]; names: Record<number, string>; seconds: number | null }) {
    setBusy(true);
    try {
      await api.post(`/competitions/${competitionId}/overlays/score-card`, { heatId: queued.card.heatId, raceId: queued.card.raceId, action, ...edit });
      if (action === 'edit') setEditing(null);
    } catch {
      onError('Couldn’t reach the score card. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mg-card flex flex-col gap-3 p-4" aria-labelledby="cards-title">
      <h2 id="cards-title" className="font-bold">Score cards</h2>
      {recent.length === 0 ? <p className="text-sm">Cards appear here as results come in.</p> : (
        <ul className="flex flex-col gap-2">
          {recent.map((queued) => (
            <li key={queued.key} className="flex flex-col gap-2 border-t pt-2 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 text-sm"><strong>{queued.heading}</strong> · after {queued.card.raceName}{queued.arenaName && ` · ${queued.arenaName}`}</span>
                <button type="button" className="mg-btn mg-btn-secondary !min-h-9" disabled={busy} onClick={() => void send(queued, 'show')}><Eye className="h-4 w-4" aria-hidden="true" />Show now</button>
                <button type="button" className="mg-btn mg-btn-secondary !min-h-9" disabled={busy} onClick={() => void send(queued, 'skip')}><SkipForward className="h-4 w-4" aria-hidden="true" />Skip</button>
                <button type="button" className="mg-btn mg-btn-secondary !min-h-9" aria-expanded={editing === queued.key} onClick={() => setEditing(editing === queued.key ? null : queued.key)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</button>
              </div>
              {editing === queued.key && <CardEditor queued={queued} busy={busy} onApply={(edit) => void send(queued, 'edit', edit)} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Hide rows, fix how a name shows and set the time on screen. Points can't be changed here. */
function CardEditor({ queued, busy, onApply }: {
  queued: QueuedScoreCard; busy: boolean;
  onApply: (edit: { hiddenTeamIds: number[]; names: Record<number, string>; seconds: number | null }) => void;
}) {
  const [hidden, setHidden] = useState<number[]>(queued.hiddenTeamIds ?? []);
  const [names, setNames] = useState<Record<number, string>>(queued.names ?? {});
  const [seconds, setSeconds] = useState<number | null>(queued.seconds ?? null);
  return (
    <form className="flex flex-col gap-2 text-sm" onSubmit={(event) => { event.preventDefault(); onApply({ hiddenTeamIds: hidden, names, seconds }); }}>
      <table>
        <caption className="sr-only">Rows on this card</caption>
        <tbody>
          {queued.card.rows.map((row) => (
            <tr key={row.teamId}>
              <td><input type="checkbox" aria-label={`Show ${row.teamName}`} checked={!hidden.includes(row.teamId)}
                onChange={(event) => setHidden(event.target.checked ? hidden.filter((id) => id !== row.teamId) : [...hidden, row.teamId])} /></td>
              <td><input className="w-full rounded border px-1" aria-label={`Name shown for ${row.teamName}`} maxLength={60} value={names[row.teamId] ?? row.teamName}
                onChange={(event) => setNames({ ...names, [row.teamId]: event.target.value })} /></td>
              <td className="text-right font-bold">{formatPoints(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="flex items-center gap-2">On screen for
        <NumberField className="w-14 rounded border px-1"  min={3} max={60} value={seconds ?? ''} placeholder="10"
          onChange={(event) => setSeconds(event.target.value === '' ? null : Math.min(60, Math.max(3, Number(event.target.value) || 3)))} /> s</label>
      <button type="submit" className="mg-btn mg-btn-primary self-start" disabled={busy}>Apply to this card</button>
    </form>
  );
}
