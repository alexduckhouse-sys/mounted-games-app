import type { SavedReplayClip } from '../live/replayBuffer';
import type { Race, Session } from '../types';
import { sessionOrdinals, sessionTitle } from './timetableRows';

export interface RecordingRace {
  race: Race;
  /** What this phone kept for the race, newest first. Empty when nothing was recorded. */
  clips: SavedReplayClip[];
}

export interface RecordingHeat {
  id: number;
  /** "Heat 1", or the heat's own label. */
  title: string;
  /** "Under 12 Session 1 · Heat 1", the same words the recording's name starts with. */
  heading: string;
  races: RecordingRace[];
}

export interface RecordingSession {
  id: number;
  title: string;
  arenaName: string;
  heats: RecordingHeat[];
}

export interface RaceRecordings {
  sessions: RecordingSession[];
  /** Race recordings that fit no race in the timetable any more (the race or heat was removed or renamed). */
  other: SavedReplayClip[];
  /** How many races have at least one recording. */
  recorded: number;
}

const isRaceSession = (session: Session) => (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
const newestFirst = (a: SavedReplayClip, b: SavedReplayClip) => b.createdAt.localeCompare(a.createdAt);

/**
 * Lays the race recordings kept on this device out by session, then heat, then race in race order, with every race
 * listed even when nothing was recorded for it. A recording belongs to a race by the race it was made for, or, for
 * older ones that did not note it, by its name ("<session> · <heat> · <race>", as made when the race was scored).
 */
export function groupRaceRecordings(sessions: Session[], clips: SavedReplayClip[]): RaceRecordings {
  const recordings = clips.filter((clip) => clip.source === 'race').sort(newestFirst);
  const ordinals = sessionOrdinals(sessions);
  const used = new Set<string>();
  let recorded = 0;

  const grouped: RecordingSession[] = [...sessions]
    .filter(isRaceSession)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((session) => {
      const title = sessionTitle(session, ordinals);
      const heats = [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex).map((heat, index): RecordingHeat => {
        const heatTitle = heat.label || `Heat ${index + 1}`;
        const heading = `${title} · ${heatTitle}`;
        const races = [...heat.races].sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id).map((race): RecordingRace => {
          const mine = recordings.filter((clip) => !used.has(clip.id) && (clip.raceId != null ? clip.raceId === race.id : clip.label === `${heading} · ${race.name}`));
          mine.forEach((clip) => used.add(clip.id));
          if (mine.length) recorded += 1;
          return { race, clips: mine };
        });
        return { id: heat.id, title: heatTitle, heading, races };
      }).filter((heat) => heat.races.length > 0);
      return { id: session.id, title, arenaName: session.arenaName?.trim() ?? '', heats };
    })
    .filter((session) => session.heats.length > 0);

  return { sessions: grouped, other: recordings.filter((clip) => !used.has(clip.id)), recorded };
}
