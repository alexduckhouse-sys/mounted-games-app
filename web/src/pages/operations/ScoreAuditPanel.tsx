import { useT } from '../../i18n/LanguageContext';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { api } from '../../api';
import { activeLocale, tr } from '../../i18n/translate';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { RefineDisclosure, RefineList, RefineNote, RefineSection } from '../refine/Refine';
import type { RaceScore, RaceScoreEventKind, RaceScoreHistory, ScorePlace } from './types';
import { apiMessage } from './types';
import { STATUS_CHOICES, effectiveStatus, statusLetter } from '../../lib/resultStatus';
import './operations.css';
import { SelectField } from '../../components/SelectField';
import { NumberField } from '../../components/NumberField';
import { formatPoints } from '../../lib/formatPoints';
import { manualPoints } from '../../lib/raceScoring';
import type { MessageKey } from '../../i18n/en/index';
import type { Heat, Race } from '../../types';
import { ProtestsPanel } from './ProtestsPanel';

type DraftScorePlace = ScorePlace & { pointsEdited?: boolean; pointsText?: string };

interface ScoreAuditProps {
  raceId: number;
  onChanged?: () => void;
  /** With the heat (staff only), the panel lists this race's protests and can log one. */
  heat?: Heat;
  race?: Race | null;
  /** Team names, so rows read "Belvoir A" and not "Team 42". Without them every team shows as unnamed. */
  teams?: Array<{ teamId: number; teamName: string }>;
}

export function ScoreAuditPanel(props: ScoreAuditProps) {
  const { user } = useAuth();
  return <ScoreAuditRecord key={`${props.raceId}:${props.race?.programmeRevision ?? 0}:${user?.id ?? ''}`} {...props} />;
}

