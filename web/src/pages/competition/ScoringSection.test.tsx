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
import type { ToolLink } from './RaceToolsSheet';

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
  cards?: Record<number, 'yellow' | 'red' | null>;
  onSetCard?: (teamId: number, card: 'yellow' | 'red' | null) => void;
  teamFacts?: Record<number, string>;
  factsOn?: boolean;
  onToggleFacts?: () => void;
  toolLinks?: ToolLink[];
  onAddRace?: (name: string) => void;
  onRerunRace?: () => void;
  correctionReason?: string;
  onDeadHeat?: (teamIds: number[]) => void;
  onClearDeadHeat?: (teamId: number) => void;
  heatTools?: React.ReactNode;
}

function Harness({ allowAudit = false, activeIdx = 1, heatOverride = h, queued = [], onSelectRace = vi.fn(), onSubmit = () => {}, allowReasons, onSetHc, hcTeamIds, onUndo, initial = [], lanes = null, hatbands, cards, onSetCard, teamFacts, factsOn, onToggleFacts, toolLinks, onAddRace, onRerunRace, correctionReason = '', onDeadHeat, onClearDeadHeat, heatTools }: Extra) {
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
      cards={cards} onSetCard={onSetCard} teamFacts={teamFacts} factsOn={factsOn} onToggleFacts={onToggleFacts} toolLinks={toolLinks}
      onAddRace={onAddRace} onRerunRace={onRerunRace} heatTools={heatTools} onDeadHeat={onDeadHeat} onClearDeadHeat={onClearDeadHeat}
      correctionReason={correctionReason} onCorrectionReason={() => {}}
    />
  );
}

async function openLastRace(user: ReturnType<typeof userEvent.setup>) {
  const sheet = await openTools(user);
  await user.click(within(sheet).getByRole('button', { name: /Last race/ }));
  return screen.getByRole('dialog', { name: 'Last race' });
}

const allPlaced: PendingPlace[] = [{ teamId: 2, place: 1, eliminated: false }, { teamId: 3, place: 2, eliminated: false }, { teamId: 1, place: 3, eliminated: false }];
const rowNames = () => within(screen.getByRole('region', { name: /^Scoring/ })).getAllByRole('listitem').map((li) => li.textContent ?? '');

