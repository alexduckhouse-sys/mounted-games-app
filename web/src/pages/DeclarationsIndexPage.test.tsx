import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { competition, team } from '../test/factories';
import type { DeclarationForm } from '../types';
import { DeclarationsIndexPage } from './DeclarationsIndexPage';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
const hoisted = vi.hoisted(() => ({ current: null as { id: number; name: string } | null }));
vi.mock('../competition/CurrentCompetitionContext', () => ({
  useCurrentCompetition: () => ({ current: hoisted.current, venue: null, setCurrent: vi.fn() }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

const rider = (id: number, extra: Record<string, unknown> = {}) => ({ id, fullName: `Rider ${id}`, horseName: `Pony ${id}`, isCaptain: false, isReserve: false, orderIndex: id, ...extra });
const form = (id: number, teamId: number, teamName: string, competitionId: number, extra: Partial<DeclarationForm> = {}): DeclarationForm => ({
  id, teamId, teamName, competitionId, competitionName: competitionId === 4 ? 'Spring Open' : 'Autumn League', submittedByUserId: 'u1',
  submittedAt: '2026-10-20T09:00:00Z', isLocked: false, riders: [rider(1), rider(2), rider(3), rider(4), rider(5)], ...extra,
});

const future = new Date(Date.now() + 14 * 864e5).toISOString();
const past = '2025-09-01T09:00:00Z';
let teams: unknown;
let forms: unknown;
let failLocks: boolean;

beforeEach(() => {
  hoisted.current = { id: 4, name: 'Spring Open' };
  failLocks = false;
  teams = [
    team(1, { competitionId: 4, displayName: 'Warwickshire A', sectionName: 'Under 12', relationship: 'trainer' }),
    team(2, { competitionId: 4, displayName: 'Warwickshire B', sectionName: 'Under 12', relationship: 'trainer' }),
    team(3, { competitionId: 9, displayName: 'Old A', sectionName: 'Under 15', relationship: 'manager' }),
    team(4, { competitionId: 4, displayName: 'Supported Team', relationship: 'supporter' }),
  ];
  forms = [
    form(11, 1, 'Warwickshire A', 4),
    form(12, 3, 'Old A', 9),
    form(13, 50, 'Cotswold A', 4, { submittedByUserId: 'someone-else', riders: [rider(1), rider(2, { isReserve: true })] }),
  ];
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/trainer/my-teams') return { data: teams } as never;
    if (url === '/declaration-forms') return { data: forms } as never;
    if (url === '/competitions/4') return { data: competition({ id: 4, name: 'Spring Open', startDate: future }) } as never;
    if (url === '/competitions/9') return { data: competition({ id: 9, name: 'Autumn League', startDate: past }) } as never;
    if (url === '/declaration-forms/competition/4/lock-time') {
      if (failLocks) throw new Error('offline');
      return { data: { competitionId: 4, declarationsCloseAt: new Date(Date.now() + 5 * 864e5).toISOString(), isClosed: false } } as never;
    }
    if (url === '/declaration-forms/competition/9/lock-time') return { data: { competitionId: 9, declarationsCloseAt: '2025-08-30T17:00:00Z', isClosed: true } } as never;
    throw new Error(`unexpected ${url}`);
  });
});

const mount = () => render(<MemoryRouter><DeclarationsIndexPage /></MemoryRouter>);

describe('DeclarationsIndexPage: the current competition', () => {
  it('says it is loading, then shows a row for each of my teams with a Sent or Not sent chip', async () => {
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    const group = within(await screen.findByRole('region', { name: 'Spring Open' }));
    const a = group.getByRole('link', { name: /Warwickshire A/ });
    expect(a).toHaveAttribute('href', '/competitions/4/declarations?team=1');
    expect(a).toHaveTextContent('Sent 20 Oct · 5 riders');
    expect(within(a).getByText('Sent')).toHaveAttribute('data-tone', 'good');
    const b = group.getByRole('link', { name: /Warwickshire B/ });
    expect(b).toHaveTextContent('Under 12');
    expect(within(b).getByText('Not sent')).toHaveAttribute('data-tone', 'warn');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    // A team I only follow can't send a form, and the other competition waits under All.
    expect(screen.queryByText('Supported Team')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Autumn League' })).not.toBeInTheDocument();
  });

  it('puts the lock time in the heading, and no coloured hatband bar on any row', async () => {
    mount();
    const group = await screen.findByRole('region', { name: 'Spring Open' });
    expect(await within(group).findByText(/^Locks /)).toBeInTheDocument();
    expect(group.querySelector('[class*="hatband"], [style*="background"]')).toBeNull();
  });

  it('leaves the heading bare when the lock time can’t be had', async () => {
    failLocks = true;
    mount();
    const group = await screen.findByRole('region', { name: 'Spring Open' });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/declaration-forms/competition/4/lock-time'));
    expect(within(group).queryByText(/Lock/)).not.toBeInTheDocument();
    expect(within(group).getByText('Not sent')).toBeInTheDocument();
  });

  it('says so when there is nothing for the current competition, and links to it', async () => {
    teams = [];
    forms = [];
    mount();
    expect(await screen.findByText(/No dec forms for Spring Open yet\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Spring Open' })).toHaveAttribute('href', '/competitions/4/declarations');
  });

  it('shows a form I sent for a team that is not on my list as Sent', async () => {
    teams = [];
    forms = [form(14, 70, 'Borrowed Team', 4)];
    mount();
    const row = await screen.findByRole('link', { name: /Borrowed Team/ });
    expect(row).toHaveAttribute('href', '/competitions/4/declarations?team=70');
    expect(within(row).getByText('Sent')).toBeInTheDocument();
  });
});

describe('DeclarationsIndexPage: all my forms', () => {
  it('adds every competition, the coming one first, with Locked on the one that has closed', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('region', { name: 'Spring Open' });
    await user.click(screen.getByRole('tab', { name: 'All my forms' }));
    expect(screen.getByRole('tab', { name: 'All my forms' })).toHaveAttribute('aria-selected', 'true');
    const regions = await screen.findAllByRole('region');
    expect(regions.map((r) => r.getAttribute('aria-label'))).toEqual(['Spring Open', 'Autumn League', 'Other clubs']);
    const old = within(screen.getByRole('region', { name: 'Autumn League' }));
    expect(await old.findByRole('heading', { name: 'Autumn LeagueLocked' })).toBeInTheDocument();
    expect(old.getByText('Locked', { selector: '.sp-chip' })).toHaveAttribute('data-tone', 'grey');
  });

  it('lists other clubs’ forms as read-only rows that open to show the riders', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('tab', { name: 'All my forms' }));
    const others = within(await screen.findByRole('region', { name: 'Other clubs' }));
    expect(others.getByText('Locked, read only')).toBeInTheDocument();
    const row = others.getByRole('button', { name: /Cotswold A/ });
    expect(row).toHaveTextContent('Spring Open · 2 riders');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const list = others.getByRole('list', { name: 'Riders for Cotswold A' });
    expect(within(list).getByText('Rider 1')).toBeInTheDocument();
    expect(within(list).getByText('Pony 2')).toBeInTheDocument();
    expect(within(list).getByText(/reserve/)).toBeInTheDocument();
    await user.click(row);
    expect(others.queryByRole('list', { name: 'Riders for Cotswold A' })).not.toBeInTheDocument();
  });

  it('starts on All when there is no current competition, and the first tab is switched off', async () => {
    hoisted.current = null;
    mount();
    expect(await screen.findByRole('region', { name: 'Spring Open' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Current competition' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'All my forms' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Autumn League' })).toBeInTheDocument();
  });

  it('says so when there are no forms and no teams at all', async () => {
    hoisted.current = null;
    teams = [];
    forms = [];
    mount();
    expect(await screen.findByText('No dec forms yet. Open a competition to start one.')).toBeInTheDocument();
  });

  it('treats a failed request as an empty list', async () => {
    hoisted.current = null;
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByText('No dec forms yet. Open a competition to start one.')).toBeInTheDocument();
  });
});
