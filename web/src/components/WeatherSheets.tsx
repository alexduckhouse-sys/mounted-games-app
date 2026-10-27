import { useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n/LanguageContext';
import { estimateLastRaceFinish } from '../lib/rainDelay';
import { formatTime } from '../lib/time';
import { suggestedRestart, type Hazard, type HazardRun } from '../lib/weatherAlert';
import { RefineSwitchRow } from '../pages/refine/Refine';
import { PickSheet } from '../pages/clubShop/ui';
import type { Session } from '../types';
import { Sheet } from './Sheet';

const MAX_ANNOUNCEMENT = 2000;
const time = (ms: number) => formatTime(new Date(ms));

/** What the sheets need to know about the event, and what to do afterwards. */
export interface WeatherSheetProps {
  competitionId: number;
  sessions: Session[];
  nowMs: number;
  /** Fetch the timetable again after a change. */
  reload: () => void;
  onClose: () => void;
}

function AnnouncementField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const t = useT();
  return (
    <label className="kit-sheet-field">
      {t('shell.weather.sheet.announcement')}
      <textarea value={value} maxLength={MAX_ANNOUNCEMENT} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/**
 * "Thunder on the way" / "Heavy rain on the way": pause racing (or not), pick the arenas, edit the announcement, and
 * tell everyone in one go. The announcement goes with the pause request, so the two cannot half-happen.
 */
export function WarnSheet({ run, arenas, allPaused, onHandled, competitionId, sessions, nowMs, reload, onClose }: WeatherSheetProps & {
  run: HazardRun;
  /** Arenas that still have something to run. */
  arenas: string[];
  /** Racing is already paused everywhere, so there is nothing to switch on. */
  allPaused: boolean;
  /** Called after "Pause and tell everyone" / "Tell everyone", and after "Not now". */
  onHandled: (run: HazardRun) => void;
}) {
  const t = useT();
  const thunder = run.kind === 'thunder';
  const underWay = run.startsAt <= nowMs;
  const [pauseOn, setPauseOn] = useState(thunder && !allPaused);
  const [arena, setArena] = useState('');
  const [picking, setPicking] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const draftKey = thunder
    ? (pauseOn ? 'shell.weather.draft.thunderPause' : 'shell.weather.draft.thunderNoPause')
    : (pauseOn ? 'shell.weather.draft.rainPause' : 'shell.weather.draft.rainNoPause');
  const draft = edited ?? t(draftKey, { time: time(run.startsAt) });
  const canSend = draft.trim().length > 0 && !busy;

  const restart = suggestedRestart(run, nowMs);
  const finish = pauseOn ? estimateLastRaceFinish(sessions, new Date(restart), { arenaName: arena || null, nowMs }) : null;
  const sheetText = underWay
    ? t(thunder ? 'shell.weather.sheet.thunderNowText' : 'shell.weather.sheet.rainNowText', { until: time(run.endsAt) })
    : t(thunder ? 'shell.weather.sheet.thunderText' : 'shell.weather.sheet.rainText', { from: time(run.startsAt), until: time(run.endsAt) });

  async function send(close: () => void) {
    setBusy(true);
    setError(false);
    try {
      const announcement = draft.trim();
      if (pauseOn) await api.post(`/competitions/${competitionId}/sessions/pause`, { arenaName: arena || undefined, reason: run.kind, announcement });
      else await api.post(`/competitions/${competitionId}/sessions/weather-notice`, { body: announcement });
      onHandled(run);
      reload();
      close();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet title={t(thunder ? 'shell.weather.sheet.thunderTitle' : 'shell.weather.sheet.rainTitle')} description={sheetText} onClose={onClose}>
        {({ close }) => (
          <>
            {(!allPaused || arenas.length > 1) && (
              <div className="rf-list">
                {!allPaused && <RefineSwitchRow label={t('shell.weather.sheet.pauseRacing')} on={pauseOn} onChange={(next) => { setPauseOn(next); setError(false); }} />}
                {pauseOn && arenas.length > 1 && (
                  <button type="button" className="rf-row rf-choice-row" aria-haspopup="dialog" onClick={() => setPicking(true)}>
                    <span className="rf-grow rf-t1">{t('shell.weather.sheet.arenas')}</span>
                    <span className="rf-choice-val">{arena || t('shell.weather.sheet.allArenas')}</span>
                    <ChevronRight className="rf-chev h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
            {finish && <p className="kit-sheet-text">{t('shell.weather.sheet.finish', { restart: time(restart), finish: formatTime(finish) })}</p>}
            <AnnouncementField value={draft} onChange={(text) => { setEdited(text); setError(false); }} />
            {error && <p role="alert" className="kit-sheet-text">{t('shell.weather.sheet.error')}</p>}
            <div className="kit-acts">
              <button type="button" className="kit-pill kit-pill-fill" disabled={!canSend} onClick={() => void send(close)}>
                {busy ? t('shell.weather.sheet.sending') : t(pauseOn ? 'shell.weather.sheet.pauseAndTell' : 'shell.weather.sheet.tellEveryone')}
              </button>
              <button type="button" className="kit-pill" disabled={busy} onClick={() => { onHandled(run); close(); }}>{t('common.notNow')}</button>
            </div>
          </>
        )}
      </Sheet>
      {picking && (
        <PickSheet
          title={t('shell.weather.sheet.arenas')}
          options={[{ value: '', label: t('shell.weather.sheet.allArenas') }, ...arenas.map((name) => ({ value: name, label: name }))]}
          value={arena}
          onPick={setArena}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

/**
 * "Start again?": resume the arenas that were paused for weather and tell everyone. Each arena is its own request, the
 * announcement going with the first, so a retry after a dropped signal never says it twice.
 */
export function ClearSheet({ kind, since, pausedArenas, competitionId, sessions, nowMs, reload, onClose }: WeatherSheetProps & {
  kind: Hazard;
  since: number;
  /** Arenas paused for weather; an empty name means sessions with no arena. */
  pausedArenas: string[];
}) {
  const t = useT();
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const told = useRef(false);
  const draft = edited ?? t('shell.weather.draft.clear');
  const canSend = draft.trim().length > 0 && !busy;
  const finish = estimateLastRaceFinish(sessions, new Date(nowMs), { nowMs });

  async function send(close: () => void) {
    setBusy(true);
    setError(false);
    try {
      // Sessions with no arena can only be resumed together with everything else.
      const targets = pausedArenas.includes('') ? [''] : pausedArenas;
      for (const arenaName of targets) {
        await api.post(`/competitions/${competitionId}/sessions/resume`, { arenaName: arenaName || undefined, announcement: told.current ? undefined : draft.trim() });
        told.current = true;
      }
      reload();
      close();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('shell.weather.sheet.clearTitle')} description={t(kind === 'thunder' ? 'shell.weather.sheet.clearThunderText' : 'shell.weather.sheet.clearRainText', { time: time(since) })} onClose={onClose}>
      {({ close }) => (
        <>
          {finish && <p className="kit-sheet-text">{t('shell.weather.sheet.finish', { restart: time(nowMs), finish: formatTime(finish) })}</p>}
          <AnnouncementField value={draft} onChange={(text) => { setEdited(text); setError(false); }} />
          {error && <p role="alert" className="kit-sheet-text">{t('shell.weather.sheet.error')}</p>}
          <div className="kit-acts">
            <button type="button" className="kit-pill kit-pill-fill" disabled={!canSend} onClick={() => void send(close)}>
              {busy ? t('shell.weather.sheet.sending') : t('shell.weather.sheet.continueAndTell')}
            </button>
            <button type="button" className="kit-pill" disabled={busy} onClick={() => close()}>{t('shell.weather.sheet.notYet')}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
