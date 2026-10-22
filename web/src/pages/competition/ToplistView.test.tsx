import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { standing } from '../../test/factories';
import { buildToplist } from '../../lib/toplist';
import { ToplistView } from './ToplistView';

const list = (points: number[]) => buildToplist(points.map((p, i) => standing(i + 1, p)), [], [], 9, null);
const positions = () => within(screen.getByRole('region', { name: 'Totals' })).getAllByRole('listitem').map((li) => li.textContent?.split(/[A-Za-z(]/)[0].trim());

describe('ToplistView positions', () => {
  it('shows a dash instead of every team being joint first before any race is scored', () => {
    render(<ToplistView list={list([0, 0, 0])} section={null} />);
    expect(positions()).toEqual(['—', '—', '—']);
    expect(screen.queryByText(/joint/i)).not.toBeInTheDocument();
  });

  it('shows real positions, with ties marked, once there are points', () => {
    render(<ToplistView list={list([6, 6, 2])} section={null} />);
    expect(positions()).toEqual(['1', '1', '3']);
    expect(screen.getAllByText('(joint)', { exact: false })).toHaveLength(2);
  });

  it('uses the dash in the by-session table too', async () => {
    const sessions = [{ id: 1, label: 'S1', title: 'Session 1' }];
    const before = { ...list([0, 0]), bySession: { sessions, cells: new Map<number, number[]>() } };
    render(<ToplistView list={before} section={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    const body = within(screen.getByRole('region', { name: 'Points by session' })).getAllByRole('row').slice(1);
    expect(body.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['—', '—']);
  });
});
