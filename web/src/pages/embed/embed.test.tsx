import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import type { CompetitionSection } from '../../types';
import { EmbedApp } from './EmbedApp';

const section = (id: number, displayName: string, extra: Partial<CompetitionSection> = {}): CompetitionSection => ({ id, competitionId: 1, format: 1, ageGroup: displayName, displayName, ...extra });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const entries = [1, 2].map((id) => ({ id, teamId: id, teamName: `Team ${id}`, laneIndex: id }));
const detail = competition({
  name: 'Spring Games',
  sections: [section(5, 'Teams Seniors', { finalistCount: 1 }), section(6, 'Teams Juniors')],
  teams: [team(1), team(2)],
  sessions: [
    session(1, { orderIndex: 1, status: 1, scheduledStart: new Date().toISOString(), heats: [
      heat(1, { label: 'Heat 1', entries, races: [race(1, { isComplete: true, results: [result(1, 1, { points: 2 }), result(2, 2, { points: 1 })] })] }),
    ] }),
    session(2, { id: 2, orderIndex: 2, kind: 1, isBreak: true, name: 'Lunch', scheduledStart: new Date().toISOString(), competitionSectionId: null, sectionName: null }),
  ],
});

let routes: Record<string, () => Response>;
let fetchMock: ReturnType<typeof vi.fn>;

function open(path: string) {
  window.history.pushState({}, '', path);
  return render(<EmbedApp />);
}

beforeEach(() => {
  routes = {
    '/api/competitions/1': () => json(detail),
    '/api/competitions/1/standings?sectionId=5': () => json([standing(1, 2), standing(2, 1)]),
    '/api/competitions/1/standings?sectionId=6': () => json([]),
  };
  fetchMock = vi.fn((url: string) => Promise.resolve(routes[url]?.() ?? new Response('', { status: 404 })));
  vi.stubGlobal('fetch', fetchMock);
  localStorage.setItem('mg.auth', JSON.stringify({ token: 'secret', expiresAt: '2999-01-01', user: { id: 'u', roles: ['Admin'] } }));
});
afterEach(() => { vi.unstubAllGlobals(); document.head.querySelectorAll('meta[name=robots]').forEach((m) => m.remove()); });

describe('embedded standings', () => {
  it('shows the toplist with age-group chips, a back link that opens a new tab, and no sign-in data in requests', async () => {
    open('/embed/competitions/1/standings');
    expect(await screen.findByText('Team 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Spring Games' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seniors' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Top 1 make the final')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Powered by Mounted Games' });
    expect(link).toHaveAttribute('href', '/competitions/1/toplists');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.credentials).toBe('omit');
      expect(JSON.stringify(init.headers)).not.toContain('secret');
    }
    expect(document.querySelector('meta[name=robots]')).toHaveAttribute('content', 'noindex');
  });

  it('switches age group and shows an empty message', async () => {
    open('/embed/competitions/1/standings');
    await screen.findByText('Team 1');
    await userEvent.click(screen.getByRole('button', { name: 'Juniors' }));
    expect(await screen.findByText('No results yet.')).toBeInTheDocument();
  });

  it('applies the theme and a validated accent, and hides the chips for a fixed age group', async () => {
    const { container } = open('/embed/competitions/1/standings?theme=dark&accent=%23c2410c&section=5');
    await screen.findByText('Team 1');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(container.querySelector<HTMLElement>('.emb')!.style.getPropertyValue('--emb-fill')).toBe('194 65 12');
    expect(screen.queryByRole('group', { name: 'Age group' })).not.toBeInTheDocument();
    expect(screen.getByText('Standings · Seniors', { exact: false })).toBeInTheDocument();
  });

  it('ignores an accent that is not a plain hex colour', async () => {
    const { container } = open('/embed/competitions/1/standings?accent=red;background:url(x)');
    await screen.findByText('Team 1');
    expect(container.querySelector<HTMLElement>('.emb')!.getAttribute('style')).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('eguk');
  });

  it('keeps showing results with a notice when a refresh fails, and offers a retry when nothing loaded', async () => {
    routes['/api/competitions/1/standings?sectionId=5'] = () => new Response('', { status: 500 });
    open('/embed/competitions/1/standings');
    expect(await screen.findByText('Couldn’t load the standings.')).toBeInTheDocument();
    routes['/api/competitions/1/standings?sectionId=5'] = () => json([standing(1, 2)]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Team 1')).toBeInTheDocument();
  });

  it('says so when there are no age groups', async () => {
    routes['/api/competitions/1'] = () => json({ ...detail, sections: [] });
    open('/embed/competitions/1/standings');
    expect(await screen.findByText('No age groups yet.')).toBeInTheDocument();
  });
});

