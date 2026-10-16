import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { RulebooksPage } from './RulebooksPage';

vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition: { id: 7, createdByUserId: 'owner' } }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canEdit: () => true, canOrganise: () => true, hasRole: () => true }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

describe('RulebooksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: [{ id: 2, competitionId: 7, title: 'Event handbook', edition: '2030', sourceUrl: null, text: 'Keep the changeover clear.', updatedAt: '2030-01-01T00:00:00Z' }] });
  });

  it('shows the selected public rulebook', async () => {
    render(<RulebooksPage />);
    expect(await screen.findByRole('heading', { name: 'Event handbook' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText('Keep the changeover clear.')).toBeInTheDocument();
  });

  it('opens an organiser editor with plain-text fields', async () => {
    const user = userEvent.setup();
    render(<RulebooksPage />);
    await screen.findByText('Keep the changeover clear.', {}, { timeout: 10_000 });
    await user.click(screen.getByRole('button', { name: 'Add rulebook' }));
    expect(screen.getByRole('heading', { name: 'New rulebook' })).toBeInTheDocument();
    expect(screen.getByLabelText('Rulebook text')).toBeInTheDocument();
  });
});
