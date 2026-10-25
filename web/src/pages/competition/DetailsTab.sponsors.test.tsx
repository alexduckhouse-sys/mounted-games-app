import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, sponsor } from '../../test/factories';
import type { Sponsor } from '../../types';
import { CompetitionContext } from './context';
import { DetailsTab } from './DetailsTab';

const auth = vi.hoisted(() => ({ organiser: false }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../lib/sponsorExposure', () => ({ recordSponsorView: vi.fn(), recordSponsorSeconds: vi.fn() }));
vi.mock('../commerce/DemoEntryPayment', () => ({ DemoEntryPayment: () => null }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1' }, canEdit: () => false, canManage: () => false, canOrganise: () => auth.organiser, hasRole: () => false, refreshAccess: vi.fn(),
  }),
}));

function show(sponsors: Sponsor[]) {
  return render(
    <MemoryRouter initialEntries={['/competitions/5/details']}>
      <CompetitionContext.Provider value={{ competition: competition({ id: 5, name: 'Spring Games' }), reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [], sponsors }}>
        <Routes><Route path="/competitions/:id"><Route path="details" element={<DetailsTab />} /></Route></Routes>
      </CompetitionContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.organiser = false;
  vi.mocked(api.get).mockResolvedValue({ data: [] } as never);
});

describe('sponsors on the details page', () => {
  it('shows all sponsors for Details and the sponsor page grouped by tier directly on Details', () => {
    show([
      sponsor(1, { name: 'Details Co', tier: 2, showOn: 4 }),
      sponsor(2, { name: 'Page Co', tier: 0, showOn: 32 }),
    ]);
    const section = screen.getByRole('region', { name: 'Our sponsors' });
    expect(within(within(section).getByRole('group', { name: 'Headline' })).getByText('Page Co')).toBeInTheDocument();
    expect(within(within(section).getByRole('group', { name: 'Supporter' })).getByText('Details Co')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sponsors' })).toBeNull();
  });

  it('leaves out the sponsors section when there is nothing to show', () => {
    show([sponsor(1, { showOn: 1 })]);
    expect(screen.queryByRole('link', { name: 'Sponsors' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Our sponsors' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Sponsors' })).toBeNull();
  });

  it('leaves sponsor management to the Sponsors and sharing page, even for organisers', async () => {
    auth.organiser = true;
    show([]);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: 'Sponsors' })).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith('/competitions/5/sponsors/manage');
  });
});
