import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrentCompetitionProvider } from '../competition/CurrentCompetitionContext';
import { applyBottomBarPreset, setBottomTabs } from '../lib/userPrefs';
import { BottomTabs } from './BottomTabs';
import { GlobalTabs } from './GlobalTabs';

const current = (path: string, canOrganise?: boolean) => {
  render(<MemoryRouter initialEntries={[path]}><BottomTabs competitionId={12} canOrganise={canOrganise} /></MemoryRouter>);
  return screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent);
};

describe('BottomTabs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('links to the four places inside the competition without a Following tab', () => {
    render(<MemoryRouter initialEntries={['/competitions/12']}><BottomTabs competitionId={12} /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: 'Competition' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Timetable', '/competitions/12'],
      ['Toplists', '/competitions/12/toplists'],
      ['Live stream', '/competitions/12/chat'],
      ['Details', '/competitions/12/details'],
    ]);
    expect(screen.queryByRole('link', { name: /Following/i })).not.toBeInTheDocument();
  });

  describe('while entries are the only thing to do', () => {
    const entry = (path: string, me?: { initials: string; count: number }) => {
      render(<MemoryRouter initialEntries={[path]}><BottomTabs competitionId={12} entryOnly me={me} /></MemoryRouter>);
      return screen.getAllByRole('link');
    };

    it('offers just Enter and Details', () => {
      expect(entry('/competitions/12').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
        ['Enter', '/competitions/12'],
        ['Details', '/competitions/12/details'],
      ]);
    });

    it('keeps the Me tab for someone signed in', () => {
      expect(entry('/competitions/12', { initials: 'AM', count: 0 }).map((link) => link.textContent)).toEqual(['Enter', 'Details', 'AMMe']);
    });

    it.each([
      ['/competitions/12', 'Enter'],
      ['/competitions/12/enter', 'Enter'],
      ['/competitions/12/details', 'Details'],
    ])('highlights the right tab at %s', (path, tab) => {
      expect(entry(path).filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent)).toEqual([tab]);
    });
  });

  it.each([
    ['/competitions/12', 'Timetable'],
    ['/competitions/12/', 'Timetable'],
    ['/competitions/12/session/3', 'Timetable'],
    ['/competitions/12/scoring', 'Timetable'],
    ['/competitions/12/toplists', 'Toplists'],
    ['/competitions/12/chat', 'Live stream'],
    ['/competitions/12/details/', 'Details'],
    ['/competitions/12/sponsors', 'Details'],
  ])('highlights the right tab at %s', (path, tab) => {
    expect(current(path)).toEqual([tab]);
  });

  it('highlights nothing on a page it has no tab for', () => {
    expect(current('/competitions/12/teams')).toEqual([]);
  });

  describe('the Me tab', () => {
    const withMe = (path: string, me = { initials: 'AM', count: 0 }) => {
      render(<MemoryRouter initialEntries={[path]}><BottomTabs competitionId={12} me={me} /></MemoryRouter>);
      return screen.getAllByRole('link');
    };

    it('is a fifth tab, after the four, for a signed-in person', () => {
      const links = withMe('/competitions/12');
      expect(links.map((link) => [link.textContent, link.getAttribute('href')]).at(-1)).toEqual(['AMMe', '/me']);
      expect(links).toHaveLength(5);
      expect(screen.getByText('AM')).toBeInTheDocument();
    });

    it('is not there for a visitor', () => {
      render(<MemoryRouter initialEntries={['/competitions/12']}><BottomTabs competitionId={12} /></MemoryRouter>);
      expect(screen.queryByRole('link', { name: /Me/ })).not.toBeInTheDocument();
    });

    it('shows how many things need the person, for sighted and screen reader users', () => {
      const links = withMe('/competitions/12', { initials: 'AM', count: 3 });
      const me = links.at(-1)!;
      expect(me).toHaveTextContent('3');
      expect(me).toHaveTextContent('Me, 3 to do');
    });

    it('shows no badge when nothing is waiting', () => {
      const me = withMe('/competitions/12').at(-1)!;
      expect(me).toHaveTextContent(/^AMMe$/);
    });

    it('is the only tab highlighted on the profile page', () => {
      const links = withMe('/me');
      expect(links.filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent)).toEqual(['AMMe']);
    });

    it('does not highlight a competition tab away from that competition', () => {
      const links = withMe('/me/');
      expect(links.slice(0, 4).some((link) => link.hasAttribute('aria-current'))).toBe(false);
      expect(links[4]).toHaveAttribute('aria-current', 'page');
    });

    it('is not highlighted on a competition page', () => {
      expect(withMe('/competitions/12/toplists').at(-1)).not.toHaveAttribute('aria-current');
    });
  });

  describe('customisable tabs and role presets', () => {
    it('renders the Trainer preset tabs and applies compact styling when 6+ items are shown', () => {
      act(() => {
        applyBottomBarPreset('trainer');
      });
      render(
        <MemoryRouter initialEntries={['/competitions/12/declarations']}>
          <BottomTabs competitionId={12} me={{ initials: 'TR', count: 0 }} />
        </MemoryRouter>,
      );
      expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
        'Timetable',
        'Dec forms',
        'Teams',
        'Toplists',
        'Live stream',
        'TRMe',
      ]);
      expect(screen.getByRole('link', { name: 'Dec forms' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'Dec forms' })).toHaveClass('mg-tab-compact');
    });

    it.each([
      ['/competitions/12/following', 'Following'],
      ['/competitions/12/arena', 'Arena'],
      ['/competitions/12/teams', 'Teams'],
      ['/competitions/12/shop', 'Shop'],
      ['/competitions/12/operations', 'Operations'],
    ])('highlights %s on %s when configured', (path, tab) => {
      act(() => {
        setBottomTabs(['following', 'arena', 'teams', 'shop', 'operations']);
      });
      expect(current(path, true)).toEqual([tab]);
    });

    it('hides GlobalTabs on /me when a competition is currently selected', () => {
      document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify({ id: 12, name: 'Test' }))}; Path=/`;
      const { container } = render(
        <MemoryRouter initialEntries={['/me']}>
          <CurrentCompetitionProvider>
            <GlobalTabs />
          </CurrentCompetitionProvider>
        </MemoryRouter>,
      );
      expect(container).toBeEmptyDOMElement();
      document.cookie = 'mg.competition=; Max-Age=0; Path=/';
    });

    it('hides the Operations tab when the user cannot organise the competition', () => {
      act(() => {
        applyBottomBarPreset('organiser');
      });
      render(<MemoryRouter initialEntries={['/competitions/12']}><BottomTabs competitionId={12} canOrganise={false} /></MemoryRouter>);
      expect(screen.queryByRole('link', { name: 'Operations' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Dec forms' })).toBeInTheDocument();
    });

    it('falls back to default tabs if hiding operations leaves fewer than 2 tabs', () => {
      act(() => {
        setBottomTabs(['timetable', 'operations']);
      });
      render(<MemoryRouter initialEntries={['/competitions/12']}><BottomTabs competitionId={12} canOrganise={false} /></MemoryRouter>);
      expect(screen.queryByRole('link', { name: 'Operations' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Details' })).toBeInTheDocument();
    });
  });
});