describe('the race stack', () => {
  it('renders only the active race with the top race switcher bar and no stacked race cards', () => {
    render(<Harness />);
    expect(screen.getByRole('region', { name: 'Scoring Race 2' })).toBeInTheDocument();
    expect(screen.getByText('Race 2 of 3 · Scoring')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^1\. Race 1/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Race 3, coming up' })).toBeNull();
  });

  it('lists the open race in lane order with a lane number on each card', () => {
    render(<Harness />);
    const rows = rowNames();
    // Race 2 moves everyone up one lane from the draw: Alpha (drawn 3) has lane 1.
    expect(rows[0]).toContain('Alpha');
    expect(rows[0]).toContain('L1');
    expect(rows[1]).toContain('Bravo');
    expect(rows[1]).toContain('L2');
    expect(rows[2]).toContain('Charlie');
    expect(rows[2]).toContain('L3');
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

  it('has no hint line, no 1st-gets line and no old tool buttons', () => {
    render(<Harness />);
    expect(screen.queryByText(/Hold or swipe down to eliminate/)).toBeNull();
    expect(screen.queryByText(/Not in yet/)).toBeNull();
    expect(screen.queryByText(/1st gets/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Score override' })).toBeNull();
    expect(screen.queryByText(/Heat total \d/)).toBeNull();
  });

  it('shows queued saves on the active race with a not-sent notice', () => {
    const queued: QueuedScore = { saveId: 'q', raceId: 2, competitionId: 1, sessionId: 1, label: 'x', teamNames: { 2: 'Bravo' }, places: [{ teamId: 2, place: 1, eliminated: false }], expected: [], queuedAt: '', state: 'waiting' };
    render(<Harness activeIdx={1} queued={[queued]} />);
    expect(screen.getByText('Race 2 of 3 · Scored')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Not sent yet: 1st Bravo');
    expect(screen.getByRole('button', { name: 'Edit this race' })).toBeInTheDocument();
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
  it('is not under the race, and opens from Last race in race tools with placings, who is out and the totals', async () => {
    const user = userEvent.setup();
    render(<Harness allowReasons />);
    expect(screen.queryByRole('region', { name: 'Announcer summary for Race 1' })).toBeNull();
    const dialog = await openLastRace(user);
    const card = within(dialog).getByRole('region', { name: 'Announcer summary for Race 1' });
    expect(card).toHaveTextContent('1st Bravo, 3 points');
    expect(card).toHaveTextContent('Alpha: Eliminated');
    expect(card).toHaveTextContent('1st Bravo: 3 points');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Last race' })).toBeNull();
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
    render(<Harness onSubmit={onSubmit} initial={allPlaced} />);
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    expect(screen.queryByText('Race 2 saved')).toBeNull();
    onSubmit.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    expect(screen.getByText('Race 2 saved')).toBeInTheDocument();
  });
});

describe('the elimination sheet', () => {
  it('asks why on SAVE SCORES, and saves the reasons with the placings', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness allowReasons onSubmit={onSubmit} initial={[{ teamId: 2, place: 1, eliminated: false }, { teamId: 3, place: 2, eliminated: false }, { teamId: 1, place: 0, eliminated: true }]} />);
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    const sheet = screen.getByRole('dialog', { name: 'Why were teams eliminated?' });
    const save = within(sheet).getByRole('button', { name: 'Save race' });
    expect(save).toBeDisabled();
    await user.click(within(sheet).getByRole('button', { name: 'Missed a flag or pot' }));
    await user.click(save);
    expect(onSubmit).toHaveBeenCalledWith([
      { teamId: 2, place: 1, eliminated: false },
      { teamId: 3, place: 2, eliminated: false },
      { teamId: 1, place: 0, eliminated: true, status: 1, refereeNote: 'Missed a flag or pot' },
    ]);
  });

  it('needs words for Other, sets the status for a did-not-start, and can be skipped or backed out of', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness allowReasons onSubmit={onSubmit} initial={[{ teamId: 1, place: 0, eliminated: true }, { teamId: 3, place: 0, eliminated: true }, { teamId: 2, place: 1, eliminated: false }]} />);
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
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
      { teamId: 2, place: 1, eliminated: false },
    ]);

    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog', { name: 'Hors concours' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    await user.click(screen.getByRole('button', { name: 'Save without reasons' }));
    expect(onSubmit).toHaveBeenLastCalledWith();
  });

  it('does not ask when nobody is out, when reasons are off, or when every reason is already there', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { unmount } = render(<Harness allowReasons onSubmit={onSubmit} initial={allPlaced} />);
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    expect(screen.queryByRole('dialog', { name: 'Hors concours' })).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    unmount();
    const { unmount: again } = render(<Harness onSubmit={onSubmit} initial={[{ teamId: 1, place: 0, eliminated: true }, { teamId: 2, place: 1, eliminated: false }, { teamId: 3, place: 2, eliminated: false }]} />);
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    expect(screen.queryByRole('dialog', { name: 'Hors concours' })).toBeNull();
    again();
    render(<Harness allowReasons onSubmit={onSubmit} initial={[{ teamId: 1, place: 0, eliminated: true, refereeNote: 'Wrong course' }, { teamId: 2, place: 1, eliminated: false }, { teamId: 3, place: 2, eliminated: false }]} />);
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    expect(screen.queryByRole('dialog', { name: 'Hors concours' })).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(3);
  });

  it('starts from the reason already saved', async () => {
    const user = userEvent.setup();
    render(<Harness allowReasons initial={[{ teamId: 1, place: 0, eliminated: true, refereeNote: 'Fell off' }, { teamId: 3, place: 0, eliminated: true }, { teamId: 2, place: 1, eliminated: false }]} />);
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    const groups = within(screen.getByRole('dialog')).getAllByRole('group');
    expect(within(groups[0]).getByRole('button', { name: 'Other' })).toHaveAttribute('aria-pressed', 'true');
  });
});

const openTools = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Race tools' }));
  return screen.getByRole('dialog', { name: 'Race tools' });
};
const openTeamMenu = async (user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement, team: string) => {
  await user.click(within(sheet).getByRole('button', { name: `More for ${team}` }));
  return within(sheet).getByRole('menu', { name: team });
};

