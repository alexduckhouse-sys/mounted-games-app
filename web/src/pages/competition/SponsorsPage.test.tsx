import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as exposure from '../../lib/sponsorExposure';
import { competition, sponsor } from '../../test/factories';
import type { Sponsor } from '../../types';
import { CompetitionContext } from './context';
import { SponsorsPage } from './SponsorsPage';

vi.mock('../../lib/sponsorExposure', () => ({ recordSponsorView: vi.fn(), recordSponsorSeconds: vi.fn() }));

const show = (sponsors: Sponsor[]) => render(
  <MemoryRouter>
    <CompetitionContext.Provider value={{ competition: competition({ id: 6 }), reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [], sponsors }}>
      <SponsorsPage />
    </CompetitionContext.Provider>
  </MemoryRouter>,
);

beforeEach(() => { vi.mocked(exposure.recordSponsorView).mockClear(); });

describe('SponsorsPage', () => {
  it('lists the sponsors by tier, headline first, each with its link', () => {
    show([
      sponsor(1, { name: 'Small Co', tier: 2, linkUrl: 'https://small.example' }), sponsor(2, { name: 'Big Co', tier: 0 }),
      sponsor(3, { name: 'Mid Co', tier: 1 }), sponsor(4, { name: 'Not here', showOn: 7 }),
    ]);
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual(['Headline', 'Major', 'Supporter']);
    expect(within(screen.getByRole('region', { name: 'Headline' })).getByText('Big Co')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Small Co' })).toHaveAttribute('href', 'https://small.example');
    expect(screen.queryByText('Not here')).toBeNull();
    expect(exposure.recordSponsorView).toHaveBeenCalledWith(6, 2, 'SponsorPage');
    expect(exposure.recordSponsorView).toHaveBeenCalledTimes(3);
  });

  it('says so when there is nobody to show', () => {
    show([]);
    expect(screen.getByText('No sponsors to show yet.')).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
  });
});
