import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { heat, race, result } from '../../test/factories';
import type { Heat } from '../../types';
import { LaneRotationMode } from '../../lib/lanes';
import { tapTeam, toggleEliminated } from '../../lib/raceScoring';
import { ScoringSection, type PendingPlace } from './ScoringSection';

vi.mock('../../api', () => ({ api: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn() } }));
vi.mock('@microsoft/signalr', () => ({ HubConnectionBuilder: vi.fn() }));
vi.mock('../../components/RaceRulesButton', () => ({ RaceRulesButton: ({ raceName }: { raceName: string }) => <button type="button">Rules for {raceName}</button> }));

// Race 2 moves everyone up a lane from the draw: Alpha has lane 1, Bravo lane 2, Charlie lane 3.
const entries: Heat['entries'] = [
  { id: 1, teamId: 1, teamName: 'Alpha', laneIndex: 3, bibColour: 'Red' },
  { id: 2, teamId: 2, teamName: 'Bravo', laneIndex: 1, bibColour: 'Blue' },
  { id: 3, teamId: 3, teamName: 'Charlie', laneIndex: 2, bibColour: null },
];
const done = race(1, { name: 'Race 1', isComplete: true, results: [result(2, 1, { points: 3 }), result(3, 2, { points: 2 }), result(1, 3, { points: 1 })] });
const h: Heat = heat(1, { entries, races: [done, race(2, { name: 'Race 2' }), race(3, { name: 'Race 3' })] });

interface Props {
  activeIdx?: number;
  initial?: PendingPlace[];
  onSubmit?: () => boolean | void;
  onSelectRace?: (id: number) => void;
  onUndo?: () => void;
  canScore?: boolean;
}

function Harness({ activeIdx = 1, initial = [], onSubmit = vi.fn(), onSelectRace = vi.fn(), onUndo, canScore = true }: Props) {
  const [pending, setPending] = useState<PendingPlace[]>(initial);
  return (
    <>
      <input aria-label="Somewhere else" />
      <ScoringSection
        heat={h} races={h.races} activeRace={h.races[activeIdx]} onSelectRace={onSelectRace} sessionBase={3}
        laneRules={{ lanesPerHeat: null, mode: LaneRotationMode.MoveUp }} qualifiers={3} pending={pending} canScore={canScore} queued={[]}
        onClickTeam={(teamId) => setPending((p) => tapTeam(p, teamId))}
        onToggleElim={(teamId) => setPending((p) => toggleEliminated(p, teamId))}
        onReset={() => setPending([])} onSubmit={onSubmit} onUndo={onUndo}
        correctionReason="" onCorrectionReason={() => {}}
      />
    </>
  );
}

