import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { FAVOURITES_KEY } from '../../lib/favourites';
import { standing } from '../../test/factories';
import { buildToplist } from '../../lib/toplist';
import { ToplistView } from './ToplistView';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

const list = (points: number[]) => buildToplist(points.map((p, i) => standing(i + 1, p)), [], [], 9, null);
const positions = () => within(screen.getByRole('region', { name: 'Totals' })).getAllByRole('listitem').map((li) => li.textContent?.split(/[A-Za-z(]/)[0].trim());

describe('ToplistView positions', () => {
  it('shows a dash instead of every team being joint first before any race is scored', () => {
    render(<MemoryRouter><ToplistView list={list([0, 0, 0])} section={null} /></MemoryRouter>);
    expect(positions()).toEqual(['—', '—', '—']);
    expect(screen.queryByText(/joint/i)).not.toBeInTheDocument();
  });

  it('shows real positions, with ties marked and points gap behind the leader, once there are points', () => {
    render(<ToplistView list={list([6, 6, 2])} section={null} />);
    expect(positions()).toEqual(['1', '1', '3']);
    expect(screen.getAllByText('(joint)', { exact: false })).toHaveLength(2);
    expect(screen.getByText('4 behind')).toHaveAttribute('title', '4 behind leader');
  });

  it('does not show a zero-point gap for a hidden run-off tie-breaker', () => {
    render(<ToplistView list={list([24.01, 24])} section={null} />);
    expect(screen.queryByText('0 behind')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/behind leader/)).not.toBeInTheDocument();
  });

  it('uses the dash in the by-session table too and keeps the selected view when switching age groups', async () => {
    const sessions = [{ id: 1, label: 'S1', title: 'Session 1' }];
    const before = { ...list([0, 0]), bySession: { sessions, cells: new Map<number, number[]>() } };
    const { rerender } = render(<MemoryRouter><ToplistView list={before} section={{ id: 8, competitionId: 3, format: 2, ageGroup: 'Open', displayName: 'Open' }} /></MemoryRouter>);
    await userEvent.click(screen.getByRole('combobox', { name: 'Show' }));
    await userEvent.click(screen.getByRole('option', { name: 'By session' }));
    const body = within(screen.getByRole('region', { name: 'Points by session' })).getAllByRole('row').slice(1);
    expect(body.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['—', '—']);

    const nextSection = { ...list([5, 3]), bySession: { sessions, cells: new Map([[1, [5]], [2, [3]]]) } };
    rerender(<MemoryRouter><ToplistView list={nextSection} section={{ id: 9, competitionId: 3, format: 2, ageGroup: 'U17', displayName: 'Under 17' }} /></MemoryRouter>);
    expect(screen.getByRole('combobox', { name: 'Show' })).toHaveTextContent('By session');
    expect(screen.getByRole('region', { name: 'Points by session' })).toBeInTheDocument();
  });

  it('hides .01 run-off tie-breaker points while keeping .01 winner ranked ahead and highlights followed teams', () => {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ competitionId: 1, teamId: 2 }]));
    const toplist = list([24, 24.01, 24.51]);
    render(
      <MemoryRouter>
        <ToplistView list={toplist} section={{ id: 9, competitionId: 1, format: 2, ageGroup: 'Seniors', displayName: 'Seniors' }} />
      </MemoryRouter>,
    );
    const items = within(screen.getByRole('region', { name: 'Totals' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Team 3');
    expect(items[0]).toHaveTextContent('24.5');
    expect(items[1]).toHaveTextContent('Team 2');
    expect(items[1]).toHaveTextContent('24');
    expect(items[1]).not.toHaveTextContent('24.01');
    expect(items[1]).toHaveAttribute('data-followed', 'true');
    expect(items[2]).toHaveTextContent('Team 1');
    expect(screen.getByRole('button', { name: /Team 2/ })).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('opens a team\'s sheet from its row inside the app, with a link on to the full team page', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] } as never);
    render(<MemoryRouter><ToplistView list={list([6, 4])} section={null} competitionId={3} /></MemoryRouter>);
    const rows = within(screen.getByRole('region', { name: 'Totals' })).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('6');
    await userEvent.click(rows[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Full team page' })).toHaveAttribute('href', '/competitions/3/teams/1');
  });

  it('lists the declared riders and ponies in the sheet', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ teamId: 1, riders: [
      { id: 1, fullName: 'Ella Hughes', horseName: 'Pickle', orderIndex: 0, isReserve: false },
      { id: 2, fullName: 'Rita Reserve', horseName: null, orderIndex: 1, isReserve: true },
    ] }] } as never);
    render(<MemoryRouter><ToplistView list={list([6, 4])} section={null} competitionId={3} /></MemoryRouter>);
    await userEvent.click(within(screen.getByRole('region', { name: 'Totals' })).getAllByRole('button')[0]);
    const riders = await screen.findByRole('region', { name: 'Riders and ponies' });
    expect(riders).toHaveTextContent('Ella Hughes');
    expect(riders).toHaveTextContent('Pickle');
    expect(riders).not.toHaveTextContent('Rita Reserve');
  });
});
