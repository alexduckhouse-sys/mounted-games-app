import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CompetitionDetail } from '../../types';
import { EntryTools } from './EntryTools';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const open = async (isDemo: boolean) => {
  const competition = { id: 7, name: 'Spring Open', isDemo, teams: [], sections: [] } as unknown as CompetitionDetail;
  render(<MemoryRouter><EntryTools competition={competition} signups={[]} capacity={null} onChanged={vi.fn()} /></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: 'Entry tools' }));
};

describe('EntryTools on a demo event', () => {
  it('offers bank statement matching on a real event', async () => {
    await open(false);
    expect(await screen.findByText('Match a bank statement')).toBeInTheDocument();
  });

  it('hides bank statement matching on a demo event, where no bank is involved', async () => {
    await open(true);
    expect(await screen.findByText('Remind unpaid')).toBeInTheDocument();
    expect(screen.queryByText('Match a bank statement')).not.toBeInTheDocument();
  });
});