function ScoreAuditRecord({ raceId, onChanged, heat, race = null, teams }: ScoreAuditProps) {
  const { canManage } = useAuth();
  const t = useT();
  const { competition } = useCompetition();
  const [score, setScore] = useState<RaceScore | null>(null);
  const [history, setHistory] = useState<RaceScoreHistory[]>([]);
  const [draft, setDraft] = useState<DraftScorePlace[]>([]);
  const [correctionReason, setCorrectionReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const teamName = (id: number) => teams?.find((team) => team.teamId === id)?.teamName?.trim() || t('ops2.audit.unnamedTeam');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [scoreResponse, historyResponse] = await Promise.all([
        api.get<RaceScore>(`/races/${raceId}/score`),
        api.get<RaceScoreHistory[]>(`/races/${raceId}/score/history`),
      ]);
      setScore(scoreResponse.data);
      setDraft(scoreResponse.data.results.filter((result) => !result.isSitOut).map((result) => ({ ...result })));
      setHistory(historyResponse.data);
    } catch (loadError) {
      setError(apiMessage(loadError, t('ops2.audit.loadError')));
    } finally {
      setLoading(false);
    }
  }, [raceId, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function updateScore(event: FormEvent) {
    event.preventDefault();
    if (!score || busy || loading) return;
    if (!correctionReason.trim()) {
      setError(t('ops2.audit.needReason'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put(`/races/${raceId}/score`, {
        places: draft.map((result) => {
          const explicitPoints = !result.eliminated && (
            result.pointsEdited
            || !Number.isInteger(result.points)
            || manualPoints(result.refereeNote ?? undefined) !== undefined
          )
            ? result.points
            : undefined;
          return {
            teamId: result.teamId, place: result.place, eliminated: result.eliminated,
            ...(result.eliminated ? { status: effectiveStatus(true, result.status) } : {}),
            ...(explicitPoints !== undefined ? { points: explicitPoints } : {}),
            ...(result.refereeNote != null ? { refereeNote: result.refereeNote } : {}),
          };
        }),
        expectedRevision: score.revision,
        expectedProgrammeRevision: race?.programmeRevision ?? 0,
        requestId: requestId('correction'),
        reason: correctionReason.trim(),
      });
      setCorrectionReason('');
      toast.show(t('ops2.audit.saved'));
      await load();
      onChanged?.();
    } catch (saveError) {
      setError(apiMessage(saveError, t('ops2.audit.saveError')));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div>{toast.node}<p role="status" className="rf-note">{t('ops2.audit.loading')}</p></div>;

  const heading = `score-audit-${raceId}`;
  return (
    <section aria-labelledby={heading}>
      <RefineSection title={t('ops2.audit.record')} />
      <h2 id={heading} className="sr-only">{t('ops2.audit.record')}</h2>
      {error && <Notice actionLabel={score ? undefined : t('common.tryAgain')} onAction={() => void load()}>{error}</Notice>}
      {toast.node}

      {score && <>
        <RefineList as="div">
          <div className="rf-row">
            <span className="rf-grow">
              <span className="rf-t1">{t('ops2.audit.refreshAria')}</span>
            </span>
            <button type="button" className="rf-btn rf-btn-text" aria-label={t('ops2.audit.refreshAria')} onClick={() => void load()} disabled={loading || busy}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />{t('common.refresh')}</button>
          </div>
        </RefineList>

        {canManage(competition) && draft.length > 0 && <>
          <RefineSection title={t('ops2.audit.corrections')} />
          <RefineList as="div">
            <RefineDisclosure title={t('ops2.audit.correctPlacings')} sub={t('ops2.audit.everyReason')}>
              <form className="ops-form ops-panel" onSubmit={updateScore}>
                <ul className="ops-places">{draft.map((result, index) => (
                  <li key={result.teamId} className="ops-place">
                    <span className="rf-grow"><span className="rf-t1">{teamName(result.teamId)}</span><span className="rf-t2">{t('ops2.audit.pointsNow', { points: formatPoints(result.points) })}</span></span>
                    <label className="rf-fld ops-place-field">{t('ops2.audit.place')}<NumberField aria-label={t('ops2.audit.placeFor', { name: teamName(result.teamId) })}  min="1" disabled={result.eliminated} value={result.place || 1} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, place: Number(event.target.value) } : item))} /></label>
                    <label className="rf-fld ops-place-field">{t('ops2.audit.points')}<NumberField decimal aria-label={t('ops2.audit.pointsFor', { name: teamName(result.teamId) })} min="0" step="0.5" disabled={result.eliminated} value={result.eliminated ? 0 : (result.pointsText ?? String(result.points))} onChange={(event) => {
                      const raw = event.target.value;
                      const parsed = Number(raw);
                      setDraft((current) => current.map((item, itemIndex) => itemIndex === index
                        ? { ...item, pointsText: raw, points: raw.trim() === '' || Number.isNaN(parsed) ? item.points : parsed, pointsEdited: true }
                        : item));
                    }} /></label>
                    <label className="ops-elim"><input aria-label={t('ops2.audit.eliminatedFor', { name: teamName(result.teamId) })} type="checkbox" checked={result.eliminated} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, eliminated: event.target.checked, status: event.target.checked ? effectiveStatus(true, item.status) : 0 } : item))} />{t('competition.status.dnf')}</label>
                    {result.eliminated && <label className="rf-fld ops-place-field">{t('ops2.audit.why')}<SelectField aria-label={t('ops2.audit.reasonFor', { name: teamName(result.teamId) })} value={effectiveStatus(true, result.status)} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status: Number(event.target.value) } : item))}>{STATUS_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{statusChoiceLabel(choice)}</option>)}</SelectField></label>}
                    <label className="rf-fld ops-place-field">{t('ops2.audit.refNote')}<input aria-label={t('ops2.audit.refNoteFor', { name: teamName(result.teamId) })} type="text" maxLength={500} value={result.refereeNote ?? ''} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, refereeNote: event.target.value } : item))} /></label>
                  </li>
                ))}</ul>
                <label className="rf-fld">{t('ops2.audit.reason')}<textarea className="ops-note-input" required maxLength={1000} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
                <button type="submit" className="rf-btn rf-btn-primary" disabled={busy || loading}><Save aria-hidden="true" className="h-4 w-4" />{busy ? t('common.saving') : t('ops2.audit.saveCorrection')}</button>
              </form>
            </RefineDisclosure>
          </RefineList>
        </>}

        {heat && canManage(competition) && (
          <ProtestsPanel competitionId={competition.id} raceId={raceId} heat={heat} race={race} empty={t('ops2.audit.noProtests')} />
        )}

        <RefineSection title={t('ops2.audit.history')} />
        {history.length === 0
          ? <RefineNote>{t('ops2.audit.noChanges')}</RefineNote>
          : <RefineList as="ol" label={t('ops2.audit.historyLabel')}>{history.map((entry) => (
            <li key={entry.revision} className="rf-row ops-history">
              <span className="rf-grow">
                <span className="rf-t1">{eventLabel(entry.kind)}</span>
                <span className="rf-t2">{t('ops2.audit.revisionAt', { when: new Date(entry.createdAt).toLocaleString(activeLocale()) })}</span>
                <span className="ops-reason">{entry.reason}</span>
                {(entry.actorLabel || entry.actorUserId) && <span className="rf-t2">{t('ops2.audit.by', { who: entry.actorLabel || t('ops2.audit.organiser') })}</span>}
                <span className="rf-t2">{scoreSummary(entry.before, teamName)} → {scoreSummary(entry.after, teamName)}</span>
              </span>
            </li>
          ))}</RefineList>}
      </>}
    </section>
  );
}

const STATUS_KEYS: Record<string, MessageKey> = {
  E: 'competition.status.eliminated', DNS: 'competition.status.dns', DNF: 'competition.status.dnf', R: 'competition.status.retired',
};
const statusChoiceLabel = (choice: { letter: string; label: string }): string => (STATUS_KEYS[choice.letter] ? tr(STATUS_KEYS[choice.letter]) : choice.label);

function requestId(action: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${action}-${id}`;
}

function eventLabel(kind: RaceScoreEventKind): string {
  return tr(({ 1: 'ops2.audit.ev.recorded', 2: 'ops2.audit.ev.corrected', 3: 'ops2.audit.ev.signedOff', 4: 'ops2.audit.ev.reopened' } as const)[kind]);
}

function scoreSummary(results: ScorePlace[], teamName: (id: number) => string): string {
  if (results.length === 0) return tr('ops2.audit.noResults');
  return results.map((result) => tr('ops2.audit.teamResult', { name: teamName(result.teamId), result: result.isSitOut ? 'S' : result.eliminated ? String(statusLetter(true, result.status)) : result.place })).join(', ');
}
