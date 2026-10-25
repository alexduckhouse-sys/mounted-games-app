import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { heat, race, result } from '../../test/factories';
import type { Heat } from '../../types';
import { LaneRotationMode } from '../../lib/lanes';
import type { QueuedScore } from '../../offline/scoreOutbox';
import { overridePoints } from '../../lib/raceScoring';
import { ScoringSection, type PendingPlace } from './ScoringSection';

vi.mock('../../api', () => ({ api: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn() } }));
vi.mock('@microsoft/signalr', () => ({ HubConnectionBuilder: vi.fn() }));
vi.mock('../../components/RaceRulesButton', () => ({ RaceRulesButton: ({ raceName }: { raceName: string }) => <button type="button">Rules for {raceName}</button> }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, canManage: () => true }) }));
vi.mock('./context', () => ({ useCompetition: () => ({ competition: { id: 1, createdByUserId: 'u1' } }) }));

const entries: Heat['entries'] = [
  { id: 1, teamId: 1, teamName: 'Alpha', laneIndex: 3, bibColour: 'Red' },
  { id: 2, teamId: 2, teamName: 'Bravo', laneIndex: 1, bibColour: 'Royal blue' },
  { id: 3, teamId: 3, teamName: 'Charlie', laneIndex: 2, bibColour: null },
];
const done = race(1, { name: 'Race 1', isComplete: true, results: [result(2, 1, { points: 3 }), result(3, 2, { points: 2 }), result(1, null, { points: 0, eliminated: true, status: 1 })] });
const h: Heat = heat(1, { entries, races: [done, race(2, { name: 'Race 2' }), race(3, { name: 'Race 3' })] });

interface Extra {
  activeIdx?: number;
  allowAudit?: boolean;
  heatOverride?: Heat;
  queued?: QueuedScore[];
  onSelectRace?: (id: number) => void;
  onSubmit?: (places?: PendingPlace[]) => boolean | void;
  allowReasons?: boolean;
  onSetHc?: (teamId: number, hc: boolean) => Promise<void>;
  hcTeamIds?: ReadonlySet<number>;
  onUndo?: () => void;
  initial?: PendingPlace[];
  lanes?: number | null;
  hatbands?: string[] | null;
}

function Harness({ allowAudit = false, activeIdx = 1, heatOverride = h, queued = [], onSelectRace = vi.fn(), onSubmit = () => {}, allowReasons, onSetHc, hcTeamIds, onUndo, initial = [], lanes = null, hatbands }: Extra) {
  const rules = { lanesPerHeat: lanes, mode: LaneRotationMode.MoveUp };
  const [pending, setPending] = useState<PendingPlace[]>(initial);
  return (
    <ScoringSection
      heat={heatOverride} races={heatOverride.races} activeRace={heatOverride.races[activeIdx] ?? null} onSelectRace={onSelectRace} sessionBase={3}
      laneRules={rules} qualifiers={3} pending={pending} canScore allowAudit={allowAudit} queued={queued}
      onClickTeam={(teamId) => setPending((p) => [...p, { teamId, place: p.length + 1, eliminated: false }])}
      onToggleElim={(teamId) => setPending((p) => [...p.filter((x) => x.teamId !== teamId), { teamId, place: 0, eliminated: true }])}
      onOverridePoints={(id, points, reason) => setPending((current) => overridePoints(current, id, points, reason))}
      onReset={() => setPending([])} onSubmit={onSubmit} onUndo={onUndo} allowReasons={allowReasons} onSetHc={onSetHc} hcTeamIds={hcTeamIds} laneHatbands={hatbands}
      correctionReason="" onCorrectionReason={() => {}}
    />
  );
}

const rowNames = () => within(screen.getByRole('region', { name: /^Scoring/ })).getAllByRole('listitem').map((li) => li.textContent ?? '');