describe('hors concours', () => {
  it('has no inline HC button on rows', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: /hors concours/i })).toBeNull();
  });

  it('marks a team hors concours from its menu in race tools', async () => {
    const user = userEvent.setup();
    const onSetHc = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSetHc={onSetHc} />);
    const sheet = await openTools(user);
    const menu = await openTeamMenu(user, sheet, 'Bravo');
    await user.click(within(menu).getByRole('menuitem', { name: 'Make HC' }));
    expect(onSetHc).toHaveBeenCalledWith(2, true);
    expect(within(sheet).queryByRole('menu')).toBeNull();
  });

  it('shows an HC tag and offers to remove it', async () => {
    const user = userEvent.setup();
    const onSetHc = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSetHc={onSetHc} hcTeamIds={new Set([2])} />);
    expect(within(screen.getByRole('region', { name: /^Scoring/ })).getAllByText('HC').length).toBeGreaterThan(0);
    const sheet = await openTools(user);
    const menu = await openTeamMenu(user, sheet, 'Bravo');
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove HC' }));
    expect(onSetHc).toHaveBeenCalledWith(2, false);
  });

  it('leaves HC and cards out of the menu when the scorer can not change them', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openTools(user);
    const menu = await openTeamMenu(user, sheet, 'Bravo');
    expect(within(menu).queryByRole('menuitem', { name: /HC/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /card/i })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Change points' })).toBeInTheDocument();
  });

  it('treats the team as HC in the summary straight away', async () => {
    const user = userEvent.setup();
    render(<Harness hcTeamIds={new Set([2])} />);
    const dialog = await openLastRace(user);
    const card = within(dialog).getByRole('region', { name: 'Announcer summary for Race 1' });
    expect(card).toHaveTextContent('Bravo (HC), 3 points');
    expect(card).toHaveTextContent('Bravo: HC, 3 points');
    expect(card).toHaveTextContent('1st Charlie: 2 points');
  });
});

describe('cards', () => {
  it('gives a yellow card, and a second yellow becomes a red card', async () => {
    const user = userEvent.setup();
    const onSetCard = vi.fn();
    const { rerender } = render(<Harness onSetCard={onSetCard} />);
    let sheet = await openTools(user);
    let menu = await openTeamMenu(user, sheet, 'Bravo');
    await user.click(within(menu).getByRole('menuitem', { name: 'Yellow card' }));
    expect(onSetCard).toHaveBeenLastCalledWith(2, 'yellow');

    rerender(<Harness onSetCard={onSetCard} cards={{ 2: 'yellow' }} />);
    expect(within(screen.getByRole('region', { name: /^Scoring/ })).getByRole('img', { name: 'Yellow card' })).toBeInTheDocument();
    sheet = screen.getByRole('dialog', { name: 'Race tools' });
    menu = await openTeamMenu(user, sheet, 'Bravo');
    await user.click(within(menu).getByRole('menuitem', { name: 'Second yellow (red card)' }));
    expect(onSetCard).toHaveBeenLastCalledWith(2, 'red');
  });

  it('gives and removes a red card, and reads the card from the lane', async () => {
    const user = userEvent.setup();
    const onSetCard = vi.fn();
    const withCard: Heat = { ...h, entries: entries.map((e) => (e.teamId === 3 ? { ...e, refereeCard: 'red' as const } : e)) };
    render(<Harness heatOverride={withCard} onSetCard={onSetCard} />);
    expect(within(screen.getByRole('region', { name: /^Scoring/ })).getByRole('img', { name: 'Red card' })).toBeInTheDocument();
    const sheet = await openTools(user);
    let menu = await openTeamMenu(user, sheet, 'Charlie');
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove red card' }));
    expect(onSetCard).toHaveBeenLastCalledWith(3, null);
    menu = await openTeamMenu(user, sheet, 'Alpha');
    await user.click(within(menu).getByRole('menuitem', { name: 'Red card' }));
    expect(onSetCard).toHaveBeenLastCalledWith(1, 'red');
  });

  it('lets a card the page has just changed win over the one on the lane', () => {
    const withCard: Heat = { ...h, entries: entries.map((e) => (e.teamId === 3 ? { ...e, refereeCard: 'red' as const } : e)) };
    render(<Harness heatOverride={withCard} cards={{ 3: null, 1: 'yellow' }} />);
    const region = within(screen.getByRole('region', { name: /^Scoring/ }));
    expect(region.queryByRole('img', { name: 'Red card' })).toBeNull();
    expect(region.getByRole('img', { name: 'Yellow card' })).toBeInTheDocument();
  });
});

