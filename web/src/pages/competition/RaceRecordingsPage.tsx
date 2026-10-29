import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useSavedReplays } from '../../hooks/useSavedReplays';
import { useLanguage } from '../../i18n/LanguageContext';
import { groupRaceRecordings } from '../../lib/raceRecordings';
import { shareOrDownloadFile } from '../../lib/shareFile';
import type { SavedReplayClip } from '../../live/replayBuffer';
import { RefineChoiceRow, RefineHeader, RefineList, RefineNote, RefinePage, RefineSection } from '../refine/Refine';
import { useCompetition } from './context';
import { ReplayEditor } from './streamControls/ReplayEditor';
import { lengthText } from './streamControls/streamText';
import './streamControls/streamControls.css';
import './raceRecordings.css';

/** Only worth a picker once the list is long. */
const PICKER_FROM_HEATS = 3;

const timeOf = (iso: string, locale: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
};

function fileNameFor(clip: SavedReplayClip) {
  const base = clip.label.replace(/[^\p{L}\p{N} ._-]+/gu, '').replace(/\s+/g, ' ').trim() || 'race';
  return `${base}.${clip.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
}

/**
 * Every race recording kept on this device, by session, then heat, then race in race order. A race that was not
 * recorded still gets its row, so the organiser can see the gaps. Recordings are made by Stream controls while a
 * camera is live and stay on the device that made them.
 */
export function RaceRecordingsPage() {
  const { t, locale } = useLanguage();
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  const clips = useSavedReplays(competition.id);
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = useMemo(() => groupRaceRecordings(competition.sessions, clips), [competition.sessions, clips]);
  const base = `/competitions/${competition.id}`;
  const streamControls = `${base}/stream-controls?tab=replay`;

  if (!canOrganise(competition)) {
    return (
      <RefinePage className="rr-page">
        <RefineHeader back={streamControls} backLabel={t('desk.recordings.backLabel')} context={competition.name} title={t('desk.recordings.title')} />
        <p className="rf-note">{t('desk.stream.page.organiserOnly')}</p>
      </RefinePage>
    );
  }

  const heats = groups.sessions.flatMap((session) => session.heats);
  const total = heats.reduce((sum, heat) => sum + heat.races.length, 0);
  const wanted = params.get('heat') ?? '';
  const picked = heats.some((heat) => String(heat.id) === wanted) ? wanted : '';
  const choose = (value: string) => setParams(value ? { heat: value } : {}, { replace: true });
  const options = [{ value: '', label: t('desk.recordings.allHeats') }, ...heats.map((heat) => ({ value: String(heat.id), label: heat.heading }))];
  const empty = groups.recorded === 0 && groups.other.length === 0;

  const open = clips.find((clip) => clip.id === openId) ?? null;
  const toggle = (clip: SavedReplayClip) => setOpenId(openId === clip.id ? null : clip.id);

  function clipRows(name: string, list: SavedReplayClip[]) {
    return list.map((clip, index) => {
      const time = timeOf(clip.createdAt, locale);
      const shown = index === 0 ? name : t('desk.recordings.earlier', { name });
      const detail = [time && t('desk.recordings.recorded', { time }), lengthText(t, Math.round(clip.durationSeconds))].filter(Boolean).join(' · ');
      return (
        <Fragment key={clip.id}>
          <li className="rf-row rr-row">
            <span className="rf-grow"><span className="rf-t1">{shown}</span><span className="rf-t2">{detail}</span></span>
            <button type="button" className="rf-btn rr-btn" aria-expanded={open?.id === clip.id} aria-label={`${open?.id === clip.id ? t('common.close') : t('desk.stream.rt.watch')}: ${shown}`} onClick={() => toggle(clip)}>
              {open?.id === clip.id ? t('common.close') : t('desk.stream.rt.watch')}
            </button>
            <button type="button" className="rf-btn rr-btn" aria-label={t('desk.recordings.shareLabel', { name: shown })}
              onClick={() => void shareOrDownloadFile(new File([clip.blob], fileNameFor(clip), { type: clip.mimeType }), { title: clip.label })}>{t('desk.recordings.share')}</button>
          </li>
          {open?.id === clip.id && (
            <li className="rr-player">
              <ReplayEditor key={clip.id} clip={clip} editable={false} justMade={false} onClose={() => setOpenId(null)} />
            </li>
          )}
        </Fragment>
      );
    });
  }

  return (
    <RefinePage className="rr-page">
      <RefineHeader back={streamControls} backLabel={t('desk.recordings.backLabel')} context={competition.name} title={t('desk.recordings.title')} />

      {empty ? (
        <div className="rr-empty" role="status">
          <h2 className="rr-empty-title">{t('desk.recordings.emptyTitle')}</h2>
          <p>{t('desk.recordings.emptyBody')}</p>
          <Link to={streamControls} className="rf-btn rf-btn-primary">{t('desk.recordings.emptyAction')}</Link>
        </div>
      ) : (
        <>
          <RefineNote>{t('desk.recordings.summary', { recorded: groups.recorded, total })}</RefineNote>
          {heats.length >= PICKER_FROM_HEATS && (
            <RefineList as="div" label={t('desk.recordings.show')}>
              <RefineChoiceRow label={t('desk.recordings.show')} value={picked} options={options} onChange={choose} />
            </RefineList>
          )}

          {groups.sessions.map((session) => {
            const shownHeats = session.heats.filter((heat) => !picked || String(heat.id) === picked);
            if (shownHeats.length === 0) return null;
            return (
              <section key={session.id} aria-label={session.title}>
                <RefineSection title={session.title} meta={session.arenaName || undefined} />
                {shownHeats.map((heat) => (
                  <div key={heat.id} className="rr-heat">
                    <h3 className="rr-heat-title"><span>{heat.title}</span><span>{t('desk.recordings.heatCount', { recorded: heat.races.filter((r) => r.clips.length).length, total: heat.races.length })}</span></h3>
                    <RefineList label={`${session.title} · ${heat.title}`}>
                      {heat.races.map(({ race, clips: kept }) => kept.length > 0
                        ? <Fragment key={race.id}>{clipRows(race.name, kept)}</Fragment>
                        : (
                          <li key={race.id} className="rf-row rr-row rr-gap">
                            <span className="rf-grow"><span className="rf-t1">{race.name}</span><span className="rf-t2">{t('desk.recordings.notRecorded')}</span></span>
                          </li>
                        ))}
                    </RefineList>
                  </div>
                ))}
              </section>
            );
          })}

          {!picked && groups.other.length > 0 && (
            <section aria-label={t('desk.recordings.other')}>
              <RefineSection title={t('desk.recordings.other')} />
              <RefineList label={t('desk.recordings.other')}>
                {groups.other.map((clip) => <Fragment key={clip.id}>{clipRows(clip.label, [clip])}</Fragment>)}
              </RefineList>
            </section>
          )}
        </>
      )}
    </RefinePage>
  );
}
