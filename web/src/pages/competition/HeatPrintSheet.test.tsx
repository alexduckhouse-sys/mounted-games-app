import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { heat, race, result } from '../../test/factories';
import { LaneRotationMode } from '../../lib/lanes';
import { TieBreakRule, type Heat } from '../../types';
import { HeatPrintSheet } from './HeatPrintSheet';
import { ScoringSection } from './ScoringSection';

vi.mock('../../api', () => ({ api: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn() } }));
vi.mock('../../components/RaceRulesButton', () => ({ RaceRulesButton: () => null }));

const entries: Heat['entries']= [
  { id: 1, teamId: 1, teamName: 'Alpha', laneIndex: 3, bibColour: 'Red' },
  { id: 2, teamId: 2, teamName: 'Bravo', laneIndex: 1, bibColour: 'Royal blue' },
  { id: 3, teamId: 3, teamName: 'Charlie', laneIndex: 2, bibColour: null },
];
const done = race(1, { name: 'Race 1', isComplete: true, results: [result(2, 1, { points: 3 }), result(3, 2, { points: 2 }), result(1, null, { points: 0, eliminated: true, status: 1 })] });
const h: Heat = heat(1, { label: 'Heat 1', entries, races: [done, race(2, { name: 'Race 2' })] });
const rules = { lanesPerHeat: null, mode: LaneRotationMode.MoveUp };

describe('HeatPrintSheet', () => {
  it('lists lanes, bib colours, each race’s result, totals and position', () => {
    render(<HeatPrintSheet heat={h} races={h.races} rules={rules} hcTeamIds={new Set([3])} tieRule={TieBreakRule.Countback} hatbands={['Red', 'Blue', 'Green']} />);
    const sheet = screen.getByLabelText('Printable heat table');
    expect(within(sheet).getByRole('heading', { name: 'Heat 1' })).toBeInTheDocument();
    const bravo = within(sheet).getByRole('row', { name: /Bravo/ });
    expect(bravo).toHaveTextContent('Royal blue bib');
    expect(bravo).toHaveTextContent('Lane 1: 1st (3) · Red hatband');
    expect(bravo).toHaveTextContent('Lane 2');
    expect(within(sheet).getByRole('row', { name: /Alpha/ })).toHaveTextContent('Lane 3: E');
    expect(within(sheet).getByRole('row', { name: /Charlie/ })).toHaveTextContent('(HC)');
    expect(within(sheet).getByRole('row', { name: /Charlie/ })).toHaveTextContent('HC');
  });

  it('has no hatbands when none are set and copes with a heat that has no label or results', () => {
    const bare: Heat = heat(2, { entries, races: [race(5, { name: 'First' })] });
    render(<HeatPrintSheet heat={bare} races={bare.races} rules={rules} hcTeamIds={new Set()} tieRule={TieBreakRule.Countback} />);
    expect(screen.getByRole('heading', { name: 'Heat' })).toBeInTheDocument();
    expect(screen.queryByText(/hatband/)).toBeNull();
  });
});

describe('the print button', () => {
  it('opens the print dialog', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <ScoringSection
        heat={h} races={h.races} activeRace={h.races[1]} onSelectRace={vi.fn()} sessionBase={3} laneRules={rules} qualifiers={3}
        pending={[]} canScore queued={[]} onClickTeam={vi.fn()} onToggleElim={vi.fn()} onReset={vi.fn()} onSubmit={vi.fn()}
        correctionReason="" onCorrectionReason={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Print heat table' }));
    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });
});
