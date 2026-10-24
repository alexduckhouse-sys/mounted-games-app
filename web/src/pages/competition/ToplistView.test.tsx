import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { standing } from '../../test/factories';
import { buildToplist } from '../../lib/toplist';
import { ToplistView } from './ToplistView';

const list = (points: number[]) => buildToplist(points.map((p, i) => standing(i + 1, p)), [], [], 9, null);
const positions = () => within(screen.getByRole('region', { name: 'Totals' })).getAllByRole('listitem').map((li) => li.textContent?.split(/[A-Za-z(]/)[0].trim());

describe('ToplistView positions', () => {
  it('shows a dash instead of every team being joint first before any race is scored', () => {
    render(<MemoryRouter><ToplistView list={list([0, 0, 0])} section={null} /></MemoryRouter>);
    expect(positions()).toEqual(['—', '—', '—']);
    expect(screen.queryByText(/joint/i)).not.toBeInTheDocument();
  });

  it('shows real positions, with ties marked and points gap behind the leader, once there are points', () => {
    render(<MemoryRouter><ToplistView list={list([6, 6, 2])} section={null} /></MemoryRouter>);
    expect(positions()).toEqual(['1', '1', '3']);
    expect(screen.getAllByText('(joint)', { exact: false })).toHaveLength(2);
    expect(screen.getByText('−4')).toHaveAttribute('title', '4 behind leader');
  });

  it('uses the dash in the by-session table too and keeps the selected view when switching age groups', async () => {
    const sessions = [{ id: 1, label: 'S1', title: 'Session 1' }];
    const before = { ...list([0, 0]), bySession: { sessions, cells: new Map<number, number[]>() } };
    const { rerender } = render(<MemoryRouter><ToplistView list={before} section={{ id: 8, competitionId: 3, format: 2, ageGroup: 'Open', displayName: 'Open' }} /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'By session' }));
    const body = within(screen.getByRole('region', { name: 'Points by session' })).getAllByRole('row').slice(1);
    expect(body.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['—', '—']);

    const nextSection = { ...list([5, 3]), bySession: { sessions, cells: new Map([[1, [5]], [2, [3]]]) } };
    rerender(<MemoryRouter><ToplistView list={nextSection} section={{ id: 9, competitionId: 3, format: 2, ageGroup: 'U17', displayName: 'Under 17' }} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'By session' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Points by session' })).toBeInTheDocument();
  });
});
