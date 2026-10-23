import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { GlobalTabs } from './GlobalTabs';

const at = (path: string, meCount?: number) => {
  render(<MemoryRouter initialEntries={[path]}><GlobalTabs meCount={meCount} /></MemoryRouter>);
  return screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent);
};

describe('GlobalTabs', () => {
  it('links to Events, Following, Live and Me', () => {
    render(<MemoryRouter initialEntries={['/']}><GlobalTabs /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Events', '/events'], ['Following', '/following'], ['Live', '/chat'], ['Me', '/dashboard'],
    ]);
  });

  it.each([
    ['/', 'Events'], ['/events', 'Events'], ['/competitions', 'Events'], ['/competitions/past', 'Events'], ['/competitions/past/', 'Events'],
    ['/following', 'Following'], ['/chat', 'Live'],
    ['/dashboard', 'Me'], ['/teams', 'Me'], ['/me/signups', 'Me'],
  ])('lights the right tab at %s', (path, tab) => {
    expect(at(path)).toEqual([tab]);
  });

  it('lights nothing in the shop, which belongs to no tab', () => {
    expect(at('/shop')).toEqual([]);
  });

  it('counts what needs the person on the Me tab, for sighted and screen reader users', () => {
    at('/dashboard', 3);
    const me = screen.getByRole('link', { name: /Me/ });
    expect(me).toHaveTextContent('3');
    expect(me).toHaveTextContent(', 3 to do');
  });

  it('shows no count when nothing is waiting', () => {
    at('/dashboard', 0);
    expect(screen.getByRole('link', { name: 'Me' })).not.toHaveTextContent('to do');
  });
});
