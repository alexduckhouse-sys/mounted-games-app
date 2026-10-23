import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompetitionContext, type CompetitionCtx } from '../pages/competition/context';
import * as exposure from '../lib/sponsorExposure';
import { competition, sponsor } from '../test/factories';
import { SponsorStrip } from './SponsorStrip';

vi.mock('../lib/sponsorExposure', () => ({ recordSponsorView: vi.fn(), recordSponsorSeconds: vi.fn() }));

function show(sponsors: ReturnType<typeof sponsor>[] | undefined, placement: 'Timetable' | 'Results' = 'Timetable') {
  const value: CompetitionCtx = {
    competition: competition({ id: 9 }), reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [], sponsors,
  };
  return render(<CompetitionContext.Provider value={value}><SponsorStrip placement={placement} /></CompetitionContext.Provider>);
}

beforeEach(() => { vi.mocked(exposure.recordSponsorView).mockClear(); });

describe('SponsorStrip', () => {
  it('lists the sponsors set for its place, headline first and larger', () => {
    show([sponsor(1, { name: 'Small', tier: 2 }), sponsor(2, { name: 'Big', tier: 0 }), sponsor(3, { name: 'Elsewhere', showOn: 2 })]);
    expect(screen.getByRole('region', { name: 'Our sponsors' })).toBeInTheDocument();
    const names = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(names).toEqual(['Big', 'Small']);
    expect(screen.getByText('Big').closest('.mg-sponsor')).toHaveClass('mg-sponsor-large');
    expect(screen.getByText('Small').closest('.mg-sponsor')).not.toHaveClass('mg-sponsor-large');
  });

  it('counts one view for each sponsor shown, in this place', () => {
    show([sponsor(1), sponsor(2)], 'Timetable');
    expect(exposure.recordSponsorView).toHaveBeenCalledTimes(2);
    expect(exposure.recordSponsorView).toHaveBeenCalledWith(9, 1, 'Timetable');
    expect(exposure.recordSponsorView).toHaveBeenCalledWith(9, 2, 'Timetable');
  });

  it('draws nothing, and counts nothing, when no sponsor is set for the place', () => {
    const { container } = show([sponsor(1, { showOn: 4 })]);
    expect(container).toBeEmptyDOMElement();
    expect(exposure.recordSponsorView).not.toHaveBeenCalled();
    const outside = render(<SponsorStrip placement="Results" />);
    expect(outside.container).toBeEmptyDOMElement();
    expect(show(undefined).container.querySelector('section')).toBeNull();
  });
});