describe('the race stack', () => {
  it('renders only the active race with the top race switcher bar and no stacked race cards', () => {
    render(<Harness />);
    expect(screen.getByRole('region', { name: 'Scoring Race 2' })).toBeInTheDocument();
    expect(screen.getByText('Race 2 of 3 · Scoring')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^1\. Race 1/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Race 3, coming up' })).toBeNull();
  });

  it('lists the open race in lane order with the bib colour under each name', () => {
    render(<Harness />);
    const rows = rowNames();
    // Race 2 moves everyone up one lane from the draw: Alpha (drawn 3) has lane 1.
    expect(rows[0]).toContain('Alpha');
    expect(rows[0]).toContain('Red bib');
    expect(rows[1]).toContain('Bravo');
    expect(rows[1]).toContain('Royal blue bib');
    expect(rows[2]).toContain('Charlie');
    expect(rows[2]).toContain('No bib colour');
  });

  it('keeps the rows where they are after placings are entered', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /^Charlie, lane/ }));
    await user.click(screen.getByRole('button', { name: /^Alpha, lane/ }));
    expect(rowNames()[0]).toContain('Alpha');
    expect(rowNames()[1]).toContain('Bravo');
    expect(rowNames()[2]).toContain('Charlie');
    expect(within(screen.getByRole('region', { name: /^Scoring/ })).getByLabelText('Place 1')).toBeInTheDocument();
  });

  it('says the swipe hint once, not in every row, and has no tap-to-place text', () => {
    render(<Harness />);
    expect(screen.getAllByText(/Hold or swipe down to eliminate/)).toHaveLength(1);
    expect(screen.queryByText(/Swipe a team down to eliminate it/)).toBeNull();
    expect(screen.queryByText(/swipe ↓ elim/i)).toBeNull();
    expect(screen.queryByText(/Tap a team to assign/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^More/ })).toBeNull();
  });

  it('shows queued saves on the active race with a not-sent notice', () => {
    const queued: QueuedScore = { saveId: 'q', raceId: 2, competitionId: 1, sessionId: 1, label: 'x', teamNames: { 2: 'Bravo' }, places: [{ teamId: 2, place: 1, eliminated: false }], expected: [], queuedAt: '', state: 'waiting' };
    render(<Harness activeIdx={1} queued={[queued]} />);
    expect(screen.getByText('Race 2 of 3 · Scored')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Not sent yet: 1st Bravo');
  });

  it('greys a team with no lane and puts it last', () => {
    const short: Heat = heat(1, { entries, races: [race(1, { name: 'Race 1' })] });
    render(<Harness heatOverride={short} activeIdx={0} lanes={2} />);
    const rows = rowNames();
    // Drawn lanes 1 and 2 race; Alpha (drawn 3) sits out and comes last.
    expect(rows[0]).toContain('Bravo');
    expect(rows[1]).toContain('Charlie');
    expect(rows[2]).toContain('Alpha');
    expect(screen.getByRole('button', { name: /^Alpha, lane S/ })).toBeDisabled();
  });

  it('hides the heat table during active scoring and shows it when all races in the heat are complete', () => {
    const { rerender } = render(<Harness />);
    expect(screen.queryByRole('region', { name: 'Lane view' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Heat table' })).toBeNull();

    const completedHeat: Heat = heat(1, {
      entries,
      races: [
        done,
        race(2, { name: 'Race 2', isComplete: true, results: [result(2, 1, { points: 3 })] }),
        race(3, { name: 'Race 3', isComplete: true, results: [result(2, 1, { points: 3 })] }),
      ],
    });
    rerender(<Harness heatOverride={completedHeat} activeIdx={2} />);
    expect(screen.getByRole('region', { name: 'Heat table' })).toBeInTheDocument();
  });
});

describe('the announcer summary', () => {
  it('appears after the finished race with placings, who is out and the totals', () => {
    render(<Harness allowReasons />);
    const card = screen.getByRole('region', { name: 'Announcer summary for Race 1' });
    expect(card).toHaveTextContent('1st Bravo, 3 points');
    expect(card).toHaveTextContent('Alpha: Eliminated');
    expect(card).toHaveTextContent('1st Bravo: 3 points');
  });
});

describe('Undo', () => {
  it('is off until there is something to undo, then calls back', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    expect(screen.getByRole('button', { name: /Undo/ })).toBeDisabled();
    const undo = vi.fn();
    rerender(<Harness onUndo={undo} />);
    await user.click(screen.getByRole('button', { name: /Undo/ }));
    expect(undo).toHaveBeenCalled();
  });
});

describe('the saved tick', () => {
  it('pops up after a race is saved, but not when the save is refused', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(places?: PendingPlace[]) => boolean>(() => false);
    render(<Harness onSubmit={onSubmit} initial={[{ teamId: 2, place: 1, eliminated: false }]} />);
    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    expect(screen.queryByText('Race 2 saved')).toBeNull();
    onSubmit.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    expect(screen.getByText('Race 2 saved')).toBeInTheDocument();
  });
});

