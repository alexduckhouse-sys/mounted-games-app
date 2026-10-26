import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PageProblem } from './PageProblem';

describe('PageProblem', () => {
  it('is a heading, one sentence and two pills, with no card', () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    render(<MemoryRouter><PageProblem title="Couldn’t load this competition" primaryLabel="Try again" onPrimary={onPrimary} secondaryLabel="Go back" onSecondary={onSecondary}>Check your signal and try again.</PageProblem></MemoryRouter>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Couldn’t load this competition' })).toBeInTheDocument();
    expect(screen.getByText('Check your signal and try again.')).toBeInTheDocument();
    expect(document.querySelector('.mg-card')).toBeNull();
  });

  it('runs the first pill, and the second can be a button or a link', async () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const { rerender } = render(<MemoryRouter><PageProblem title="t" primaryLabel="Try again" onPrimary={onPrimary} secondaryLabel="Go back" onSecondary={onSecondary}>s</PageProblem></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
    rerender(<MemoryRouter><PageProblem title="t" primaryLabel="Try again" onPrimary={onPrimary} secondaryLabel="Competitions" secondaryTo="/events">s</PageProblem></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Competitions' })).toHaveAttribute('href', '/events');
  });

  it('can be just a heading and a sentence', () => {
    render(<MemoryRouter><PageProblem title="Nothing here">s</PageProblem></MemoryRouter>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
