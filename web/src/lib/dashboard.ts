import type { CompetitionDetail, LiveStream } from '../types';
import { competitionDateText } from './competitionDates';
import { heatName } from './following';
import { displaySectionName } from './section';
import { computeTimings, formatTime } from './time';
import { sessionOrdinals, timetableRows } from './timetableRows';

export interface Fact { text: string; tone: 'normal' | 'late' | 'muted' }

export interface EventFacts {
  /** True while a heat is on in an arena. */
  isLive: boolean;
  /** "Open · Session 2, Heat 2 on now", or the dates when nothing is running. */
  line: string;
  timetable: Fact;
  toplists: Fact;
  live: Fact;
  details: Fact;
}

/**
 * The one-line facts on the Me page's event tiles, worked out from what the public event page already gives:
 * the timetable's delay, how many age groups there are, how many people are watching, and where it is.
 */
export function eventFacts(competition: CompetitionDetail, streams: readonly LiveStream[]): EventFacts {
  const sessions = competition.sessions ?? [];
  const rows = timetableRows(sessions, computeTimings(sessions), true);
  const ordinals = sessionOrdinals(sessions);
  const running = rows.find((row) => row.status === 'live' && row.heat);
  const open = rows.filter((row) => row.status !== 'finished');
  const late = open.reduce<typeof open[number] | null>((worst, row) => (row.delayMinutes > (worst?.delayMinutes ?? 0) ? row : worst), null);

  let line = competitionDateText(competition.startDate, competition.endDate);
  if (running?.heat) {
    const ordinal = ordinals.get(running.session.id);
    line = [displaySectionName(running.session.sectionName || running.session.name), ordinal ? `Session ${ordinal}, ${heatName(running)}` : heatName(running)].filter(Boolean).join(' · ') + ' on now';
  }

  const arena = late?.session.arenaName?.trim();
  const firstOpen = open.find((row) => row.effective);
  const timetable: Fact = late
    ? { text: `${arena ? `${arena} · ` : ''}${late.delayMinutes} min late`, tone: 'late' }
    : running ? { text: 'Running on time', tone: 'normal' }
    : firstOpen ? { text: `Next at ${formatTime(firstOpen.effective)}`, tone: 'normal' }
    : { text: rows.length ? 'All done' : 'Not published yet', tone: 'muted' };

  const groups = competition.sections.length;
  const toplists: Fact = groups > 0 ? { text: `${groups} age ${groups === 1 ? 'group' : 'groups'}`, tone: 'normal' } : { text: 'No age groups yet', tone: 'muted' };

  const onAir = streams.filter((stream) => stream.status === 1);
  const watching = onAir.reduce((sum, stream) => sum + (stream.viewerCount || 0), 0);
  const live: Fact = watching > 0 ? { text: `${watching} watching`, tone: 'normal' }
    : onAir.length ? { text: 'Stream is live', tone: 'normal' }
    : { text: 'Chat and results', tone: 'muted' };

  const place = competition.location?.trim();
  const details: Fact = { text: place || competitionDateText(competition.startDate, competition.endDate) || 'Venue and entries', tone: 'muted' };

  return { isLive: !!running, line, timetable, toplists, live, details };
}
