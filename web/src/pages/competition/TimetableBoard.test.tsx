import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { competition, heat, session } from '../../test/factories';
import { dayKey } from '../../lib/timetableDay';
import { TimetableBoard } from './TimetableBoard';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./context', () => ({ useCompetition: () => state.value }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => false }) }));

beforeEach(() => {
  localStorage.clear();
  const day = dayKey(new Date());
  const mainHeat = heat(11, { sessionId: 1, orderIndex: 0, label: 'Heat 1' });
  const secondHeat = heat(22, { sessionId: 2, orderIndex: 0, label: 'Heat 2' });
  const sessions = [
    session(1, { status: 1, arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, heats: [mainHeat] }),
    session(2, { status: 0, arenaName: 'Arena Two', scheduledStart: `${day}T11:00:00`, heats: [secondHeat] }),
    session(3, { status: 2, arenaName: 'Finished Arena', scheduledStart: `${day}T08:00:00`, heats: [heat(33, { sessionId: 3, label: 'Heat 3', finishedAt: `${day}T08:30:00` })] }),
  ];
  state.value = { competition: competition({ startDate: day, endDate: day, sessions }), reload: vi.fn(), updatedAt: null };
});

it('chooses and remembers an arena from the accessible bottom sheet', async () => {
  render(<MemoryRouter><TimetableBoard /></MemoryRouter>);
  const picker = screen.getByRole('button', { name: 'Arena: All arenas' });
  expect(picker).toHaveAttribute('aria-haspopup', 'dialog');
  fireEvent.click(picker);
  expect(screen.getByRole('dialog', { name: 'Choose arena' })).toBeVisible();
  expect(screen.getByText('On now: Heat 1')).toBeVisible();
  expect(screen.getByText(/Starts 11:00 · Heat 2/)).toBeVisible();
  const allArenas = screen.getByRole('button', { name: /All arenas\. Everything/ });
  const finishedArena = screen.getByRole('button', { name: 'Finished Arena. Finished' });
  expect(within(allArenas).queryByText(/Live|Later/)).toBeNull();
  expect(within(finishedArena).queryByText('Later')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Arena Two\. Starts/ }));
  expect(localStorage.getItem('mg.tt.arena.1')).toBe('Arena Two');
  expect(screen.queryByRole('dialog', { name: 'Choose arena' })).toBeNull();
  await waitFor(() => expect(picker).toHaveFocus());
});

it('closes the arena sheet with Escape without changing the selection', async () => {
  render(<MemoryRouter><TimetableBoard /></MemoryRouter>);
  const picker = screen.getByRole('button', { name: 'Arena: All arenas' });
  fireEvent.click(picker);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Choose arena' })).toBeNull();
  expect(localStorage.getItem('mg.tt.arena.1')).toBeNull();
  await waitFor(() => expect(picker).toHaveFocus());
});

it('keeps keyboard focus inside the sheet and closes when its overlay is tapped', () => {
  render(<MemoryRouter><TimetableBoard /></MemoryRouter>);
  const picker = screen.getByRole('button', { name: 'Arena: All arenas' });
  fireEvent.click(picker);
  const close = screen.getByRole('button', { name: 'Close arena picker' });
  const lastOption = screen.getByRole('button', { name: 'Finished Arena. Finished' });
  lastOption.focus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(close).toHaveFocus();
  const overlay = document.querySelector<HTMLElement>('.tt-arena-overlay')!;
  fireEvent.pointerDown(overlay);
  expect(screen.queryByRole('dialog', { name: 'Choose arena' })).toBeNull();
});