describe('the elimination sheet', () => {
  it('asks why on Race complete, and saves the reasons with the placings', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness allowReasons onSubmit={onSubmit} initial={[{ teamId: 2, place: 1, eliminated: false }, { teamId: 1, place: 0, eliminated: true }]} />);
    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    const sheet = screen.getByRole('dialog', { name: 'Why were teams eliminated?' });
    const save = within(sheet).getByRole('button', { name: 'Save race' });
    expect(save).toBeDisabled();
    await user.click(within(sheet).getByRole('button', { name: 'Missed a flag or pot' }));
    await user.click(save);
    expect(onSubmit).toHaveBeenCalledWith([
      { teamId: 2, place: 1, eliminated: false },
      { teamId: 1, place: 0, eliminated: true, status: 1, refereeNote: 'Missed a flag or pot' },
    ]);
  });

  it('needs words for Other, sets the status for a did-not-start, and can be skipped or backed out of', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness allowReasons onSubmit={onSubmit} initial={[{ teamId: 1, place: 0, eliminated: true }, { teamId: 3, place: 0, eliminated: true }]} />);
    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    const sheet = screen.getByRole('dialog');
    const groups = within(sheet).getAllByRole('group');
    await user.click(within(groups[0]).getByRole('button', { name: 'Other' }));
    expect(within(sheet).getByRole('button', { name: 'Save race' })).toBeDisabled();
    await user.type(within(sheet).getByLabelText('Other reason for Alpha'), 'Fell off');
    await user.click(within(groups[1]).getByRole('button', { name: 'Did not start' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save race' }));
    expect(onSubmit).toHaveBeenCalledWith([
      { teamId: 1, place: 0, eliminated: true, status: 1, refereeNote: 'Fell off' },
      { teamId: 3, place: 0, eliminated: true, status: 2, refereeNote: 'Did not start' },
    ]);

    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog', { name: 'Hors concours' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    await user.click(screen.getByRole('button', { name: 'Save without reasons' }));
    expect(onSubmit).toHaveBeenLastCalledWith();
  });

  it('does not ask when nobody is out, when reasons are off, or when every reason is already there', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { unmount } = render(<Harness allowReasons onSubmit={onSubmit} initial={[{ teamId: 2, place: 1, eliminated: false }]} />);
    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    expect(screen.queryByRole('dialog', { name: 'Hors concours' })).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    unmount();
    const { unmount: again } = render(<Harness onSubmit={onSubmit} initial={[{ teamId: 1, place: 0, eliminated: true }]} />);
    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    expect(screen.queryByRole('dialog', { name: 'Hors concours' })).toBeNull();
    again();
    render(<Harness allowReasons onSubmit={onSubmit} initial={[{ teamId: 1, place: 0, eliminated: true, refereeNote: 'Wrong course' }]} />);
    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    expect(screen.queryByRole('dialog', { name: 'Hors concours' })).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(3);
  });

  it('starts from the reason already saved', async () => {
    const user = userEvent.setup();
    render(<Harness allowReasons initial={[{ teamId: 1, place: 0, eliminated: true, refereeNote: 'Fell off' }, { teamId: 3, place: 0, eliminated: true }]} />);
    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    const groups = within(screen.getByRole('dialog')).getAllByRole('group');
    expect(within(groups[0]).getByRole('button', { name: 'Other' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('hors concours', () => {
  it('has no inline HC button on rows', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: /hors concours/i })).toBeNull();
  });

  it('marks a team hors concours via the Score override sheet and asks for confirmation', async () => {
    const user = userEvent.setup();
    const onSetHc = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSetHc={onSetHc} />);
    await user.click(screen.getByRole('button', { name: 'Score override' }));
    const sheet = screen.getByRole('dialog', { name: 'Score override' });
    await user.click(within(sheet).getByRole('button', { name: /Bravo/ }));
    await user.click(within(sheet).getByRole('radio', { name: /Hors concours/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Save override' }));

    const dialog = screen.getByRole('dialog', { name: 'Hors concours' });
    expect(dialog).toHaveTextContent('Competes but doesn’t score; removed from standings and finals seeding.');
    expect(onSetHc).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Make HC' }));
    expect(onSetHc).toHaveBeenCalledWith(2, true);
    expect(screen.queryByRole('dialog', { name: 'Hors concours' })).toBeNull();
  });

  it('can be cancelled, shows an HC tag, and is reversible via the Score override sheet', async () => {
    const user = userEvent.setup();
    const onSetHc = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSetHc={onSetHc} hcTeamIds={new Set([2])} />);
    expect(within(screen.getByRole('region', { name: /^Scoring/ })).getAllByText('HC').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Score override' }));
    const sheet = screen.getByRole('dialog', { name: 'Score override' });
    await user.click(within(sheet).getByRole('button', { name: /Bravo/ }));
    await user.click(within(sheet).getByRole('radio', { name: /Automatic/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSetHc).not.toHaveBeenCalled();

    await user.click(within(sheet).getByRole('button', { name: 'Back to teams' }));
    const sheet2 = screen.getByRole('dialog', { name: 'Score override' });
    await user.click(within(sheet2).getByRole('button', { name: /Bravo/ }));
    await user.click(within(sheet2).getByRole('radio', { name: /Automatic/ }));
    await user.click(within(sheet2).getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Bring back' }));
    expect(onSetHc).toHaveBeenCalledWith(2, false);
  });

  it('treats the team as HC in the summary straight away', () => {
    render(<Harness hcTeamIds={new Set([2])} />);
    const card = screen.getByRole('region', { name: 'Announcer summary for Race 1' });
    expect(card).toHaveTextContent('Bravo (HC), 3 points');
    expect(card).toHaveTextContent('Bravo: HC, 3 points');
    expect(card).toHaveTextContent('1st Charlie: 2 points');
  });
});

describe('eliminating without a swipe', () => {
  it('has no inline Out button and eliminates on hold or Delete key', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Eliminate Bravo' })).toBeNull();
    const bravoBtn = screen.getByRole('button', { name: /^Bravo, lane/ });
    fireEvent.keyDown(bravoBtn, { key: 'Delete' });
    expect(within(screen.getByRole('region', { name: /^Scoring/ })).getByLabelText('Eliminated')).toBeInTheDocument();
  });
});

describe('team colours and hatbands', () => {
  it('keeps row background clean unless a hatband is set, while showing the bib colour swatch and left bar', () => {
    render(<Harness />);
    const alpha = screen.getByRole('button', { name: /^Alpha, lane/ }).closest('li') as HTMLElement;
    expect(alpha.style.background).toBe('');
    expect(alpha).toHaveTextContent('Red bib');
    const charlie = screen.getByRole('button', { name: /^Charlie, lane/ }).closest('li') as HTMLElement;
    expect(charlie.style.background).toBe('');
  });

  it('shows the hatband colour for each lane in the rows and tints the row when hatbands are set', () => {
    const { unmount } = render(<Harness hatbands={['Red', 'Blue', 'Green']} />);
    // Race 2 moves up one lane: Alpha has lane 1.
    const alphaBtn = screen.getByRole('button', { name: /^Alpha, lane/ });
    expect(within(alphaBtn).getByText('Red hatband')).toBeInTheDocument();
    const alphaRow = alphaBtn.closest('li') as HTMLElement;
    expect(alphaRow.style.boxShadow).toContain('inset');
    unmount();
    render(<Harness hatbands={null} />);
    expect(screen.queryByText(/hatband/)).toBeNull();
  });

  it('toggles the score history and correction panel when the active race is completed', async () => {
    const user = userEvent.setup();
    render(<Harness activeIdx={0} allowAudit />);
    const toggle = screen.getByRole('button', { name: 'Score history & correction' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('race switcher bar, press-and-hold, and score override sheet', () => {
  it('switches races via Previous race and Next race buttons and disables them at the ends', async () => {
    const user = userEvent.setup();
    const onSelectRace = vi.fn();
    const { rerender } = render(<Harness activeIdx={0} onSelectRace={onSelectRace} />);
    expect(screen.getByText('Race 1 of 3 · Scored')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous race' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next race' }));
    expect(onSelectRace).toHaveBeenCalledWith(2);

    rerender(<Harness activeIdx={2} onSelectRace={onSelectRace} />);
    expect(screen.getByText('Race 3 of 3 · Scoring')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next race' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous race' }));
    expect(onSelectRace).toHaveBeenCalledWith(2);
  });

  it('eliminates a team on press-and-hold (650ms) and on Delete key', () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      const bravoBtn = screen.getByRole('button', { name: /^Bravo, lane/ });
      fireEvent.pointerDown(bravoBtn);
      act(() => { vi.advanceTimersByTime(650); });
      expect(within(screen.getByRole('region', { name: /^Scoring/ })).getByLabelText('Eliminated')).toBeInTheDocument();

      const alphaBtn = screen.getByRole('button', { name: /^Alpha, lane/ });
      fireEvent.keyDown(alphaBtn, { key: 'Delete' });
      expect(within(screen.getByRole('region', { name: /^Scoring/ })).getAllByLabelText('Eliminated')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the score override sheet, sets manual points on a team, and removes the override when set back to Automatic', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Score override' }));
    const sheet = screen.getByRole('dialog', { name: 'Score override' });
    expect(within(sheet).getByText('Race 2 · pick a team')).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: /Bravo/ }));
    await user.click(within(sheet).getByRole('radio', { name: /Set points/ }));
    for (let i = 0; i < 5; i++) await user.click(within(sheet).getByRole('button', { name: 'Half a point more' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save override' }));

    const bravoRow = screen.getByRole('button', { name: /^Bravo, lane/ }).closest('li') as HTMLElement;
    expect(bravoRow).toHaveTextContent('Manual');
    expect(bravoRow).toHaveTextContent('2.5 pts · manual');
    // Bravo had 3 points from Race 1 + 2.5 manual points in Race 2 = Heat total 5.5.
    expect(bravoRow).toHaveTextContent('Heat total 5.5');

    await user.click(screen.getByRole('button', { name: 'Score override' }));
    const sheetAgain = screen.getByRole('dialog', { name: 'Score override' });
    await user.click(within(sheetAgain).getByRole('button', { name: /Bravo/ }));
    await user.click(within(sheetAgain).getByRole('button', { name: /Split dead heat/ }));
    await user.click(within(sheetAgain).getByRole('button', { name: 'Save override' }));
    await user.click(within(sheetAgain).getByRole('button', { name: 'Close' }));
    expect(bravoRow).toHaveTextContent('2.5 pts · manual');

    await user.click(screen.getByRole('button', { name: 'Score override' }));
    const sheetClear = screen.getByRole('dialog', { name: 'Score override' });
    await user.click(within(sheetClear).getByRole('button', { name: /Bravo/ }));
    await user.click(within(sheetClear).getByRole('radio', { name: /Automatic/ }));
    await user.click(within(sheetClear).getByRole('button', { name: 'Remove override' }));
    await user.click(within(sheetClear).getByRole('button', { name: 'Close' }));
    expect(bravoRow).not.toHaveTextContent('Manual');
  });

  it('triggers light haptic feedback on tap unless disabled in preferences', async () => {
    const user = userEvent.setup();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
    localStorage.removeItem('mg.prefs.scorerHaptics');
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /^Bravo, lane/ }));
    expect(vibrate).toHaveBeenCalledWith(15);

    vibrate.mockClear();
    localStorage.setItem('mg.prefs.scorerHaptics', '0');
    await user.click(screen.getByRole('button', { name: /^Alpha, lane/ }));
    expect(vibrate).not.toHaveBeenCalled();
    localStorage.removeItem('mg.prefs.scorerHaptics');
  });
});



it('shows an existing half-point score when a scorer link cannot read its private directive', () => {
  const scored = heat(1, { entries, races: [race(1, { isComplete: true, results: [result(2, 1, { points: 2.5 })] })] });
  render(<Harness heatOverride={scored} activeIdx={0} initial={[{ teamId: 2, place: 1, eliminated: false }]} />);
  const row = screen.getByRole('button', { name: /^Bravo, lane/ }).closest('li')!;
  expect(row).toHaveTextContent('+2.5 pts');
});


it('does not offer organiser score history through a scoring-only surface', () => {
  render(<Harness activeIdx={0} />);
  expect(screen.queryByRole('button', { name: 'Score history & correction' })).toBeNull();
});

it('cancels a pending hold when the active race changes', () => {
  vi.useFakeTimers();
  try {
    const view = render(<Harness activeIdx={1} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Bravo, lane/ }));
    act(() => vi.advanceTimersByTime(300));
    view.rerender(<Harness activeIdx={2} />);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByLabelText('Eliminated')).toBeNull();
    view.unmount();
  } finally { vi.useRealTimers(); }
});

