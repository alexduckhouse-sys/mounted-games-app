import { useState } from 'react';
import { api } from '../../../api';
import { Notice } from '../../../components/Notice';
import { isBoard, message, type Board } from './types';
import { VaccinationRecord } from './VaccinationRecord';
import { useVaccinationT } from './useVaccinationT';

/** Fetch only when requested, and only through the declaration-owner endpoint. Never cache private evidence. */
export function EntrantVaccinationCheck({ competitionId, riderId }: { competitionId: number; riderId: number }) {
  const t = useVaccinationT();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const base = `/event-tools/competitions/${competitionId}/passport-check/vaccinations`;
  async function load() {
    setBusy(true); setError(null);
    try {
      const { data } = await api.get<Board>(`${base}/riders/${riderId}/mine`);
      if (!isBoard(data) || !data.enabled || data.ponies.length !== 1) throw new Error('Unavailable');
      setBoard(data); setAttempt(n => n + 1);
    } catch (caught) { setError(message(caught, t('vaccinations.unavailable'))); }
    finally { setBusy(false); }
  }
  return <div className="basis-full">
    {!board && <button type="button" className="rf-btn rf-btn-text" disabled={busy} onClick={load}>{t('vaccinations.open')}</button>}
    {error && <Notice>{error}</Notice>}
    {board && <VaccinationRecord key={attempt} pony={board.ponies[0]} settings={board.settings} base={base} staff={false}
      onChange={pony => setBoard({ ...board, ponies: [pony] })} onReload={load} />}
  </div>;
}
