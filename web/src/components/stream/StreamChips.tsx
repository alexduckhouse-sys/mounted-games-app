import type { LiveStream } from '../../types';
import { useT } from '../../i18n/LanguageContext';

const arenaKey = (name: string) => name.trim().toLowerCase();

export function StreamChips({ streams, selected, onSelect }: { streams: LiveStream[]; selected: LiveStream; onSelect: (id: number) => void }) {
  const t = useT();
  const seenArenas = new Set<string>();
  const arenas: string[] = [];
  for (const stream of streams) {
    const key = arenaKey(stream.arenaName);
    if (!seenArenas.has(key)) {
      seenArenas.add(key);
      arenas.push(stream.arenaName.trim() || stream.arenaName);
    }
  }
  const selectedKey = arenaKey(selected.arenaName);
  const angles = streams.filter((stream) => arenaKey(stream.arenaName) === selectedKey);
  return <div className="flex flex-col gap-2">
    {arenas.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label={t('teams.arena.arena')}>
      {arenas.map((arena) => <button key={arenaKey(arena)} className="mg-stream-chip" aria-pressed={arenaKey(arena) === selectedKey} onClick={() => onSelect(streams.find((stream) => arenaKey(stream.arenaName) === arenaKey(arena))!.id)}>{arena}</button>)}
    </div>}
    {angles.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label={t('teams.stream.angle')}>
      {angles.map((stream) => <button key={stream.id} className="mg-stream-chip" aria-pressed={stream.id === selected.id} onClick={() => onSelect(stream.id)}>{stream.angleName}</button>)}
    </div>}
  </div>;
}