it('keeps a manual score when an HC change is cancelled or fails', async () => {
  const user = userEvent.setup();
  const onSetHc = vi.fn().mockRejectedValue(new Error('offline'));
  render(<Harness onSetHc={onSetHc} initial={overridePoints([{ teamId: 2, place: 1, eliminated: false }], 2, 7, 'Manual award')} />);
  await user.click(screen.getByRole('button', { name: 'Score override' }));
  const sheet = screen.getByRole('dialog', { name: 'Score override' });
  await user.click(within(sheet).getByRole('button', { name: /Bravo/ }));
  await user.click(within(sheet).getByRole('radio', { name: /Hors concours/ }));
  await user.click(within(sheet).getByRole('button', { name: 'Save override' }));
  await user.click(within(screen.getByRole('dialog', { name: 'Hors concours' })).getByRole('button', { name: 'Cancel' }));
  expect(onSetHc).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /^Bravo, lane/ })).toHaveTextContent('7 pts · manual');
  await user.click(within(sheet).getByRole('button', { name: 'Save override' }));
  await user.click(within(screen.getByRole('dialog', { name: 'Hors concours' })).getByRole('button', { name: 'Make HC' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save'));
  expect(screen.getByRole('button', { name: /^Bravo, lane/ })).toHaveTextContent('7 pts · manual');
});
