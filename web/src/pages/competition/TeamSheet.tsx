import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ordinal, type TeamBlock, type TeamDetail } from '../../lib/toplist';
import { statusLabel, statusLetter } from '../../lib/resultStatus';
import { formatPoints } from '../../lib/formatPoints';
import { statsProfileHref } from '../../lib/stats';
import { StatsSubjectKind } from '../../types';

const eyebrow = 'text-[10px] font-bold uppercase tracking-[0.08em]';

export interface TeamSheetRider {
  fullName: string;
  horseName?: string | null;
}

/** A team's points by session and its final, as a bottom sheet. Esc or the backdrop closes it and focus goes back to the row. */
export function TeamSheet({ detail, sectionName, riders, onClose }: { detail: TeamDetail; sectionName: string | null; riders?: TeamSheetRider[]; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheetRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(sheetRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, []);

  const rode = detail.blocks.filter((block) => block.kind === 'session' && block.points != null).length;
  const rodeText = rode > 0 ? `rode ${rode} ${rode === 1 ? 'session' : 'sessions'}` : null;
  const sub = [sectionName, [rodeText, detail.final?.label].filter(Boolean).join(' + ')].filter(Boolean).join(' · ');

  return createPortal(
    <div className="mg-font fixed inset-0 z-[80] flex items-end justify-center bg-[rgb(var(--mg-overlay)/0.55)]" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="team-sheet-title" className="flex max-h-[82dvh] w-full max-w-[560px] flex-col gap-3.5 overflow-y-auto rounded-t-[14px] bg-[rgb(var(--mg-surface))] px-4 pb-6 pt-2 text-[rgb(var(--mg-ink))] shadow-[0_-8px_24px_rgb(var(--mg-overlay)/0.22)]">
        <span aria-hidden="true" className="mx-auto h-1 w-9 shrink-0 rounded-sm bg-[rgb(var(--mg-control))]" />
        <div className="sticky -top-2 z-[1] -mx-4 -mt-1.5 flex items-start gap-2.5 border-b border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-surface))] px-4 pb-2.5 pt-1.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="team-sheet-title" className="mg-display text-2xl font-bold leading-none text-[rgb(var(--mg-heading))]">
              <a href={statsProfileHref(StatsSubjectKind.Team, detail.teamName.trim().toLowerCase())} className="!text-inherit !no-underline hover:!underline">{detail.teamName}</a>
            </h2>
            {sub && <p className="text-[13px] font-medium leading-snug text-[rgb(var(--mg-muted))]">{sub}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close team breakdown" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[rgb(var(--mg-control))] text-[rgb(var(--mg-heading))]"><X aria-hidden="true" className="h-4 w-4" /></button>
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
      </div>
    </div>,
    document.body,
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