describe('race tools', () => {
  it('lists the teams first, then the links, and closes from the header or the scrim', async () => {
    const user = userEvent.setup();
    const qr = vi.fn();
    render(<Harness toolLinks={[{ key: 'qr', label: 'QR access', sub: 'Let another scorer in', onSelect: qr }]} />);
    const sheet = await openTools(user);
    expect(within(sheet).getByText('Race tools')).toBeInTheDocument();
    const group = within(sheet).getByRole('group', { name: 'Teams in this race' });
    expect(within(group).getAllByRole('button', { name: /^More for/ })).toHaveLength(3);
    await user.click(within(sheet).getByRole('button', { name: /QR access/ }));
    expect(qr).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Race tools' })).toBeNull();

    await openTools(user);
    await user.click(screen.getByRole('button', { name: 'Close race tools' }));
    expect(screen.queryByRole('dialog', { name: 'Race tools' })).toBeNull();
    await openTools(user);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Race tools' })).toBeNull();
  });

  it('has the commentator facts switch only when the page offers it', async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();
    const { unmount } = render(<Harness />);
    let sheet = await openTools(user);
    expect(within(sheet).queryByRole('switch')).toBeNull();
    unmount();
    render(<Harness factsOn onToggleFacts={toggle} />);
    sheet = await openTools(user);
    const sw = within(sheet).getByRole('switch');
    expect(sw).toBeChecked();
    await user.click(sw);
    expect(toggle).toHaveBeenCalled();
  });

  it('changes a team’s points by hand, one at a time, and shows what was moved', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ teamId: 2, place: 1, eliminated: false }]} />);
    const sheet = await openTools(user);
    const menu = await openTeamMenu(user, sheet, 'Bravo');
    await user.click(within(menu).getByRole('menuitem', { name: 'Change points' }));
    await user.click(within(sheet).getByRole('button', { name: 'One more point for Bravo' }));
    expect(within(sheet).getByText('4')).toBeInTheDocument();
    expect(within(sheet).getByText('+1 by hand')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'One point fewer for Bravo' }));
    await user.click(within(sheet).getByRole('button', { name: 'One point fewer for Bravo' }));
    expect(within(sheet).getByText('2')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(within(sheet).queryByRole('button', { name: 'Done' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close race tools' }));
    expect(screen.getByRole('button', { name: /^Bravo, lane/ })).toHaveTextContent('2 pts by hand');
  });

  it('opens organiser tools for the race from its row', async () => {
    const user = userEvent.setup();
    const rerun = vi.fn();
    render(<Harness onRerunRace={rerun} />);
    const sheet = await openTools(user);
    await user.click(within(sheet).getByRole('button', { name: /Organiser tools/ }));
    const tools = screen.getByRole('dialog', { name: 'Organiser tools' });
    await user.click(within(tools).getByRole('button', { name: /Re-run stopped race/ }));
    expect(rerun).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close organiser tools' }));
    expect(screen.queryByRole('dialog', { name: 'Organiser tools' })).toBeNull();
  });

  it('shows the heat tools inside organiser tools', async () => {
    const user = userEvent.setup();
    render(<Harness heatTools={<p>Heat tools content</p>} />);
    expect(screen.queryByText('Heat tools content')).toBeNull();
    const sheet = await openTools(user);
    await user.click(within(sheet).getByRole('button', { name: /Organiser tools/ }));
    expect(within(screen.getByRole('dialog', { name: 'Organiser tools' })).getByText('Heat tools content')).toBeInTheDocument();
  });

  it('has no organiser tools row without any race controls', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openTools(user);
    expect(within(sheet).queryByRole('button', { name: /Organiser tools/ })).toBeNull();
  });
});

