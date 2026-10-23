import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { TieBreakRule, type CompetitionSection } from '../../types';
import { TieSettlement, type BoundaryTie, type FinalsBoundary } from '../../lib/tieBreak';
import { FinalsTiePanel } from './FinalsTiePanel';

vi.mock('../../api', () => ({ api: { put: vi.fn(), delete: vi.fn() } }));

const put = vi.mocked(api.put);
const del = vi.mocked(api.delete);

const section: CompetitionSection = { id: 5, competitionId: 12, format: 2, ageGroup: 'U12', displayName: 'Under 12', runoffRaceName: '2 Flag', finalistCount: 6 };

const tie = (patch: Partial<BoundaryTie> = {}): BoundaryTie => ({
  cutoff: 6, totalAtCutoff: 20, rule: TieBreakRule.RunOff, settledBy: TieSettlement.Open, settled: false,
  teams: [
    { id: 1, name: 'North A', total: 20, wins: 1, position: 6, goesThrough: true },
    { id: 2, name: 'South B', total: 20, wins: 2, position: 7, goesThrough: false },
  ],
  ...patch,
});
const boundary = (t: BoundaryTie): FinalsBoundary => ({ tied: true, boundaries: [t], unsettled: !t.settled, runoffRaceName: '2 Flag' });

function mount(props: Partial<Parameters<typeof FinalsTiePanel>[0]> = {}) {
  const onChanged = vi.fn();
  const onRuleChange = vi.fn();
  render(<FinalsTiePanel competitionId={12} section={section} rule={TieBreakRule.RunOff} onRuleChange={onRuleChange}
    boundary={boundary(tie())} onChanged={onChanged} {...props} />);
  return { onChanged, onRuleChange };
}

beforeEach(() => { put.mockReset(); del.mockReset(); });

describe('FinalsTiePanel', () => {
  it('saves the run-off result as the order for the tie', async () => {
    put.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    const { onChanged } = mount();

    const card = screen.getByRole('region', { name: 'Tie at the cut after 6th' });
    expect(card).toHaveTextContent('Run the 2 Flag between these teams');
    await user.click(within(card).getByRole('button', { name: 'Move South B up' }));
    await user.click(within(card).getByRole('button', { name: 'Save this order' }));

    expect(put).toHaveBeenCalledWith('/competitions/12/finals/tie-order', { teamIds: [2, 1] });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('changes the rule without losing the run-off race or finalist count', async () => {
    put.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    const { onChanged, onRuleChange } = mount();

    await user.selectOptions(screen.getByLabelText(/Teams level on points/), String(TieBreakRule.LastRace));

    expect(put).toHaveBeenCalledWith('/competitions/12/sections/5', { runoffRaceName: '2 Flag', finalistCount: 6, tieBreakRule: TieBreakRule.LastRace });
    await waitFor(() => expect(onRuleChange).toHaveBeenCalledWith(5, TieBreakRule.LastRace));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows why a save or a rule change failed', async () => {
    put.mockRejectedValueOnce({ response: { data: { message: 'Order every team on 20 points in this age group together.' } } });
    put.mockRejectedValueOnce({ response: { data: 'Nope' } });
    const user = userEvent.setup();
    const { onRuleChange } = mount();

    await user.click(screen.getByRole('button', { name: 'Save this order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Order every team on 20 points');
    await user.selectOptions(screen.getByLabelText(/Teams level on points/), String(TieBreakRule.Manual));
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain('Nope'));
    expect(onRuleChange).not.toHaveBeenCalled();
  });

  it('lets a rule-settled tie be overruled, and an organiser order be cleared', async () => {
    del.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    mount({ rule: TieBreakRule.Countback, boundary: boundary(tie({ rule: TieBreakRule.Countback, settledBy: TieSettlement.Rule, settled: true })) });

    expect(screen.queryByRole('button', { name: 'Save this order' })).not.toBeInTheDocument();
    expect(screen.getByText(/Settled on most 1st places: North A goes through/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change the order' }));
    expect(screen.getByRole('button', { name: 'Save this order' })).toBeInTheDocument();
  });

  it('clears the organiser order', async () => {
    del.mockRejectedValueOnce(new Error('offline'));
    del.mockResolvedValueOnce({ data: null });
    const user = userEvent.setup();
    const { onChanged } = mount({ boundary: boundary(tie({ settledBy: TieSettlement.Organiser, settled: true })) });

    await user.click(screen.getByRole('button', { name: 'Clear my order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t clear the order.');
    await user.click(screen.getByRole('button', { name: 'Clear my order' }));

    expect(del).toHaveBeenLastCalledWith('/competitions/12/finals/tie-order', expect.objectContaining({ params: { teamIds: [1, 2] } }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('shows ties across age groups without ordering, and nothing when there is no tie', () => {
    const { unmount } = render(<FinalsTiePanel competitionId={12} section={null} rule={TieBreakRule.Countback} onRuleChange={vi.fn()}
      boundary={boundary(tie())} onChanged={vi.fn()} />);
    expect(screen.getByText('Pick an age group to settle these ties.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save this order' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Teams level on points/)).not.toBeInTheDocument();
    unmount();

    const { container } = render(<FinalsTiePanel competitionId={12} section={null} rule={TieBreakRule.Countback} onRuleChange={vi.fn()}
      boundary={{ tied: false }} onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
