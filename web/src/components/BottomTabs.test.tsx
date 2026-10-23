import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BottomTabs } from './BottomTabs';

const current = (path: string) => {
  render(<MemoryRouter initialEntries={[path]}><BottomTabs competitionId={12} /></MemoryRouter>);
  return screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent);
};

describe('BottomTabs', () => {
  it('links to the four places inside the competition', () => {
    render(<MemoryRouter initialEntries={['/competitions/12']}><BottomTabs competitionId={12} /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: 'Competition' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Timetable', '/competitions/12'],
      ['Toplists', '/competitions/12/toplists'],
      ['Live & stream', '/competitions/12/chat'],
      ['Details', '/competitions/12/details'],
    ]);
  });

  it.each([
    ['/competitions/12', 'Timetable'],
    ['/competitions/12/', 'Timetable'],
    ['/competitions/12/session/3', 'Timetable'],
    ['/competitions/12/scoring', 'Timetable'],
    ['/competitions/12/toplists', 'Toplists'],
    ['/competitions/12/chat', 'Live & stream'],
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
});
