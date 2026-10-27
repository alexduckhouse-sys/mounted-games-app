import { describe, expect, it } from 'vitest';
import { sponsor } from '../test/factories';
import type { SponsorAdmin, SponsorValueReport, SponsorValueReportItem } from '../types';
import {
  buildSponsorProofOfValueReport, buildSponsorReportCsv, formatDurationHms,
  sponsorReportPlacementLabel, sponsorReportPlacementLabels, toSponsorValueReportItem,
} from './sponsors';

const admin = (id: number, extra: Partial<SponsorAdmin> = {}): SponsorAdmin => ({
  ...sponsor(id), isEnabled: true, startsAt: null, endsAt: null, views: 12, seconds: 65, ...extra,
});
const report = (items: SponsorValueReportItem[]): SponsorValueReport => ({
  competitionId: 7, totalViews: 999, totalSeconds: 999,
  formattedTotalOnScreenTime: 'stale total', sponsors: items,
});

describe('sponsor report compatibility and exports', () => {
  it('normalises older placement aliases and preserves unknown future placement names', () => {
    for (const label of ['stream', 'breakstream', 'livestreamoverlay', 'live stream overlay']) {
      expect(sponsorReportPlacementLabel(label)).toBe('Live Stream Overlay');
    }
    expect(sponsorReportPlacementLabel(' Sponsor Page ')).toBe('Sponsor Page');
    expect(sponsorReportPlacementLabel('Future placement')).toBe('Future placement');
    expect(sponsorReportPlacementLabel(128)).toBe('Overview');
    expect(sponsorReportPlacementLabels(Number.NaN)).toEqual([]);
    expect(formatDurationHms(Number.POSITIVE_INFINITY)).toBe('0h 0m 0s');
  });

  it('attributes all impressions to a stream-only sponsor and none to disabled placements', () => {
    const item = toSponsorValueReportItem(admin(1, { showOn: 16 }));
    expect(item.placementLabels).toEqual(['Live Stream Overlay']);
    expect(item.placements.find(p => p.key === 'liveStreamOverlay')).toMatchObject({ views: 12, seconds: 65 });
    expect(item.placements.filter(p => p.key !== 'liveStreamOverlay').every(p => p.views === 0 && p.seconds === 0)).toBe(true);
    const noStream = toSponsorValueReportItem(admin(2, { showOn: 4 }));
    expect(noStream.placements.find(p => p.key === 'liveStreamOverlay')).toMatchObject({ views: 0, seconds: 0 });
  });

  it('keeps authoritative API counts and labels, filling only omitted display fields', () => {
    const source = admin(1, { showOn: 4 });
    const apiItem = { ...toSponsorValueReportItem(source), totalViews: 80, totalSeconds: 3661,
      placementLabels: ['Sponsor Page'], formattedOnScreenTime: '1h 1m 1s' };
    expect(toSponsorValueReportItem(source, apiItem)).toEqual(apiItem);
    expect(toSponsorValueReportItem(source, { ...apiItem, placementLabels: [], formattedOnScreenTime: '' }))
      .toMatchObject({ totalViews: 80, placementLabels: ['Overview'], formattedOnScreenTime: '1h 1m 1s' });
  });

  it('merges current sponsors with API reports and recalculates totals from the included sponsors', () => {
    const source = admin(1, { views: 12, seconds: 65 });
    const second = admin(2, { views: 3, seconds: 5 });
    const apiItem = { ...toSponsorValueReportItem(source), totalViews: 80, totalSeconds: 120 };
    const apiReport = report([apiItem, toSponsorValueReportItem(admin(99))]);
    const merged = buildSponsorProofOfValueReport(7, [source, second], apiReport);
    expect(merged.sponsors.map(item => item.sponsorId)).toEqual([1, 2]);
    expect(merged).toMatchObject({ totalViews: 83, totalSeconds: 125, formattedTotalOnScreenTime: '0h 2m 5s' });
    const reportOnly = buildSponsorProofOfValueReport(7, [], report([apiItem]));
    expect(reportOnly).toMatchObject({ sponsors: [apiItem], totalViews: 80, totalSeconds: 120 });
    expect(buildSponsorProofOfValueReport(7, [second], report([])).totalViews).toBe(3);
  });

  it('exports a disabled sponsor with no placements as one correctly escaped row', () => {
    const csv = buildSponsorReportCsv('Test "Show", North', [admin(1, {
      name: 'Example, Supplies', tier: 0, isEnabled: false, showOn: 0, views: 0, seconds: 0,
    })]);
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toContain('"Test ""Show"", North","Example, Supplies",Headline,Disabled,None,0,0,0h 0m 0s,None,0,0,0h 0m 0s');
  });

  it('retains historical placement activity even when that placement is no longer enabled', () => {
    const source = admin(1, { showOn: 0 });
    const item = { ...toSponsorValueReportItem(source), placements: [
      { key: 'overview', label: 'Overview', views: 4, seconds: 0, formattedOnScreenTime: '' },
      { key: 'liveStreamOverlay', label: 'Live Stream Overlay', views: 0, seconds: 61, formattedOnScreenTime: '' },
      { key: 'standings', label: 'Standings', views: 0, seconds: 0, formattedOnScreenTime: '' },
    ] };
    const csv = buildSponsorReportCsv('Example Show', [source], report([item]));
    expect(csv.split('\n')).toHaveLength(3);
    expect(csv).toContain(',Overview,4,0,0h 0m 0s');
    expect(csv).toContain(',Live Stream Overlay,0,61,0h 1m 1s');
    expect(csv).not.toContain(',Standings,');
  });
});
