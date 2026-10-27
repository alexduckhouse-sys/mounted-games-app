import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HeatBibClash } from './HeatBibClash';
import type { Heat } from '../../types';

function heat(entries: Array<Partial<Heat['entries'][number]> & { teamId: number; teamName: string }>): Heat {
  return { id: 1, entries: entries.map((e, i) => ({ id: i + 1, laneIndex: i + 1, ...e })) } as unknown as Heat;
}

describe('HeatBibClash', () => {
  it('shows nothing when bibs differ', () => {
    const { container } = render(<HeatBibClash heat={heat([{ teamId: 1, teamName: 'A', bibColour: 'red' }, { teamId: 2, teamName: 'B', bibColour: 'blue' }])} onSet={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a spare colour for the later team on a clash', async () => {
    const onSet = vi.fn().mockResolvedValue(undefined);
    render(<HeatBibClash heat={heat([{ teamId: 1, teamName: 'Alpha', bibColour: 'Red' }, { teamId: 2, teamName: 'Beta', bibColour: 'red bibs' }])} onSet={onSet} />);
    expect(screen.getByText(/Alpha and Beta both have red bibs/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use blue bibs for Beta' }));
    await waitFor(() => expect(onSet).toHaveBeenCalledWith(2, 'blue'));
  });

  it('says so when no spare colour is free', () => {
    const colours = ['red', 'blue', 'yellow', 'green', 'white', 'orange', 'purple', 'pink'];
    const entries = [...colours.map((c, i) => ({ teamId: i + 1, teamName: `T${i}`, bibColour: c })), { teamId: 99, teamName: 'Dup', bibColour: 'red' }];
    render(<HeatBibClash heat={heat(entries)} onSet={vi.fn()} />);
    expect(screen.getByText(/No spare colour is free/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lets a heat-only colour be cleared', async () => {
    const onSet = vi.fn().mockResolvedValue(undefined);
    render(<HeatBibClash heat={heat([{ teamId: 1, teamName: 'Alpha', bibColour: 'blue', bibColourOverride: 'Blue' }])} onSet={onSet} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use usual bibs' }));
    await waitFor(() => expect(onSet).toHaveBeenCalledWith(1, null));
  });
});
