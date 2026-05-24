import { CalendarDays, MapPin, MapPinned, Info, Layers, Users } from 'lucide-react';
import { useCompetition } from './context';

export function DetailsTab() {
  const { competition } = useCompetition();
  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold">{competition.name}</h2>
          {competition.description && (
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">
              {competition.description}
            </p>
          )}
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs sm:text-sm">
          <div className="flex items-start gap-2">
            <CalendarDays className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Dates</dt>
              <dd>
                {new Date(competition.startDate).toLocaleDateString()}
                {competition.endDate && ` → ${new Date(competition.endDate).toLocaleDateString()}`}
              </dd>
            </div>
          </div>

          {competition.location && (
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Location</dt>
                <dd className="break-words">{competition.location}</dd>
              </div>
            </div>
          )}

          {competition.what3Words && (
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">what3words</dt>
                <dd>
                  <a
                    href={`https://what3words.com/${competition.what3Words.replace(/^\/\/\//, '')}`}
                    target="_blank" rel="noreferrer"
                    className="font-mono text-rose-600 dark:text-rose-300 hover:underline"
                  >
                    {competition.what3Words.startsWith('///') ? competition.what3Words : `///${competition.what3Words}`}
                  </a>
                </dd>
              </div>
            </div>
          )}

          {competition.appleMapsUrl && (
            <div className="flex items-start gap-2">
              <MapPinned className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Map pin</dt>
                <dd>
                  <a
                    href={competition.appleMapsUrl}
                    target="_blank" rel="noreferrer"
                    className="text-brand-700 dark:text-brand-300 hover:underline"
                  >
                    Open in Apple Maps
                  </a>
                </dd>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2">
            <Layers className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Sections</dt>
              <dd>{competition.sections.length || '—'}</dd>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Users className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Teams</dt>
              <dd>{competition.teams.length}</dd>
            </div>
          </div>
        </dl>

        {competition.sections.length > 0 && (
          <div>
            <h3 className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
              Sections
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {competition.sections.map((sec) => (
                <li key={sec.id} className="pill bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200">
                  {sec.displayName}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
