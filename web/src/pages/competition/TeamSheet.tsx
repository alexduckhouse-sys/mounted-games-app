import { Link, useInRouterContext } from 'react-router-dom';
import { Sheet } from '../../components/Sheet';
import type { Team } from '../../types';
import { bibAccent, bibLabel, parseBibAndFlag } from '../../lib/bib';
import { ordinal, type TeamBlock, type TeamDetail } from '../../lib/toplist';
import { statusLabel, statusLetter } from '../../lib/resultStatus';
import { formatPoints } from '../../lib/formatPoints';
import { statsProfileHref } from '../../lib/stats';
import { StatsSubjectKind } from '../../types';

const PNG_FLAGS = new Set([
  'at', 'au', 'be', 'ca', 'ch', 'cz', 'de', 'dk', 'es', 'fi', 'fr',
  'ie', 'it', 'nl', 'no', 'nz', 'pl', 'pt', 'se', 'us', 'za',
  'gb', 'gb-eng', 'gb-sct', 'gb-wls', 'gb-nir',
]);

/** Resolves the public flag asset path (.png for the 26 bundled PNG flags, .svg for all other ISO codes). */
// eslint-disable-next-line react-refresh/only-export-components
export function flagSrc(code: string): string {
  const lower = code.trim().toLowerCase();
  const ext = PNG_FLAGS.has(lower) || lower.startsWith('us-') || lower.startsWith('au-') ? 'png' : 'svg';
  return `/flags/${lower}.${ext}`;
}

const eyebrow = 'text-[10px] font-bold uppercase tracking-[0.08em]';

export interface TeamSheetRider {
  fullName: string;
  horseName?: string | null;
}

/**
 * A team's points by session and its final, as a kit sheet: the team name, one line about it, Team page and Close,
 * then the breakdown. Esc, a swipe down or a tap on the dim behind it closes it and focus goes back to the row.
 */
