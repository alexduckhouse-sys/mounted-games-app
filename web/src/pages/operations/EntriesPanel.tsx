import { useT } from '../../i18n/LanguageContext';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { activeLocale, tr } from '../../i18n/translate';
import { Notice } from '../../components/Notice';
import { useCompetition } from '../competition/context';
import { Chevron, RefineList, RefineNote, RefineSection, RefineSheet, RefineStatus } from '../refine/Refine';
import { RedrawPreviewView } from './RedrawPreviewView';
import { RiderSwapSheet } from './RiderSwapSheet';
import type { SetTeamEntryStatusResult, TeamEntry, TeamEntryStatus } from './types';
import { apiMessage, isOffline, statusOf } from './types';
import './operations.css';

interface StatusSheet { team: TeamEntry; next: TeamEntryStatus }

const STATUS_LABEL: Record<TeamEntryStatus, string> = {
  get 0() { return tr('ops2.panel.inDraw'); }, get 1() { return tr('ops2.protest.withdrawn'); }, get 2() { return tr('ops2.redraw.noShow'); },
};

function whenText(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(activeLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Organiser's list of every team's entry status: withdraw a team or mark a no-show, reinstate it, swap a rider
 * for a reserve, and open the re-draw preview for the unscored heats. Reasons are shown here only.
 */
export function EntriesPanel({ canWrite, onTimetableChanged }: { canWrite: boolean; onTimetableChanged: () => void }) {
  const { competition } = useCompetition();
  const t = useT();
  const [entries, setEntries] = useState<TeamEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<StatusSheet | null>(null);
  const [swapTeam, setSwapTeam] = useState<TeamEntry | null>(null);
  const [redrawSection, setRedrawSection] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<TeamEntry[]>(`/competitions/${competition.id}/entries`);
      setEntries(Array.isArray(data) ? data : []);
    } catch (error) {
      setLoadError(isOffline(error)
        ? t('ops2.offline')
        : apiMessage(error, t('ops2.panel.loadError')));
    } finally {
      setLoading(false);
    }
  }, [competition.id, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const bySection = useMemo(() => {
    const groups = new Map<number, { name: string; teams: TeamEntry[] }>();
    for (const entry of entries ?? []) {
      const group = groups.get(entry.sectionId) ?? { name: entry.sectionName, teams: [] };
      group.teams.push(entry);
      groups.set(entry.sectionId, group);
    }
    return [...groups.entries()];
  }, [entries]);
  const redrawSections = bySection.filter(([, group]) => group.teams.some((team) => team.redrawAvailable));

  if (redrawSection != null) {
    const name = bySection.find(([id]) => id === redrawSection)?.[1].name ?? t('ops2.panel.section');
    return (
      <RedrawPreviewView
        competitionId={competition.id}
        sectionId={redrawSection}
        sectionName={name}
        canWrite={canWrite}
        onClose={() => { setRedrawSection(null); void load(); }}
        onApplied={() => { setMessage(t('ops2.redraw.applied')); onTimetableChanged(); }}
      />
    );
  }

  return (
    <section aria-label={t('ops2.panel.entries')}>
      {message && <Notice tone="info" onDismiss={() => setMessage(null)}>{message}</Notice>}
      {loading && !entries && <p role="status" className="rf-note">{t('ops2.panel.loadingTeams')}</p>}
      {loadError && <Notice actionLabel={t('common.tryAgain')} onAction={() => void load()}>{loadError}</Notice>}
      {entries && entries.length === 0 && <RefineNote>{t('ops2.panel.noTeams')}</RefineNote>}

      {redrawSections.length > 0 && (
        <>
          <RefineSection title={t('ops2.panel.redraw')} />
          <RefineList as="div" label={t('ops2.panel.redrawPreviews')}>
            {redrawSections.map(([id, group]) => {
              const out = group.teams.filter((team) => team.status !== 0).length;
              return (
                <button key={id} type="button" className="rf-row" onClick={() => setRedrawSection(id)}>
                  <span className="rf-grow"><span className="rf-t1">{group.name}</span><span className="rf-t2">{t(out === 1 ? 'ops2.panel.outOne' : 'ops2.panel.outMany', { count: out })}</span></span>
                  <Chevron />
                </button>
              );
            })}
          </RefineList>
        </>
      )}

      {bySection.map(([id, group]) => (
        <div key={id}>
          <RefineSection title={group.name} />
          <RefineList as="ul" label={t('ops2.panel.teamsLabel', { name: group.name })}>
            {group.teams.map((team) => (
              <li key={team.teamId} className="ops-entry">
                <div className="rf-row ops-entry-head">
                  <span className="rf-grow">
                    <span className="rf-t1">{team.teamName}</span>
                    {team.status !== 0 && (
                      <span className="rf-t2">
                        {team.reason ? `${team.reason} · ` : ''}{whenText(team.changedAt)}
                      </span>
                    )}
                  </span>
                  {team.status === 0 ? <RefineStatus tone="mut">{STATUS_LABEL[0]}</RefineStatus> : <RefineStatus tone="warn">{STATUS_LABEL[team.status]}</RefineStatus>}
                </div>
                <div className="ops-entry-actions">
                  {team.status === 0 ? (
                    <>
                      <button type="button" className="rf-btn" disabled={!canWrite} onClick={() => setSheet({ team, next: 1 })} aria-label={t('ops2.panel.withdrawAria', { name: team.teamName })}>{t('ops2.panel.withdraw')}</button>
                      <button type="button" className="rf-btn" disabled={!canWrite} onClick={() => setSheet({ team, next: 2 })} aria-label={t('ops2.panel.noShowAria', { name: team.teamName })}>{t('ops2.redraw.noShow')}</button>
                      <button type="button" className="rf-btn" disabled={!canWrite} onClick={() => setSwapTeam(team)} aria-label={t('ops2.panel.swapAria', { name: team.teamName })}>{t('ops2.panel.swap')}</button>
                    </>
                  ) : team.canReinstate ? (
                    <button type="button" className="rf-btn" disabled={!canWrite} onClick={() => setSheet({ team, next: 0 })} aria-label={t('ops2.panel.reinstateAria', { name: team.teamName })}>{t('ops2.panel.reinstate')}</button>
                  ) : (
                    <span className="rf-t2">{t('ops2.panel.noUndo')}</span>
                  )}
                </div>
              </li>
            ))}
          </RefineList>
        </div>
      ))}

      {sheet && (
        <StatusSheetView
          key={`${sheet.team.teamId}:${sheet.next}`}
          competitionId={competition.id}
          sheet={sheet}
          onClose={() => setSheet(null)}
          onDone={(result) => {
            setSheet(null);
            const places = result.heatPlacesChanged;
            setMessage(sheet.next === 0
              ? (places > 0 ? t('ops2.panel.backIn', { name: sheet.team.teamName, places: t('ops2.panel.heats', { count: places }) }) : t('ops2.panel.backInDraw', { name: sheet.team.teamName }))
              : (places > 0 ? t('ops2.panel.outOf', { name: sheet.team.teamName, places: t('ops2.panel.unscoredHeats', { count: places }) }) : t('ops2.panel.isOut', { name: sheet.team.teamName })));
            onTimetableChanged();
            void load();
          }}
        />
      )}
      {swapTeam && (
        <RiderSwapSheet
          competitionId={competition.id}
          team={swapTeam}
          canWrite={canWrite}
          onClose={() => setSwapTeam(null)}
          onSwapped={(text) => { setMessage(text); }}
        />
      )}
    </section>
  );
}

function StatusSheetView({ competitionId, sheet, onClose, onDone }: {
  competitionId: number;
  sheet: StatusSheet;
  onClose: () => void;
  onDone: (result: SetTeamEntryStatusResult) => void;
}) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { team, next } = sheet;
  const title = next === 1 ? t('ops2.panel.withdrawAria', { name: team.teamName }) : next === 2 ? t('ops2.panel.noShowTitle', { name: team.teamName }) : t('ops2.panel.reinstateAria', { name: team.teamName });
  const needsReason = next === 1;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (needsReason && !reason.trim()) { setError(t('ops2.panel.sayWhy')); return; }
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.put<SetTeamEntryStatusResult>(
        `/competitions/${competitionId}/teams/${team.teamId}/entry-status`,
        { status: next, reason: reason.trim() || null },
      );
      onDone(data);
    } catch (failure) {
      const status = statusOf(failure);
      setError(isOffline(failure)
        ? t('ops2.offline')
        : apiMessage(failure, status === 409 ? t('ops2.panel.cantUndo') : t('ops2.panel.saveError')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RefineSheet title={title} onClose={onClose}>
      <form className="ops-form" onSubmit={(event) => void submit(event)}>
        {next === 0
          ? <RefineNote>{t('ops2.panel.reinstateNote')}</RefineNote>
          : <RefineNote>{t('ops2.panel.removesNote')}</RefineNote>}
        <label className="rf-fld">{next === 0 ? t('ops2.pd.noteOptional') : next === 2 ? t('ops2.panel.reasonOptional') : t('ops2.panel.reasonLabel')}
          <textarea className="ops-note-input" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        </label>
        <span className="rf-t2">{t('ops2.panel.orgOnly')}</span>
        {error && <Notice>{error}</Notice>}
        <div className="rf-actions">
          <button type="button" className="rf-btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="rf-btn rf-btn-primary rf-grow" disabled={busy}>{busy ? t('common.saving') : next === 0 ? t('ops2.panel.reinstateTeam') : next === 1 ? t('ops2.panel.withdrawTeam') : t('ops2.panel.markNoShow')}</button>
        </div>
      </form>
    </RefineSheet>
  );
}
