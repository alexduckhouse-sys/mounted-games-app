import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { WithDock } from '../test/dock';
import { CompetitionPicker } from './CompetitionPicker';
import { CurrentCompetitionProvider } from './CurrentCompetitionContext';

const get = vi.hoisted(() => vi.fn());
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'example-member' } }) }));
vi.mock('../api', () => ({ api: { get } }));

const item = { id: 2, name: 'Autumn Open', startDate: '2025-11-07T09:00:00', endDate: null, icon: 'flag', location: 'Hillside' };

beforeEach(() => {
  get.mockResolvedValue({ data: { items: [item], hasMore: false, years: [2025, 2024], locations: ['Hillside'] }, headers: {} });
});

function show(past: boolean) {
  return render(<WithDock><MemoryRouter><CurrentCompetitionProvider><CompetitionPicker past={past} /></CurrentCompetitionProvider></MemoryRouter></WithDock>);
}

it('moves the archive filters to the dock button, counting the filters set', async () => {
  show(true);
  await screen.findByText('Autumn Open');
  const dock = await screen.findByTestId('dock');
  expect(dock).toHaveAttribute('data-icon', 'filters');
  expect(dock).toHaveAttribute('data-count', '0');
  expect(screen.getAllByRole('button', { name: /Archive filters/ })).toEqual([dock]);
  await userEvent.click(dock);
  const sheet = within(await screen.findByRole('dialog'));
  await userEvent.click(sheet.getByRole('button', { name: '2025' }));
  await userEvent.click(sheet.getByRole('button', { name: 'Hillside' }));
  expect(await screen.findByTestId('dock')).toHaveAttribute('data-count', '2');
});

it('has no dock button on the upcoming list', async () => {
  show(false);
  await screen.findByText('Autumn Open');
  expect(screen.queryByTestId('dock')).toBeNull();
});