describe('saving', () => {
  it('keeps SAVE SCORES off until every team is placed, and counts them', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const save = screen.getByRole('button', { name: 'SAVE SCORES' });
    expect(save).toBeDisabled();
    expect(screen.getByText('of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Alpha, lane/ }));
    await user.click(screen.getByRole('button', { name: /^Bravo, lane/ }));
    expect(save).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Charlie, lane/ }), { key: 'Delete' });
    expect(save).toBeEnabled();
  });

  it('puts the tools button to the left of undo and clear', () => {
    render(<Harness />);
    const names = within(screen.getByRole('region', { name: /^Scoring/ })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    const at = (n: string) => names.indexOf(n);
    expect(at('Race tools')).toBeGreaterThan(-1);
    expect(at('Race tools')).toBeLessThan(at('Undo'));
    expect(at('Undo')).toBeLessThan(at('Clear'));
  });

  it('only needs the qualifying places in a qualifier', () => {
    const qual: Heat = { ...h, raceRoundStage: 1 };
    render(<Harness heatOverride={qual} initial={[{ teamId: 2, place: 1, eliminated: false }, { teamId: 3, place: 2, eliminated: false }, { teamId: 1, place: 3, eliminated: false }]} />);
    expect(screen.getByRole('button', { name: 'SAVE SCORES' })).toBeEnabled();
    expect(screen.getByText(/The first 3 home go through/)).toBeInTheDocument();
  });
});

describe('a saved race', () => {
  it('is read only until Edit this race, which says saving again replaces the points', async () => {
    const user = userEvent.setup();
    render(<Harness activeIdx={0} initial={[{ teamId: 2, place: 1, eliminated: false }]} />);
    expect(screen.getByText('Race 1 of 3 · Scored')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Bravo, lane/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'SAVE SCORES' })).toBeNull();
    // Race tools stay reachable on a saved race, for run-offs, overrides and the score history.
    expect(screen.getByRole('button', { name: 'Race tools' })).toBeInTheDocument();
    expect(screen.queryByText(/replaces this race/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit this race' }));
    expect(screen.getByText('Race 1 of 3 · Editing')).toBeInTheDocument();
    expect(screen.getByText('Saving again replaces this race’s points.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Bravo, lane/ })).toBeEnabled();
    expect(screen.getByLabelText('Reason for correction')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SAVE SCORES' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit this race' })).toBeNull();
  });

  it('goes back to read only once the edit is saved', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => true);
    render(<Harness activeIdx={0} onSubmit={onSubmit} initial={[{ teamId: 2, place: 1, eliminated: false }, { teamId: 3, place: 2, eliminated: false }, { teamId: 1, place: 0, eliminated: true, refereeNote: 'Wrong course' }]} />);
    await user.click(screen.getByRole('button', { name: 'Edit this race' }));
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    expect(onSubmit).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit this race' })).toBeInTheDocument();
  });
});

