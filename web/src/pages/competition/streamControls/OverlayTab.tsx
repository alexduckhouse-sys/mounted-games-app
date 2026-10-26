import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { useOverlayTiles } from '../../../hooks/useOverlayTiles';
import { displaySectionName } from '../../../lib/section';
import { OVERLAY_TILES, bannerMessage, type LiveOptions, type OverlayTileId } from '../../../lib/streamOverlayTiles';
import type { CompetitionDetail, StreamOverlay } from '../../../types';
import { Notice } from '../../../components/Notice';
import { RefineSection } from '../../refine/Refine';

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
  if (!tiles.error) return null;
  function show() {
    const current = document.querySelector<HTMLElement>('.sx-tiles [aria-checked="true"], .sx-desk-grid [aria-checked="true"]');
    current?.scrollIntoView?.({ block: 'center' });
    current?.focus();
  }
  const action = tiles.conflict ? { actionLabel: 'Show me', onAction: show } : tiles.retryable ? { actionLabel: 'Try again', onAction: () => void tiles.retry() } : {};
  return <Notice className="sx-status" {...action}>{tiles.error}</Notice>;
}

function Settings({ id, competition, tiles }: { id: OverlayTileId; competition: Pick<CompetitionDetail, 'sections' | 'sessions'>; tiles: Tiles }) {
  const { options, setOptions } = tiles;
  const set = <K extends keyof LiveOptions>(key: K) => (value: LiveOptions[K]) => void setOptions({ [key]: value } as Partial<LiveOptions>);
  const races = useMemo(() => finishedRaceChoices(competition), [competition]);
  let body: ReactNode = null;
  if (id === 'toplist') body = <Choice label="Show" value={options.toplistRows} choices={[{ value: 3, label: 'Top 3' }, { value: 5, label: 'Top 5' }, { value: 8, label: 'All' }]} onPick={set('toplistRows')} />;
  if (id === 'heat') body = <Choice label="Show" value={options.heatShow} choices={[{ value: 'each', label: 'Each race' }, { value: 'total', label: 'Totals only' }]} onPick={set('heatShow')} />;
  if (id === 'next') body = <Choice label="Show" value={options.nextCount} choices={[{ value: 1, label: 'Next race' }, { value: 3, label: 'Next 3' }]} onPick={set('nextCount')} />;
  if (id === 'podium') {
    body = (
      <>
        {competition.sections.length > 0 && (
          <Choice label="Age group" value={options.podiumSectionId ?? competition.sections[0].id}
            choices={competition.sections.map((section) => ({ value: section.id, label: displaySectionName(section.displayName) }))} onPick={set('podiumSectionId')} />
        )}
        <Choice label="Reveal" value={options.podiumReveal} choices={[{ value: 'all', label: 'All at once' }, { value: 'one', label: 'One at a time' }]} onPick={set('podiumReveal')} />
        {options.podiumReveal === 'one' && tiles.active === 'podium' && (
          <div className="sx-opt">
            <span className="sx-opt-label">{options.podiumShown < 3 ? `Next: ${['3rd', '2nd', '1st'][options.podiumShown]}` : 'All three shown'}</span>
            <div><button type="button" className="rf-btn" onClick={() => void tiles.revealNext()}>{options.podiumShown < 3 ? 'Reveal next' : 'Start again'}</button></div>
          </div>
        )}
      </>
    );
  }
  if (id === 'result') {
    body = races.length === 0
      ? <p className="rf-note">No race has finished yet.</p>
      : <Choice label="Race" value={options.resultRaceId ?? races[0].value} choices={races} onPick={set('resultRaceId')} />;
  }
  if (id === 'sponsor') {
    body = (
      <>
        <Choice label="Size" value={options.sponsorSize} choices={[{ value: 'full', label: 'Full screen' }, { value: 'corner', label: 'Corner' }]} onPick={set('sponsorSize')} />
        {tiles.active === 'sponsor' && <div className="sx-opt"><div><button type="button" className="rf-btn" onClick={() => void tiles.nextSponsor()}>Next sponsor</button></div></div>}
      </>
    );
  }
  return (
    <div className="sx-settings" role="group" aria-label={`${OVERLAY_TILES.find((tile) => tile.id === id)?.label} settings`}>
      <strong>{OVERLAY_TILES.find((tile) => tile.id === id)?.label}</strong>
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
  const [open, setOpen] = useState<OverlayTileId | null>(null);
  const banner = bannerMessage(overlay);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? banner;
  const active = OVERLAY_TILES.find((tile) => tile.id === tiles.active);

  return (
    <fieldset className="sx-fieldset" disabled={tiles.busy || !canChange}>
      <div className="sx-tiles" role="radiogroup" aria-label="On screen">
        {OVERLAY_TILES.map((tile) => {
          const on = tiles.active === tile.id;
          const isOpen = open === tile.id;
          return (
            <div key={tile.id} className="sx-tile" data-on={on} data-open={isOpen}>
              <button type="button" role="radio" aria-checked={on} className="sx-tile-pick" onClick={() => void tiles.pick(tile.id)}>{tile.label}</button>
              {tile.settings && (
                <button type="button" className="sx-tile-chev" aria-label={`${tile.label} settings`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : tile.id)}>
                  {isOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {active && !active.drawn && <p className="rf-note" role="status">Viewers don’t see {active.label.toLowerCase()} yet.</p>}
      {open && <Settings id={open} competition={competition} tiles={tiles} />}
      <OverlayProblem tiles={tiles} />
      {!canChange && <p className="rf-note">You can’t change the overlay from this device.</p>}

      <RefineSection title="Stream banner" />
      <form className="sx-banner" onSubmit={(event) => { event.preventDefault(); void tiles.postBanner(banner ? null : text).then(() => setDraft(null)); }}>
        <label className="rf-fld sx-banner-field">Message across the top
          <input value={text} readOnly={Boolean(banner)} maxLength={140} placeholder="e.g. Lunch until 2pm" onChange={(event) => setDraft(event.target.value)} />
        </label>
        <button type="submit" className={`rf-btn ${banner ? '' : 'rf-btn-primary'}`} disabled={!banner && !text.trim()}>{banner ? 'Take down' : 'Show'}</button>
      </form>
    </fieldset>
  );
}