describe('embedded results', () => {
  it('lists heats with places and points', async () => {
    open('/embed/competitions/1/results');
    expect(await screen.findByRole('region', { name: 'Seniors · Session 1 · Heat 1' })).toBeInTheDocument();
    expect(screen.getByText('Team 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Powered by Mounted Games' })).toHaveAttribute('href', '/competitions/1');
  });

  it('shows earlier results on request and says when there are none', async () => {
    const many = competition({ ...detail, sessions: [session(1, { heats: Array.from({ length: 10 }, (_, i) => heat(i + 1, { orderIndex: i, entries, races: [race(i + 1, { isComplete: true, results: [result(1, 1, { points: 1 })] })] })) })] });
    routes['/api/competitions/1'] = () => json(many);
    open('/embed/competitions/1/results');
    await screen.findByRole('region', { name: 'Seniors · Session 1 · Heat 10' });
    expect(screen.queryByRole('region', { name: 'Seniors · Session 1 · Heat 1' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier results' }));
    expect(screen.getByRole('region', { name: 'Seniors · Session 1 · Heat 1' })).toBeInTheDocument();
  });

  it('shows an empty message before anything is scored', async () => {
    routes['/api/competitions/1'] = () => json({ ...detail, sessions: [] });
    open('/embed/competitions/1/results');
    expect(await screen.findByText('No results yet.')).toBeInTheDocument();
  });
});

describe('embedded timetable', () => {
  it('shows rows with their status and no links into the app', async () => {
    open('/embed/competitions/1/timetable');
    expect(await screen.findByRole('region', { name: 'Seniors · Session 1' })).toBeInTheDocument();
    expect(screen.getByText('Heat 1')).toBeInTheDocument();
    expect(screen.getByText('Lunch')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('offers the whole day when earlier sessions are hidden and filters by age group', async () => {
    const finishedAt = new Date().toISOString();
    const day = competition({ ...detail, sessions: [
      session(1, { orderIndex: 1, status: 2, scheduledStart: finishedAt, heats: [heat(1, { finishedAt, scheduledStart: finishedAt })] }),
      session(2, { orderIndex: 2, status: 2, scheduledStart: finishedAt, heats: [heat(2, { finishedAt, scheduledStart: finishedAt })] }),
      session(3, { orderIndex: 3, competitionSectionId: 6, sectionName: 'Teams Juniors', scheduledStart: finishedAt, heats: [heat(3, { scheduledStart: finishedAt })] }),
    ] });
    routes['/api/competitions/1'] = () => json(day);
    open('/embed/competitions/1/timetable');
    await screen.findByRole('region', { name: 'Juniors · Session 1' });
    expect(screen.getAllByRole('region')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Show the whole day' }));
    expect(screen.getAllByRole('region')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Hide finished sessions' }));
    expect(screen.getAllByRole('region')).toHaveLength(2);
  });

  it('shows day chips for a multi-day event', async () => {
    const dayOne = new Date(2026, 5, 1, 9).toISOString();
    const dayTwo = new Date(2026, 5, 2, 9).toISOString();
    routes['/api/competitions/1'] = () => json(competition({ ...detail, startDate: dayOne, sessions: [
      session(1, { orderIndex: 1, scheduledStart: dayOne, heats: [heat(1, { scheduledStart: dayOne })] }),
      session(2, { orderIndex: 2, scheduledStart: dayTwo, heats: [heat(2, { scheduledStart: dayTwo, label: 'Day two heat' })] }),
    ] }));
    open('/embed/competitions/1/timetable');
    const chips = await screen.findAllByRole('button', { name: /Day [12]/ });
    expect(chips).toHaveLength(2);
    await userEvent.click(chips[1]);
    expect(await screen.findByText('Day two heat')).toBeInTheDocument();
  });

  it('says when nothing is published', async () => {
    routes['/api/competitions/1'] = () => json({ ...detail, sessions: [] });
    open('/embed/competitions/1/timetable');
    expect(await screen.findByText('The timetable isn’t published yet.')).toBeInTheDocument();
  });
});

describe('embed errors', () => {
  it('shows a message for a missing competition and for a bad id, without redirecting', async () => {
    open('/embed/competitions/99/standings');
    expect(await screen.findByText('This competition isn’t available.')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/embed/competitions/99/standings');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never fetches for an invalid id', async () => {
    open('/embed/competitions/abc/standings');
    expect(await screen.findByText('This competition isn’t available.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers a retry when the first load fails', async () => {
    routes['/api/competitions/1'] = () => new Response('', { status: 500 });
    open('/embed/competitions/1/timetable');
    expect(await screen.findByText(/Couldn’t load the results/)).toBeInTheDocument();
    routes['/api/competitions/1'] = () => json(detail);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Seniors · Session 1' })).toBeInTheDocument();
  });

  it('keeps unknown /embed/ paths on a message instead of redirecting to the app', async () => {
    open('/embed/not-a-widget');
    expect(await screen.findByText('This widget isn’t available.')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/embed/not-a-widget');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

describe('embedded season standings', () => {
  const id = '3f2b8c1e-aaaa-4bbb-8ccc-0123456789ab';
  const season = { title: 'League 2026', year: 2026, ageGroup: 'Seniors', bestResultsToCount: 3, rounds: [{ isIncluded: true }, { isIncluded: true }, { isIncluded: false }] };
  const standings = { standings: [
    { rank: 1, teamProfileId: 'a', teamName: 'Hunt A', clubName: 'Hunt', totalPoints: 20, rounds: [{}, {}] },
    { rank: 1, teamProfileId: 'b', teamName: 'Beta', clubName: 'Other Club', totalPoints: 20, rounds: [{}] },
  ] };

  it('shows the table, the shared places and the counting rule', async () => {
    routes[`/api/seasons/${id}`] = () => json(season);
    routes[`/api/seasons/${id}/standings`] = () => json(standings);
    open(`/embed/seasons/${id}/standings`);
    expect(await screen.findByText('Hunt A')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'League 2026' })).toBeInTheDocument();
    expect(screen.getAllByText('=1')).toHaveLength(2);
    expect(screen.getByText('Other Club')).toBeInTheDocument();
    expect(screen.getByText(/Best 3 of 2 rounds count/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Powered by Mounted Games' })).toHaveAttribute('href', `/seasons/${id}`);
  });

  it('handles an empty table, a missing season, a bad id and a failed load', async () => {
    routes[`/api/seasons/${id}`] = () => json({ ...season, bestResultsToCount: null, rounds: [{ isIncluded: true }] });
    routes[`/api/seasons/${id}/standings`] = () => json({ standings: [] });
    const first = open(`/embed/seasons/${id}/standings`);
    expect(await screen.findByText(/No standings yet/)).toBeInTheDocument();
    first.unmount();

    routes[`/api/seasons/${id}`] = () => new Response('', { status: 404 });
    const second = open(`/embed/seasons/${id}/standings`);
    expect(await screen.findByText('This season isn’t available.')).toBeInTheDocument();
    second.unmount();

    fetchMock.mockClear();
    const third = open('/embed/seasons/nope/standings');
    expect(await screen.findByText('This season isn’t available.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    third.unmount();

    routes[`/api/seasons/${id}`] = () => new Response('', { status: 500 });
    open(`/embed/seasons/${id}/standings`);
    expect(await screen.findByText(/Couldn’t load the season/)).toBeInTheDocument();
    routes[`/api/seasons/${id}`] = () => json(season);
    routes[`/api/seasons/${id}/standings`] = () => json(standings);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('Hunt A')).toBeInTheDocument());
  });
});
