import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { useOverlayTiles } from '../../../hooks/useOverlayTiles';
import { useT } from '../../../i18n/LanguageContext';
import { displaySectionName } from '../../../lib/section';
import { OVERLAY_TILES, bannerMessage, type LiveOptions, type OverlayTileId } from '../../../lib/streamOverlayTiles';
import type { CompetitionDetail, StreamOverlay } from '../../../types';
import { Notice } from '../../../components/Notice';
import { RefineSection } from '../../refine/Refine';
import { tileText } from './streamText';

type Tiles = ReturnType<typeof useOverlayTiles>;

function Choice<T extends string | number>({ label, value, choices, onPick }: { label: string; value: T; choices: { value: T; label: string }[]; onPick: (value: T) => void }) {
  return (
    <div className="sx-opt">
      <span className="sx-opt-label">{label}</span>
      <div className="sx-pills" role="radiogroup" aria-label={label}>
        {choices.map((choice) => (
          <button key={String(choice.value)} type="button" role="radio" aria-checked={value === choice.value} className="sx-pill" onClick={() => onPick(choice.value)}>{choice.label}</button>
        ))}
      </div>
    </div>
  );
}

/** The races that have finished, newest first, for the Race result choice. */
function finishedRaceChoices(competition: Pick<CompetitionDetail, 'sessions'>) {
  const list: { value: number; label: string }[] = [];
  for (const session of competition.sessions) {
    for (const heat of session.heats) {
      for (const race of heat.races) if (race.isComplete) list.push({ value: race.id, label: [heat.label, race.name].filter(Boolean).join(' · ') });
    }
  }
  return list.reverse().slice(0, 8);
}

/**
 * The problem strip under the overlay tiles. When the overlay was changed on another phone the action takes you to
 * the tile that is on now ("Show me"); any other failure that can be repeated gets "Try again".
 */
export function OverlayProblem({ tiles }: { tiles: Tiles }) {
  const t = useT();
  if (!tiles.error) return null;
  function show() {
    const current = document.querySelector<HTMLElement>('.sx-tiles [aria-checked="true"], .sx-desk-grid [aria-checked="true"]');
    current?.scrollIntoView?.({ block: 'center' });
    current?.focus();
  }
  const action = tiles.conflict ? { actionLabel: t('desk.stream.showMe'), onAction: show } : tiles.retryable ? { actionLabel: t('common.tryAgain'), onAction: () => void tiles.retry() } : {};
  return <Notice className="sx-status" {...action}>{tiles.error}</Notice>;
}