describe('commentator facts', () => {
  it('shows a line under the team name only when there are facts', () => {
    const { unmount } = render(<Harness />);
    expect(document.querySelector('.sc-fact')).toBeNull();
    unmount();
    render(<Harness teamFacts={{ 2: 'Leading', 3: '3 points behind 1st' }} />);
    expect(screen.getByRole('button', { name: /^Bravo, lane/ })).toHaveTextContent('Leading');
    expect(document.querySelectorAll('.sc-fact')).toHaveLength(2);
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
  const band = (name: RegExp) => screen.getByRole('button', { name }).querySelector('.sc-band') as HTMLElement;

  it('paints the lane card with a plain band in the hatband colour', () => {
    const { unmount } = render(<Harness hatbands={['Red', 'Blue', 'Green']} />);
    // Race 2 moves up one lane: Alpha has lane 1.
    expect(band(/^Alpha, lane/).style.background).toBe('rgb(200, 32, 47)');
    expect(band(/^Bravo, lane/).style.background).toBe('rgb(43, 95, 168)');
    expect((screen.getByRole('button', { name: /^Alpha, lane/ }).closest('li') as HTMLElement).style.background).toBe('');
    unmount();
    render(<Harness hatbands={null} />);
    expect(screen.queryByText(/hatband/)).toBeNull();
  });

  it('paints a custom hatband in its own colour without showing the code', () => {
    render(<Harness hatbands={['Lilac #B79CED', 'Blue', 'Green']} />);
    expect(band(/^Alpha, lane/).style.background).toBe('rgb(183, 156, 237)');
    expect(screen.getByRole('button', { name: /^Alpha, lane/ })).not.toHaveTextContent('#B79CED');
  });

  it('falls back to the bib colour when the event sets no hatbands', () => {
    render(<Harness />);
    expect(band(/^Alpha, lane/).style.background).not.toBe('');
  });

  it('toggles the score history and correction panel when the active race is completed', async () => {
    const user = userEvent.setup();
    render(<Harness activeIdx={0} allowAudit />);
    expect(screen.queryByRole('dialog', { name: 'Score history' })).toBeNull();
    // The tools button only shows while the race is being edited.
    await user.click(screen.getByRole('button', { name: 'Edit this race' }));
    const sheet = await openTools(user);
    await user.click(within(sheet).getByRole('button', { name: /Score history/ }));
    const dialog = screen.getByRole('dialog', { name: 'Score history' });
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Score history' })).toBeNull();
  });
});

describe('race switcher bar and press-and-hold', () => {
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

  it('eliminates a team on press-and-hold (600ms) and on Delete key, and a quick tap never starts the red fill', () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      const bravoBtn = screen.getByRole('button', { name: /^Bravo, lane/ });
      fireEvent.pointerDown(bravoBtn);
      expect(document.querySelector('.sc-hold')).not.toBeNull();
      act(() => { vi.advanceTimersByTime(599); });
      expect(screen.queryByLabelText('Eliminated')).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      expect(within(screen.getByRole('region', { name: /^Scoring/ })).getByLabelText('Eliminated')).toBeInTheDocument();

      const alphaBtn = screen.getByRole('button', { name: /^Alpha, lane/ });
      fireEvent.keyDown(alphaBtn, { key: 'Delete' });
      expect(within(screen.getByRole('region', { name: /^Scoring/ })).getAllByLabelText('Eliminated')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
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

  it('respects the Settings switch, which stores "false"', async () => {
    const user = userEvent.setup();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
    localStorage.setItem('mg.prefs.scorerHaptics', 'false');
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /^Bravo, lane/ }));
    fireEvent.keyDown(screen.getByRole('button', { name: /^Alpha, lane/ }), { key: 'Delete' });
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('the elimination buzz', () => {
  function withVibrate(impl: () => boolean = () => true) {
    const vibrate = vi.fn(impl);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
    return vibrate;
  }

  it('buzzes twice-short once when a hold puts a team out, and not for the tap that never happened', () => {
    const vibrate = withVibrate();
    vi.useFakeTimers();
    try {
      render(<Harness />);
      const bravo = screen.getByRole('button', { name: /^Bravo, lane/ });
      fireEvent.pointerDown(bravo);
      act(() => { vi.advanceTimersByTime(600); });
      fireEvent.click(bravo);
      expect(vibrate).toHaveBeenCalledTimes(1);
      expect(vibrate).toHaveBeenCalledWith([40, 60, 40]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('buzzes for the Delete key, but not when taking an elimination back', async () => {
    const vibrate = withVibrate();
    render(<Harness initial={[{ teamId: 2, place: 0, eliminated: true }]} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Bravo, lane/ }), { key: 'Delete' });
    expect(vibrate).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Alpha, lane/ }), { key: 'Delete' });
    expect(vibrate).toHaveBeenCalledWith([40, 60, 40]);
  });

  it('keeps scoring when the phone refuses to vibrate', () => {
    withVibrate(() => { throw new Error('blocked'); });
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Alpha, lane/ }), { key: 'Delete' });
    expect(within(screen.getByRole('region', { name: /^Scoring/ })).getByLabelText('Eliminated')).toBeInTheDocument();
  });
});

describe('the last lane', () => {
  const lastRows = () => document.querySelectorAll('.sc-row-last');

  it('picks out the one lane left to score, without placing it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(lastRows()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /^Bravo, lane/ }));
    await user.click(screen.getByRole('button', { name: /^Charlie, lane/ }));
    expect(lastRows()).toHaveLength(1);
    const alpha = screen.getByRole('button', { name: /^Alpha, lane \d, last lane to score$/ });
    expect(within(alpha).getByText('Last to score')).toBeInTheDocument();
    expect(within(alpha).queryByLabelText(/^Place/)).toBeNull();
    await user.click(alpha);
    expect(lastRows()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(lastRows()).toHaveLength(0);
  });

  it('never picks a team sitting out, and counts an elimination as scored', async () => {
    const user = userEvent.setup();
    render(<Harness lanes={2} />);
    const racing = within(screen.getByRole('region', { name: /^Scoring/ })).getAllByRole('button').filter((b) => !b.hasAttribute('disabled') && /, lane \d/.test(b.getAttribute('aria-label') ?? ''));
    fireEvent.keyDown(racing[0], { key: 'Delete' });
    expect(lastRows()).toHaveLength(1);
    expect(document.querySelector('.sc-row-last.sc-row-sit')).toBeNull();
    await user.click(racing[1]);
    expect(lastRows()).toHaveLength(0);
  });

  it('is not shown on a saved race', () => {
    render(<Harness activeIdx={0} initial={[{ teamId: 2, place: 1, eliminated: false }]} />);
    expect(lastRows()).toHaveLength(0);
  });
});

describe('checking the finishing order', () => {
  it('lists hatband, team and place once every lane is scored', async () => {
    const user = userEvent.setup();
    render(<Harness hatbands={['Red', 'Blue', 'Lilac #B79CED']} hcTeamIds={new Set([3])} />);
    expect(screen.queryByRole('region', { name: 'Finishing order' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Charlie, lane/ }));
    await user.click(screen.getByRole('button', { name: /^Bravo, lane/ }));
    fireEvent.keyDown(screen.getByRole('button', { name: /^Alpha, lane/ }), { key: 'Delete' });
    const review = screen.getByRole('region', { name: 'Finishing order' });
    const lines = within(review).getAllByRole('listitem').map((li) => li.textContent);
    // Race 2 moves everyone up a lane from the draw: Alpha 1, Bravo 2, Charlie 3.
    expect(lines).toEqual(['1st (HC) Charlie', '2nd Bravo', 'Eliminated Alpha']);
    expect(within(review).getByRole('heading', { name: 'Check the order' })).toBeInTheDocument();
    // The long form (hatband, team, place) is kept in each item's title.
    expect(within(review).getAllByRole('listitem').map((li) => li.getAttribute('title'))).toEqual(['Lilac · Charlie · 1st (HC)', 'Blue · Bravo · 2nd', 'Red · Alpha · Eliminated']);
    expect(screen.queryByText('Hold a lane for 0.6 s to eliminate')).toBeNull();
  });

  it('names the lane number when the event sets no hatbands', () => {
    render(<Harness initial={allPlaced} />);
    const items = within(screen.getByRole('region', { name: 'Finishing order' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('1st Bravo');
    expect(items[0].getAttribute('title')).toMatch(/^Lane \d · Bravo · 1st$/);
  });
});



it('shows an existing half-point score when a scorer link cannot read its private directive', async () => {
  const user = userEvent.setup();
  const scored = heat(1, { entries, races: [race(1, { isComplete: true, results: [result(2, 1, { points: 2.5 })] })] });
  render(<Harness heatOverride={scored} activeIdx={0} initial={[{ teamId: 2, place: 1, eliminated: false }]} />);
  await user.click(screen.getByRole('button', { name: 'Edit this race' }));
  const sheet = await openTools(user);
  expect(within(sheet).getByLabelText('2.5 points')).toBeInTheDocument();
});

it('does not offer organiser score history through a scoring-only surface', async () => {
  const user = userEvent.setup();
  render(<Harness activeIdx={0} />);
  expect(screen.queryByRole('dialog', { name: 'Score history' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Edit this race' }));
  const sheet = await openTools(user);
  expect(within(sheet).queryByRole('button', { name: /Score history/ })).toBeNull();
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

it('keeps a manual score, and raises nothing, when an HC change fails', async () => {
  const user = userEvent.setup();
  const onSetHc = vi.fn().mockRejectedValue(new Error('offline'));
  render(<Harness onSetHc={onSetHc} initial={overridePoints([{ teamId: 2, place: 1, eliminated: false }], 2, 7, 'Manual award')} />);
  const sheet = await openTools(user);
  const menu = await openTeamMenu(user, sheet, 'Bravo');
  await user.click(within(menu).getByRole('menuitem', { name: 'Make HC' }));
  await waitFor(() => expect(onSetHc).toHaveBeenCalledWith(2, true));
  await user.click(screen.getByRole('button', { name: 'Close race tools' }));
  expect(screen.getByRole('button', { name: /^Bravo, lane/ })).toHaveTextContent('7 pts by hand');
});

describe('eliminating and dead heats from race tools', () => {
  it('says how to eliminate from a lane card', () => {
    render(<Harness />);
    expect(screen.getByText('Hold a lane for 0.6 s to eliminate')).toBeInTheDocument();
  });

  it('eliminates a team from its menu, the same as holding its lane card', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sheet = await openTools(user);
    const menu = await openTeamMenu(user, sheet, 'Bravo');
    await user.click(within(menu).getByRole('menuitem', { name: 'Eliminate (E)' }));
    expect(within(sheet).queryByRole('menu')).toBeNull();
    expect(within(screen.getByRole('region', { name: /^Scoring/ })).getByLabelText('Eliminated')).toBeInTheDocument();
    const again = await openTeamMenu(user, sheet, 'Bravo');
    expect(within(again).getByRole('menuitem', { name: 'Undo elimination' })).toBeInTheDocument();
  });

  it('marks the ticked teams as a dead heat, and needs two', async () => {
    const user = userEvent.setup();
    const onDeadHeat = vi.fn();
    render(<Harness onDeadHeat={onDeadHeat} initial={allPlaced} />);
    const sheet = await openTools(user);
    await user.click(within(sheet).getByRole('switch', { name: /Dead heat/ }));
    const apply = within(sheet).getByRole('button', { name: 'Mark dead heat' });
    expect(apply).toBeDisabled();
    await user.click(within(sheet).getByRole('checkbox', { name: 'Tied: Bravo' }));
    expect(apply).toBeDisabled();
    await user.click(within(sheet).getByRole('checkbox', { name: 'Tied: Charlie' }));
    expect(within(sheet).getByText('2 ticked')).toBeInTheDocument();
    await user.click(apply);
    expect(onDeadHeat).toHaveBeenCalledWith([2, 3]);
    expect(within(sheet).queryByRole('checkbox')).toBeNull();
  });

  it('shows a dead-heat team as such and splits it from its menu', async () => {
    const user = userEvent.setup();
    const onClearDeadHeat = vi.fn();
    const tied: PendingPlace[] = [
      { teamId: 2, place: 1, eliminated: false, refereeNote: '[dead-heat]' },
      { teamId: 3, place: 1, eliminated: false, refereeNote: '[dead-heat]' },
      { teamId: 1, place: 3, eliminated: false },
    ];
    render(<Harness onClearDeadHeat={onClearDeadHeat} onDeadHeat={vi.fn()} initial={tied} />);
    const sheet = await openTools(user);
    expect(within(sheet).getAllByText('Dead heat').length).toBeGreaterThan(0);
    const menu = await openTeamMenu(user, sheet, 'Bravo');
    await user.click(within(menu).getByRole('menuitem', { name: 'Split dead heat' }));
    expect(onClearDeadHeat).toHaveBeenCalledWith(2);
  });
});
