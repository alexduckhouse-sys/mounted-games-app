import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TickerProvider, useTicker } from '../../components/TickerContext';
import { heat, race, session } from '../../test/factories';
import { HeatChooser } from './HeatChooser';

const sessions = [
  session(1, { competitionSectionId: 1, sectionName: 'Teams Seniors', orderIndex: 0, status: 2, scheduledStart: '2026-10-29T07:45:00', heats: [heat(1, { sessionId: 1, orderIndex: 0, label: 'Heat 1', races: [race(1, { isComplete: true })] })] }),
  session(2, { competitionSectionId: 1, sectionName: 'Teams Seniors', orderIndex: 1, status: 1, scheduledStart: '2026-10-29T08:20:00', heats: [heat(2, { sessionId: 2, orderIndex: 0, label: 'A Final', races: [race(2)] })] }),
  session(3, { competitionSectionId: 2, sectionName: 'Teams Juniors', orderIndex: 2, status: 0, scheduledStart: '2026-10-29T09:00:00', heats: [heat(3, { sessionId: 3, orderIndex: 0, label: 'Heat 1', races: [race(3)] })] }),
];

function Dock() {
  const { dockAction } = useTicker();
  return dockAction ? <button type="button" aria-label={dockAction.label} data-icon={dockAction.icon} onClick={dockAction.onClick} /> : null;
}
function Where() {
  const { pathname, search, state } = useLocation();
  return <output data-testid="where">{pathname}{search}|{JSON.stringify(state)}</output>;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/competitions/4/session/1?heat=1&mine=Main%20Arena']}>
      <TickerProvider><Dock /><Where /><HeatChooser competitionId={4} sessions={sessions} currentHeatId={1} /></TickerProvider>
    </MemoryRouter>,
  );
}

describe('HeatChooser', () => {
  it('puts a list button beside the ticker dock', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Change heat' })).toHaveAttribute('data-icon', 'list');
  });

  it('opens a sheet of the day\'s heats by age group with the current one ticked', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Change heat' }));
    const sheet = await screen.findByRole('dialog', { name: 'Change heat' });
    const seniors = within(sheet).getByRole('region', { name: 'Seniors' });
    const rows = within(seniors).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(['07:45Heat 1Finished', '08:20A FinalOn now']);
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
    expect(rows[1]).not.toHaveAttribute('aria-current');
    expect(within(within(sheet).getByRole('region', { name: 'Juniors' })).getAllByRole('button')).toHaveLength(1);
  });

  it('goes to the tapped heat as a slide, keeping the rest of the address, and closes the sheet', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Change heat' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /A Final/ }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(screen.getByTestId('where')).toHaveTextContent('/competitions/4/session/2?heat=2&mine=Main+Arena|{"mgTransition":"push"}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('just closes when the current heat is tapped', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Change heat' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Heat 1Finished/ }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(screen.getByTestId('where')).toHaveTextContent('/competitions/4/session/1?heat=1&mine=Main%20Arena|null');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders without a ticker around it', () => {
    render(<MemoryRouter><HeatChooser competitionId={4} sessions={sessions} currentHeatId={1} /></MemoryRouter>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
