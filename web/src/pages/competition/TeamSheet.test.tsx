import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { TeamDetail } from '../../lib/toplist';
import { TeamSheet } from './TeamSheet';

const detail: TeamDetail = {
  teamId: 7,
  teamName: 'Meadow Cup Seniors 1',
  qualifyingPosition: 1,
  qualifyingPoints: 64,
  final: null,
  blocks: [{ key: 's1', kind: 'session', label: 'Session 1', points: 64, races: [{ id: 1, name: 'Bending', placing: 1, points: 8, eliminated: false, status: null }] } as never],
};

describe('TeamSheet', () => {
  it('is a kit sheet with the team name, a line about it, Full team page and Close', async () => {
    const onClose = vi.fn();
    render(<MemoryRouter><TeamSheet detail={detail} sectionName="Seniors" competitionId={4} onClose={onClose} /></MemoryRouter>);
    const dialog = screen.getByRole('dialog', { name: 'Meadow Cup Seniors 1' });
    expect(dialog).toHaveClass('kit-sheet');
    expect(dialog).toHaveAccessibleDescription('Seniors · rode 1 session');
    expect(screen.getByRole('link', { name: 'Full team page' })).toHaveAttribute('href', '/competitions/4/teams/7');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows the bib, the riders with their ponies and the scores heat by heat', () => {
    const team = { id: 7, bibDescription: 'Red with white stars' } as never;
    render(<MemoryRouter><TeamSheet detail={detail} sectionName="Seniors" competitionId={4} team={team} riders={[{ fullName: 'Ella Hughes', horseName: 'Pickle' }, { fullName: 'Sam Reid', horseName: null }]} onClose={vi.fn()} /></MemoryRouter>);
    const riders = screen.getByRole('region', { name: 'Riders and ponies' });
    expect(riders).toHaveTextContent('Ella Hughes');
    expect(riders).toHaveTextContent('Pickle');
    expect(riders).toHaveTextContent('Sam Reid');
    expect(screen.getByText('Scores, heat by heat')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Session 1' })).toHaveTextContent('Bending');
  });

  it('leaves out Full team page when there is no competition to link to', () => {
    render(<MemoryRouter><TeamSheet detail={detail} sectionName={null} onClose={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Full team page' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('links to the team page with a plain anchor outside a router', () => {
    render(<TeamSheet detail={detail} sectionName="Seniors" competitionId={4} onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Full team page' })).toHaveAttribute('href', '/competitions/4/teams/7');
  });

  it('tags a reserve rider', () => {
    render(<MemoryRouter><TeamSheet detail={detail} sectionName="Seniors" riders={[{ fullName: 'Ella Hughes', horseName: 'Pickle' }, { fullName: 'Sam Reid', horseName: 'Biscuit', isReserve: true }]} onClose={vi.fn()} /></MemoryRouter>);
    const riders = screen.getByRole('region', { name: 'Riders and ponies' });
    expect(riders.querySelectorAll('li')).toHaveLength(2);
    expect(riders.querySelectorAll('li')[1]).toHaveTextContent('Reserve');
    expect(riders.querySelectorAll('li')[0]).not.toHaveTextContent('Reserve');
  });
});