export function TeamSheet({
  detail,
  sectionName,
  competitionId,
  team,
  riders,
  onClose,
}: {
  detail: TeamDetail;
  sectionName: string | null;
  competitionId?: number;
  team?: Team | null;
  riders?: TeamSheetRider[];
  onClose: () => void;
}) {
  const inRouter = useInRouterContext();
  const rode = detail.blocks.filter((block) => block.kind === 'session' && block.points != null).length;
  const rodeText = rode > 0 ? `rode ${rode} ${rode === 1 ? 'session' : 'sessions'}` : null;
  const sub = [sectionName, [rodeText, detail.final?.label].filter(Boolean).join(' + ')].filter(Boolean).join(' · ');
  const parsedBib = parseBibAndFlag(team?.bibDescription);
  const teamPage = competitionId != null ? `/competitions/${competitionId}/teams/${detail.teamId}` : null;

  return (
    <Sheet
      title={<>
        {parsedBib.flag && <img src={flagSrc(parsedBib.flag)} alt="" className="mr-1.5 inline-block h-4 w-6 rounded-[2px] object-cover align-middle" />}
        <a href={statsProfileHref(StatsSubjectKind.Team, detail.teamName.trim().toLowerCase())} className="!text-inherit !no-underline hover:!underline">{detail.teamName}</a>
      </>}
      description={sub || undefined}
      onClose={onClose}
    >
      {({ close }) => (
        <>
          {parsedBib.bib && (
            <p className="m-0 flex items-center gap-1.5 text-xs font-medium text-[rgb(var(--mg-body))]">
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/15" style={{ background: bibAccent(team?.bibDescription) }} />
              <span className="truncate">{bibLabel(team?.bibDescription)}</span>
            </p>
          )}

          <div className="kit-acts">
            {teamPage && (inRouter
              ? <Link to={teamPage} onClick={onClose} className="kit-pill kit-pill-fill">Team page</Link>
              : <a href={teamPage} className="kit-pill kit-pill-fill">Team page</a>)}
            <button type="button" className={teamPage ? 'kit-pill' : 'kit-pill kit-pill-fill'} onClick={() => close()}>Close</button>
          </div>

          <div className={`grid gap-2 ${detail.final ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div className="flex flex-col gap-1 rounded-[10px] bg-[rgb(var(--mg-tint))] px-3 py-2.5">
              <span className={`${eyebrow} text-[rgb(var(--mg-muted))]`}>Qualifying</span>
              <span className="mg-display text-[22px] font-bold leading-none text-[rgb(var(--mg-heading))]">
                {detail.qualifyingPosition != null ? <>{ordinal(detail.qualifyingPosition)} · {detail.qualifyingPoints} pts</> : 'No points yet'}
              </span>
            </div>
            {detail.final && (
              <div className="flex flex-col gap-1 rounded-[10px] bg-[rgb(var(--mg-live-row))] px-3 py-2.5">
                <span className={`${eyebrow} text-[rgb(var(--mg-red))]`}>{detail.final.label}</span>
                <span className="mg-display text-[22px] font-bold leading-none text-[rgb(var(--mg-heading))]">
                  {detail.final.place != null ? ordinal(detail.final.place) : '–'} · {formatPoints(detail.final.points ?? 0)} pts
                </span>
              </div>
            )}
          </div>

          {riders && riders.length > 0 && (
            <section aria-label="Riders and ponies" className="flex flex-col gap-1">
              <span className={`${eyebrow} text-[rgb(var(--mg-muted))]`}>Riders & ponies</span>
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {riders.map((r, i) => (
                  <li key={`${r.fullName}-${i}`}>
                    <a href={statsProfileHref(StatsSubjectKind.Rider, r.fullName.trim().toLowerCase())} className="font-semibold text-[rgb(var(--mg-heading))]">{r.fullName}</a>
                    {r.horseName && <> on <a href={statsProfileHref(StatsSubjectKind.Pony, r.horseName.trim().toLowerCase())} className="text-[rgb(var(--mg-body))]">{r.horseName}</a></>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail.blocks.map((block) => <Block key={block.key} block={block} />)}
        </>
      )}
    </Sheet>
  );
}

function Block({ block }: { block: TeamBlock }) {
  const accent = block.kind === 'final' ? 'var(--mg-red)' : 'var(--mg-heading)';
  return (
    <section aria-label={block.label} className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 border-b-[1.5px] pb-1" style={{ borderColor: `rgb(${accent})` }}>
        <h3 className="mg-display flex-1 text-[13px] font-bold uppercase leading-none tracking-[0.05em]" style={{ color: `rgb(${accent})` }}>{block.label}</h3>
        {block.note && <span className="text-[11px] font-medium text-[rgb(var(--mg-muted))]">{block.note}</span>}
        <span className="mg-display text-lg font-bold leading-none text-[rgb(var(--mg-heading))]">{block.points == null ? '–' : formatPoints(block.points)}<span className="sr-only">{block.points == null ? ' no points' : ' points'}</span></span>
      </div>
      {block.points == null
        ? <p className="text-xs font-medium text-[rgb(var(--mg-faint))]">Didn’t ride this session</p>
        : block.races.length === 0
          ? <p className="text-xs font-medium text-[rgb(var(--mg-faint))]">Not ridden yet</p>
          : (
            <ul className="overflow-hidden rounded-[10px] border border-[rgb(var(--mg-rule))]">
              {block.races.map((race) => (
                <li key={race.id} className="flex min-h-10 items-center gap-3 border-b border-[rgb(var(--mg-rule-soft))] px-3 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{race.name}</span>
                  <span className="shrink-0 text-[13px] font-medium text-[rgb(var(--mg-body))]">{race.eliminated ? <><span aria-hidden="true" title={statusLabel(true, race.status) ?? undefined}>{statusLetter(true, race.status)}</span><span className="sr-only">{statusLabel(true, race.status)}</span></> : race.placing != null ? ordinal(race.placing) : '–'}</span>
                  <span className="mg-display w-9 shrink-0 text-right text-lg font-bold leading-none tabular-nums text-[rgb(var(--mg-heading))]">{formatPoints(race.points)}<span className="sr-only"> points</span></span>
                </li>
              ))}
            </ul>
          )}
    </section>
  );
}