function Settings({ id, competition, tiles }: { id: OverlayTileId; competition: Pick<CompetitionDetail, 'sections' | 'sessions'>; tiles: Tiles }) {
  const t = useT();
  const { options, setOptions } = tiles;
  const set = <K extends keyof LiveOptions>(key: K) => (value: LiveOptions[K]) => void setOptions({ [key]: value } as Partial<LiveOptions>);
  const races = useMemo(() => finishedRaceChoices(competition), [competition]);
  let body: ReactNode = null;
  if (id === 'toplist') body = <Choice label={t('desk.stream.ov.show')} value={options.toplistRows} choices={[{ value: 3, label: t('desk.stream.ov.top3') }, { value: 5, label: t('desk.stream.ov.top5') }, { value: 8, label: t('desk.stream.ov.all') }]} onPick={set('toplistRows')} />;
  if (id === 'heat') body = <Choice label={t('desk.stream.ov.show')} value={options.heatShow} choices={[{ value: 'each', label: t('desk.stream.ov.eachRace') }, { value: 'total', label: t('desk.stream.ov.totalsOnly') }]} onPick={set('heatShow')} />;
  if (id === 'next') body = <Choice label={t('desk.stream.ov.show')} value={options.nextCount} choices={[{ value: 1, label: t('desk.stream.ov.nextRace') }, { value: 3, label: t('desk.stream.ov.next3') }]} onPick={set('nextCount')} />;
  if (id === 'podium') {
    body = (
      <>
        {competition.sections.length > 0 && (
          <Choice label={t('desk.stream.ov.ageGroup')} value={options.podiumSectionId ?? competition.sections[0].id}
            choices={competition.sections.map((section) => ({ value: section.id, label: displaySectionName(section.displayName) }))} onPick={set('podiumSectionId')} />
        )}
        <Choice label={t('desk.stream.ov.reveal')} value={options.podiumReveal} choices={[{ value: 'all', label: t('desk.stream.ov.allAtOnce') }, { value: 'one', label: t('desk.stream.ov.oneAtATime') }]} onPick={set('podiumReveal')} />
        {options.podiumReveal === 'one' && tiles.active === 'podium' && (
          <div className="sx-opt">
            <span className="sx-opt-label">{options.podiumShown < 3 ? t('desk.stream.ov.nextPlace', { place: t((['desk.stream.ov.place3', 'desk.stream.ov.place2', 'desk.stream.ov.place1'] as const)[options.podiumShown]) }) : t('desk.stream.ov.allThree')}</span>
            <div><button type="button" className="rf-btn" onClick={() => void tiles.revealNext()}>{options.podiumShown < 3 ? t('desk.stream.ov.revealNext') : t('desk.stream.ov.startAgain')}</button></div>
          </div>
        )}
      </>
    );
  }
  if (id === 'result') {
    body = races.length === 0
      ? <p className="rf-note">{t('desk.stream.ov.noRace')}</p>
      : <Choice label={t('desk.stream.ov.race')} value={options.resultRaceId ?? races[0].value} choices={races} onPick={set('resultRaceId')} />;
  }
  if (id === 'sponsor') {
    body = (
      <>
        <Choice label={t('desk.stream.ov.size')} value={options.sponsorSize} choices={[{ value: 'full', label: t('desk.stream.ov.fullScreen') }, { value: 'corner', label: t('desk.stream.ov.corner') }]} onPick={set('sponsorSize')} />
        {tiles.active === 'sponsor' && <div className="sx-opt"><div><button type="button" className="rf-btn" onClick={() => void tiles.nextSponsor()}>{t('desk.stream.ov.nextSponsor')}</button></div></div>}
      </>
    );
  }
  return (
    <div className="sx-settings" role="group" aria-label={t('desk.stream.ov.settingsOf', { name: tileText(t, id) })}>
      <strong>{tileText(t, id)}</strong>
      {body}
    </div>
  );
}

export function OverlayTab({ competition, overlay, tiles, canChange }: {
  competition: Pick<CompetitionDetail, 'sections' | 'sessions'>;
  overlay: StreamOverlay;
  tiles: Tiles;
  canChange: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState<OverlayTileId | null>(null);
  const banner = bannerMessage(overlay);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? banner;
  const active = OVERLAY_TILES.find((tile) => tile.id === tiles.active);

  return (
    <fieldset className="sx-fieldset" disabled={tiles.busy || !canChange}>
      <div className="sx-tiles" role="radiogroup" aria-label={t('desk.stream.ov.onScreen')}>
        {OVERLAY_TILES.map((tile) => {
          const on = tiles.active === tile.id;
          const isOpen = open === tile.id;
          return (
            <div key={tile.id} className="sx-tile" data-on={on} data-open={isOpen}>
              <button type="button" role="radio" aria-checked={on} className="sx-tile-pick" onClick={() => void tiles.pick(tile.id)}>{tileText(t, tile.id)}</button>
              {tile.settings && (
                <button type="button" className="sx-tile-chev" aria-label={t('desk.stream.ov.settingsOf', { name: tileText(t, tile.id) })} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : tile.id)}>
                  {isOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {active && !active.drawn && <p className="rf-note" role="status">{t('desk.stream.ov.notDrawn', { name: tileText(t, active.id).toLowerCase() })}</p>}
      {open && <Settings id={open} competition={competition} tiles={tiles} />}
      <OverlayProblem tiles={tiles} />
      {!canChange && <p className="rf-note">{t('desk.stream.ov.cantChange')}</p>}

      <RefineSection title={t('desk.stream.ov.banner')} />
      <form className="sx-banner" onSubmit={(event) => { event.preventDefault(); void tiles.postBanner(banner ? null : text).then(() => setDraft(null)); }}>
        <label className="rf-fld sx-banner-field">{t('desk.stream.ov.bannerField')}
          <input value={text} readOnly={Boolean(banner)} maxLength={140} placeholder={t('desk.stream.ov.bannerPlaceholder')} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <button type="submit" className={`rf-btn ${banner ? '' : 'rf-btn-primary'}`} disabled={!banner && !text.trim()}>{banner ? t('desk.stream.ov.takeDown') : t('desk.stream.ov.show')}</button>
      </form>
    </fieldset>
  );
}
