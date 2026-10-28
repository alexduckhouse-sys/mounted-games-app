import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition } from '../../test/factories';
import type { DeclarationForm, StandingRow } from '../../types';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import { CompetitionContext } from './context';
import { PrizeGivingPage } from './PrizeGivingPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const auth = vi.hoisted(() => ({ organise: true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => auth.organise }) }));

const row = (teamId: number, teamName: string, totalPoints: number): StandingRow => ({ teamId, teamName, clubName: `${teamName} PC`, totalPoints, racesRun: 4, wins: 1, eliminations: 0 });
const STANDINGS = [row(11, 'Thunder', 50), row(12, 'Comets', 44.5), row(13, 'Flyers', 30)];
const FORMS = [{
  id: 1, teamId: 11, submittedAt: '2026-10-02T09:00:00Z',
  riders: [
    { id: 1, fullName: 'Ruby Fox', horseName: 'Toffee', isReserve: true, isCaptain: false, orderIndex: 0 },
    { id: 2, fullName: 'Amy Lee', horseName: 'Biscuit', isReserve: false, isCaptain: true, orderIndex: 1 },
  ],
}] as unknown as DeclarationForm[];

function mount(url = '/competitions/1/prize-giving', lang: Lang = 'en') {
  const value = {
    competition: competition({ sections: [{ id: 5, competitionId: 1, format: 2, ageGroup: 'Open', displayName: 'Open', finalistCount: null }, { id: 6, competitionId: 1, format: 2, ageGroup: 'U12', displayName: 'Under 12', finalistCount: null }], sessions: [], teams: [] }),
    reload: vi.fn(), streams: [], streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [],
  };
  return render(
    <LanguageProvider initial={lang}>
    <MotionConfig reducedMotion="always">
      <MemoryRouter initialEntries={[url]}>
        <CompetitionContext.Provider value={value as never}>
          <Routes><Route path="/competitions/:id/prize-giving" element={<PrizeGivingPage />} /></Routes>
        </CompetitionContext.Provider>
      </MemoryRouter>
    </MotionConfig>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  auth.organise = true;
  vi.mocked(api.get).mockReset().mockImplementation(async (url: string) => ({ data: url.includes('standings') ? STANDINGS : FORMS }));
  vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} });
});

const posted = () => vi.mocked(api.post).mock.calls.map(([, body]) => body);

describe('PrizeGivingPage', () => {
  it('tells people who cannot organise that it is for the organiser', () => {
    auth.organise = false;
    mount();
    expect(screen.getByText(/Only the competition organiser or team can run the prize-giving/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('steps from last place to the winners, reading out riders and ponies, then clears the stream', async () => {
    mount('/competitions/1/prize-giving?section=5');
    expect(await screen.findByText('Up next: 3rd')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/competitions/1/standings', { params: { sectionId: 5 } });
    expect(screen.getByText('No dec form for this team, so no riders to read out.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reveal 3rd' }));
    expect(posted()[0]).toEqual({ action: 'show', sectionId: 5, places: [{ teamId: 13, place: 3, points: 30 }], champions: false });
    expect(await screen.findByText('Up next: 2nd')).toBeInTheDocument();
    expect(screen.getByText('44.5 pts')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Places given' })).getByText('Flyers')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reveal 2nd' }));
    expect(await screen.findByText('Up next: 1st')).toBeInTheDocument();
    const riders = screen.getByRole('list', { name: 'Riders and ponies' });
    expect(within(riders).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Amy LeeBiscuit', 'Ruby FoxReserveToffee']);
    expect(screen.getByText('Thunder PC')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reveal the winners' }));
    expect(posted()[2]).toEqual({ action: 'show', sectionId: 5, champions: true,
      places: [{ teamId: 13, place: 3, points: 30 }, { teamId: 12, place: 2, points: 44.5 }, { teamId: 11, place: 1, points: 50 }] });
    expect(await screen.findByText('All places given')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(posted()[3]).toMatchObject({ champions: false, places: [{ teamId: 13 }, { teamId: 12 }] });
    await userEvent.click(screen.getByRole('button', { name: 'Reveal the winners' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Clear the stream' }));
    expect(posted()[5]).toEqual({ action: 'clear' });
    expect(await screen.findByText('Up next: 3rd')).toBeInTheDocument();
  });

  it('keeps the set-up while places are on the stream, and gives fewer places when asked', async () => {
    mount();
    expect(await screen.findByText('Up next: 3rd')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove one place' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove one place' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove one place' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove one place' }));
    expect(await screen.findByText('Up next: 2nd')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reveal 2nd' }));
    expect(screen.getByText(/Clear the stream to change/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add one place' })).toBeDisabled();
  });

  it('says when the stream could not be changed and tries again, and when the toplist could not load', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Reveal 3rd' }));
    expect(await screen.findByText('Couldn’t update the stream. Check your signal and try again.')).toBeInTheDocument();
    expect(screen.getByText('Up next: 3rd')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Up next: 2nd')).toBeInTheDocument();
  });

  it('offers to load the toplist again after it fails', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('standings')) throw new Error('offline');
      return { data: [] };
    });
    mount();
    expect(await screen.findByText(/Couldn’t load the toplist/)).toBeInTheDocument();
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url.includes('standings') ? [] : [] }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('No places to give in Open yet.')).toBeInTheDocument());
  });
});

describe('PrizeGivingPage in French and Welsh', () => {
  it('reads in French, with a French ordinal on the button', async () => {
    mount('/competitions/1/prize-giving?section=5', 'fr');
    expect(await screen.findByText('À suivre : 3e')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Révéler la 3e place' })).toBeInTheDocument();
    expect(screen.getByText('Pas de fiche de déclaration pour cette équipe, donc pas de cavaliers à annoncer.')).toBeInTheDocument();
  });

  it('reads in Welsh', async () => {
    mount('/competitions/1/prize-giving?section=5', 'cy');
    expect(await screen.findByText('Nesaf: 3ydd')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Datgelu’r 3ydd' })).toBeInTheDocument();
  });
});
