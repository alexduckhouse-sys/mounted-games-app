import { act, render, screen, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompetitionContext, type CompetitionCtx } from '../../pages/competition/context';
import type { PrizeGiving } from '../../lib/prizeGiving';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { PrizeGivingOverlay } from './PrizeGivingOverlay';

const burst = vi.hoisted(() => vi.fn());
vi.mock('../bursts', () => ({ confettiBurst: burst }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const place = (teamId: number, n: number, points: number, clubName: string | null = `Club ${teamId}`) => ({ teamId, place: n, teamName: `Team ${teamId}`, clubName, points });

function show(prizeGiving: PrizeGiving | null, still = false) {
  const wrap = (children: ReactNode) => still ? <MotionConfig reducedMotion="always">{children}</MotionConfig> : children;
  const value = { prizeGiving } as unknown as CompetitionCtx;
  return render(wrap(<CompetitionContext.Provider value={value}><PrizeGivingOverlay /></CompetitionContext.Provider>));
}

it('shows nothing outside a prize-giving or a competition', () => {
  const { container } = show(null);
  expect(container).toBeEmptyDOMElement();
  const outside = render(<PrizeGivingOverlay />);
  expect(outside.container).toBeEmptyDOMElement();
});

it('reads out the place just given and lists the ones before it, best first', () => {
  show({ sectionId: 3, sectionName: 'Open', champions: false, places: [place(6, 6, 172), place(5, 5, 181), place(4, 4, 187.5)] }, true);
  expect(screen.getByRole('status', { name: '4th: Team 4, 187.5 points' })).toHaveTextContent('Club 4');
  const ladder = screen.getByRole('complementary', { name: 'Prize-giving, Open' });
  expect(within(ladder).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['5thTeam 5181', '6thTeam 6172']);
});

it('leaves the list out for the first place given, and the club when there is none', () => {
  show({ sectionId: 3, sectionName: 'Open', champions: false, places: [place(6, 6, 172, null)] });
  expect(screen.queryByRole('complementary')).toBeNull();
  expect(screen.getByRole('status', { name: '6th: Team 6, 172 points' })).not.toHaveTextContent('Club');
});

it('gives the champions their own card with a rosette and confetti', () => {
  show({ sectionId: 3, sectionName: 'Open', champions: true, places: [place(2, 2, 206), place(1, 1, 214)] });
  const card = screen.getByRole('status', { name: 'Open champions: Team 1, 214 points' });
  expect(card).toHaveTextContent('Open champions');
  expect(card).toHaveTextContent('Club 1 · 214 points');
  expect(card.querySelector('svg.mg-rosette')).not.toBeNull();
  expect(screen.queryByRole('complementary')).toBeNull();
  expect(burst).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(900); });
  expect(burst).toHaveBeenCalledTimes(1);
});

it('keeps the champions still, without confetti, when motion is stilled', () => {
  burst.mockClear();
  show({ sectionId: 3, sectionName: 'Open', champions: true, places: [place(1, 1, 214, null)] }, true);
  expect(screen.getByRole('status', { name: 'Open champions: Team 1, 214 points' })).toHaveTextContent('214 points');
  act(() => { vi.advanceTimersByTime(2000); });
  expect(burst).not.toHaveBeenCalled();
});

it('reads out the place and the champions in French and Welsh', () => {
  const value = { prizeGiving: { sectionId: 3, sectionName: 'Open', champions: false, places: [place(6, 6, 172), place(5, 5, 181)] } } as unknown as CompetitionCtx;
  const fr = render(<LanguageProvider initial="fr"><MotionConfig reducedMotion="always"><CompetitionContext.Provider value={value}><PrizeGivingOverlay /></CompetitionContext.Provider></MotionConfig></LanguageProvider>);
  expect(screen.getByRole('status', { name: '5e : Team 5, 181 points' })).toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'Remise des prix, Open' })).toBeInTheDocument();
  fr.unmount();
  const champions = { prizeGiving: { sectionId: 3, sectionName: 'Open', champions: true, places: [place(1, 1, 214)] } } as unknown as CompetitionCtx;
  render(<LanguageProvider initial="cy"><MotionConfig reducedMotion="always"><CompetitionContext.Provider value={champions}><PrizeGivingOverlay /></CompetitionContext.Provider></MotionConfig></LanguageProvider>);
  expect(screen.getByRole('status', { name: 'Pencampwyr Open: Team 1, 214 pwynt' })).toHaveTextContent('Pencampwyr Open');
});
