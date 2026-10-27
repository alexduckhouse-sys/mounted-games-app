import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useDayForecast } from '../hooks/useDayForecast';
import { useNow } from '../hooks/useNow';
import { useT } from '../i18n/LanguageContext';
import { formatTime } from '../lib/time';
import {
  isEventDay, openArenas, pauseState, racingToCome, readSnoozes, snoozeUntil, weatherLineState, writeSnoozes,
  type Hazard, type HazardRun, type Snoozes, type WeatherLineState,
} from '../lib/weatherAlert';
import type { CompetitionDetail } from '../types';
import { useSetWeatherLine } from './WeatherLineContext';
import { ClearSheet, WarnSheet } from './WeatherSheets';

const time = (ms: number) => formatTime(new Date(ms));

/** The warning sheet keeps what it was opened with, so it does not change under the organiser's thumb mid-edit. */
type Open = { type: 'warn'; run: HazardRun; arenas: string[]; allPaused: boolean } | { type: 'clear'; kind: Hazard; since: number };

/**
 * Weather alerts for organisers on an event day. It watches today's forecast near the venue and, when thunder or
 * heavy rain is due within about two hours, puts one line under the ticker (see `WeatherLine`) that opens a sheet to
 * pause racing and tell everyone. After a pause for weather it says when it is clear to start again. Nobody else sees
 * anything: organisers pass the news on in the announcement. See docs/plans/2026-10-27-weather-alerts.md.
 */
export function WeatherAlert({ competition, reload }: { competition: CompetitionDetail; reload: () => void }) {
  const t = useT();
  const { canOrganise } = useAuth();
  const now = useNow(60_000);
  const nowMs = now.getTime();
  const sessions = competition.sessions;
  const allowed = canOrganise(competition) && isEventDay(competition, sessions, now) && racingToCome(sessions);
  const hours = useDayForecast(competition.latitude, competition.longitude, allowed);
  const [snoozes, setSnoozes] = useState<Snoozes>(() => readSnoozes(competition.id));
  const [open, setOpen] = useState<Open | null>(null);
  const state: WeatherLineState = allowed ? weatherLineState({ now: nowMs, hours, sessions, snoozes }) : { phase: 'none' };

  // What the line says and does is worked out here; the shell only draws it.
  let tone: 'warn' | 'paused' | 'clear' = 'warn';
  let icon: 'thunder' | 'rain' | 'sun' = 'thunder';
  let text = '';
  let actionLabel: string | undefined;
  let opens: Open | null = null;
  if (state.phase === 'warn') {
    const { run } = state;
    const thunder = run.kind === 'thunder';
    icon = run.kind === 'thunder' ? 'thunder' : 'rain';
    const underWay = run.startsAt <= nowMs;
    text = underWay
      ? t(thunder ? 'shell.weather.line.thunderNow' : 'shell.weather.line.rainNow')
      : t(thunder ? 'shell.weather.line.thunderFrom' : 'shell.weather.line.rainFrom', { time: time(run.startsAt) });
    actionLabel = t(thunder ? 'shell.weather.line.whatToDo' : 'shell.weather.line.tellEveryone');
    opens = { type: 'warn', run, arenas: openArenas(sessions), allPaused: pauseState(sessions).allPaused };
  } else if (state.phase === 'paused') {
    tone = 'paused';
    icon = state.kind === 'thunder' ? 'thunder' : 'rain';
    const thunder = state.kind === 'thunder';
    text = t(thunder
      ? (state.forecastKnown ? 'shell.weather.line.pausedThunder' : 'shell.weather.line.pausedThunderShort')
      : (state.forecastKnown ? 'shell.weather.line.pausedRain' : 'shell.weather.line.pausedRainShort'));
  } else if (state.phase === 'clear') {
    tone = 'clear';
    icon = 'sun';
    text = t(state.kind === 'thunder' ? 'shell.weather.line.clearThunder' : 'shell.weather.line.clearRain', { time: time(state.since) });
    actionLabel = t('shell.weather.line.startAgain');
    opens = { type: 'clear', kind: state.kind, since: state.since };
  }
  const visible = state.phase !== 'none';

  // The line is published to the shell. Opening goes through a ref so the published line only changes when its words do.
  const opensRef = useRef<Open | null>(null);
  useEffect(() => { opensRef.current = opens; });
  const setLine = useSetWeatherLine();
  const tappable = opens != null;
  useEffect(() => {
    if (!visible) { setLine(null); return; }
    setLine({ tone, icon, text, actionLabel, onOpen: tappable ? () => setOpen(opensRef.current) : undefined });
    return () => setLine(null);
  }, [visible, tone, icon, text, actionLabel, tappable, setLine]);

  function handled(run: HazardRun) {
    const next = { ...snoozes, [run.kind]: snoozeUntil(run) };
    setSnoozes(next);
    writeSnoozes(competition.id, next);
  }

  const common = { competitionId: competition.id, sessions, nowMs, reload, onClose: () => setOpen(null) };
  if (open?.type === 'warn') {
    return <WarnSheet {...common} run={open.run} arenas={open.arenas} allPaused={open.allPaused} onHandled={handled} />;
  }
  if (open?.type === 'clear') {
    return <ClearSheet {...common} kind={open.kind} since={open.since} pausedArenas={pauseState(sessions).weather?.arenas ?? []} />;
  }
  return null;
}
