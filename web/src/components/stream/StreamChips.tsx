import type { LiveStream } from '../../types';
import { useT } from '../../i18n/LanguageContext';

export function StreamChips({ streams, selected, onSelect }: { streams: LiveStream[]; selected: LiveStream; onSelect: (id: number) => void }) {
  const t = useT();
  const arenas = [...new Set(streams.map((stream) => stream.arenaName))];
  const angles = streams.filter((stream) => stream.arenaName === selected.arenaName);
  return <div className="flex flex-col gap-2">
    {arenas.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label={t('teams.arena.arena')}>
      {arenas.map((arena) => <button key={arena} className="mg-stream-chip" aria-pressed={arena === selected.arenaName} onClick={() => onSelect(streams.find((stream) => stream.arenaName === arena)!.id)}>{arena}</button>)}
    </div>}
    {angles.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label={t('teams.stream.angle')}>
      {angles.map((stream) => <button key={stream.id} className="mg-stream-chip" aria-pressed={stream.id === selected.id} onClick={() => onSelect(stream.id)}>{stream.angleName}</button>)}
    </div>}
  </div>;
}