const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
const card = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, lane`) });
const scoring = () => within(screen.getByRole('region', { name: /^Scoring/ }));

beforeEach(() => {
  sessionStorage.clear();
  (document.activeElement as HTMLElement | null)?.blur();
});

describe('scoring with a keypad', () => {
  it('places lanes by number, shows the keypad chip and says what happened', () => {
    render(<Harness />);
    expect(screen.queryByText('Keypad connected')).toBeNull();
    press('2');
    expect(within(card('Bravo')).getByLabelText('Place 1')).toBeInTheDocument();
    expect(screen.getByText('Keypad connected')).toBeInTheDocument();
    expect(screen.getByText('Bravo, lane 2, 1st')).toBeInTheDocument();
    press('3');
    expect(within(card('Charlie')).getByLabelText('Place 2')).toBeInTheDocument();
    // Pressing a placed lane again takes its place away, the same as tapping it.
    press('3');
    expect(within(card('Charlie')).queryByLabelText('Place 2')).toBeNull();
    expect(screen.getByText('Charlie, lane 3, no place')).toBeInTheDocument();
  });

  it('ignores lanes that aren\'t in the race and held-down keys', () => {
    render(<Harness />);
    press('7');
    press('1', { repeat: true });
    press('1', { ctrlKey: true });
    expect(scoring().queryByLabelText(/^Place/)).toBeNull();
    expect(screen.queryByText('Keypad connected')).toBeNull();
  });

  it('eliminates a lane after . or -', () => {
    render(<Harness />);
    press('.');
    press('1');
    expect(within(card('Alpha')).getByLabelText('Eliminated')).toBeInTheDocument();
    expect(screen.getByText('Alpha, lane 1, out')).toBeInTheDocument();
    press('-');
    press('1');
    expect(within(card('Alpha')).queryByLabelText('Eliminated')).toBeNull();
  });

  it('undoes with Backspace, z, left arrow and Page Up', () => {
    const onUndo = vi.fn();
    render(<Harness onUndo={onUndo} />);
    for (const key of ['Backspace', 'z', 'ArrowLeft', 'PageUp']) press(key);
    expect(onUndo).toHaveBeenCalledTimes(4);
  });

  it('leaves undo keys alone when there is nothing to undo', () => {
    render(<Harness />);
    expect(press('z')).toBe(true);
  });

  it('saves on Enter only once every lane is done', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    press('1');
    press('Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    press('2');
    press('3');
    press('Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('saves with the right arrow or a pedal, and moves on once the race is saved', () => {
    const onSubmit = vi.fn();
    const onSelectRace = vi.fn();
    const { unmount } = render(<Harness onSubmit={onSubmit} onSelectRace={onSelectRace} />);
    press('PageDown');
    expect(onSubmit).not.toHaveBeenCalled();
    press('1'); press('2'); press('3');
    press('ArrowRight');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSelectRace).not.toHaveBeenCalled();
    unmount();

    render(<Harness activeIdx={0} onSubmit={onSubmit} onSelectRace={onSelectRace} />);
    // A saved race is read only: lane keys do nothing until Edit this race.
    press('1');
    expect(within(card('Alpha')).queryByLabelText('Place 1')).toBeNull();
    press('PageDown');
    expect(onSelectRace).toHaveBeenCalledWith(2);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does nothing on the last race once it is saved, or for someone who can\'t score', () => {
    const onSelectRace = vi.fn();
    const last = race(3, { name: 'Race 3', isComplete: true, results: done.results });
    const finished: Heat = { ...h, races: [done, last] };
    const { unmount } = render(
      <ScoringSection
        heat={finished} races={finished.races} activeRace={last} onSelectRace={onSelectRace} sessionBase={3}
        laneRules={{ lanesPerHeat: null, mode: LaneRotationMode.MoveUp }} qualifiers={3} pending={[]} canScore queued={[]}
        onClickTeam={vi.fn()} onToggleElim={vi.fn()} onReset={vi.fn()} onSubmit={vi.fn()} correctionReason="" onCorrectionReason={() => {}}
      />,
    );
    press('ArrowRight');
    expect(onSelectRace).not.toHaveBeenCalled();
    unmount();
    render(<Harness canScore={false} />);
    press('1');
    expect(scoring().queryByLabelText('Place 1')).toBeNull();
  });

  it('ignores keys typed into a field or while race tools are open', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByLabelText('Somewhere else').focus();
    press('1');
    expect(scoring().queryByLabelText('Place 1')).toBeNull();
    (document.activeElement as HTMLElement).blur();

    await user.click(screen.getByRole('button', { name: 'Race tools' }));
    const tools = screen.getByRole('dialog', { name: 'Race tools' });
    expect(within(tools).getByRole('heading', { name: 'Using a keypad' })).toBeInTheDocument();
    expect(within(tools).getByText('Eliminate that lane')).toBeInTheDocument();
    act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    press('1');
    await user.click(within(tools).getByRole('button', { name: 'Close' }));
    expect(scoring().queryByLabelText('Place 1')).toBeNull();
    press('1');
    expect(within(card('Alpha')).getByLabelText('Place 1')).toBeInTheDocument();
  });

  it('lets a focused lane card keep Backspace for eliminating it, and saves on Enter there', () => {
    const onUndo = vi.fn();
    const onSubmit = vi.fn();
    render(<Harness onUndo={onUndo} onSubmit={onSubmit} initial={[{ teamId: 2, place: 1, eliminated: false }, { teamId: 3, place: 2, eliminated: false }]} />);
    card('Alpha').focus();
    press('Backspace');
    expect(within(card('Alpha')).getByLabelText('Eliminated')).toBeInTheDocument();
    expect(onUndo).not.toHaveBeenCalled();
    card('Alpha').focus();
    const notCancelled = press('Enter');
    expect(notCancelled).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
