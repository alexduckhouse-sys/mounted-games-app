import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EliminationSheet, NextLanesCard, ScoreClashBanner, type ScoreClashItem } from './ScoringParts';

const clash = (raceId: number, raceOrder: number): ScoreClashItem => ({
  raceId, raceName: `Game ${raceOrder}`, raceOrder,
  existingPlaces: [{ teamId: 1, place: 1, eliminated: false }, { teamId: 2, place: 2, eliminated: false }],
  incomingPlaces: [{ teamId: 2, place: 1, eliminated: false }, { teamId: 1, place: 2, eliminated: false }],
});
const names = { 1: 'Oak A', 2: 'Beech B' };

describe('ScoreClashBanner', () => {
  it('shows nothing without a clash', () => {
    const { container } = render(<ScoreClashBanner clashes={[]} teamNamesById={names} onResolve={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks which of two results to keep in a sheet that has to be answered', async () => {
    const onResolve = vi.fn();
    render(<ScoreClashBanner clashes={[clash(7, 2)]} teamNamesById={names} onResolve={onResolve} />);
    const sheet = screen.getByRole('dialog', { name: 'Two results for Race 2' });
    expect(sheet).toHaveAccessibleDescription('Two scorers sent different placings. Tap the right one.');
    expect(within(sheet).getByText('Result A (Saved)')).toBeInTheDocument();
    expect(within(sheet).getByText('Result B (Submitted)')).toBeInTheDocument();
    expect(sheet.innerHTML).not.toMatch(/amber/);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Keep result B' }));
    expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ raceId: 7 }), true);
  });

  it('keeps result A and says when more races are waiting', async () => {
    const onResolve = vi.fn();
    render(<ScoreClashBanner clashes={[clash(7, 2), clash(8, 3)]} teamNamesById={names} onResolve={onResolve} />);
    expect(screen.getByText('1 more race is waiting after this one.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep result A' }));
    expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ raceId: 7 }), false);
  });
});

describe('NextLanesCard', () => {
  const lanes = (provisional: boolean) => ({ title: 'Lanes for Final', note: 'Not final yet.', provisional, rows: [] });

  it('puts a provisional note in an information strip', () => {
    render(<NextLanesCard lanes={lanes(true)} />);
    expect(screen.getByRole('status')).toHaveClass('kit-strip-info');
    expect(screen.getByRole('status')).toHaveTextContent('Not final yet.');
  });

  it('leaves a settled note as plain text', () => {
    render(<NextLanesCard lanes={lanes(false)} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Not final yet.')).toBeInTheDocument();
  });
});

describe('EliminationSheet focus', () => {
  it('takes focus, closes on Escape and gives focus back', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onCancel = vi.fn();
    const { unmount } = render(
      <EliminationSheet places={[{ teamId: 1, place: 1, eliminated: true } as never]} names={{ 1: 'Oak A' }} onSave={vi.fn()} onSkip={vi.fn()} onCancel={onCancel} />,
    );
    const sheet = screen.getByRole('dialog', { name: 'Why were teams eliminated?' });
    expect(sheet.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
