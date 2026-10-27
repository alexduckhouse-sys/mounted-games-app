import { describe, expect, it } from 'vitest';
import type { SponsorAdmin, SponsorValueReport, SponsorValueReportItem } from '../types';
import {
  buildSponsorProofOfValueReport,
  buildSponsorReportCsv,
  currentItem,
  datesText,
  dateToEnd,
  endToDate,
  onBreak,
  parseSponsor,
  parseSponsorAdmin,
  sponsorReportPlacementLabel,
  sponsorReportPlacementLabels,
  startToDate,
  toSponsorValueReportItem,
} from './sponsors';
import { session } from '../test/factories';

const admin = (extra: Record<string, unknown> = {}) =>
  ({
    id: 1,
    name: 'Acme',
    linkUrl: null,
    logoUrl: null,
    tier: 0,
    sortOrder: 0,
    showOn: 0,
    isEnabled: true,
    startsAt: null,
    endsAt: null,
    views: 100,
    seconds: 3725,
    ...extra,
  }) as unknown as SponsorAdmin;

const reportItem = (extra: Record<string, unknown> = {}) =>
  ({
    sponsorId: 1,
    sponsorName: 'Acme',
    linkUrl: null,
    logoUrl: null,
    tier: 0,
    tierLabel: 'Headline',
    showOn: 4,
    placementLabels: ['Overview'],
    isEnabled: true,
    totalViews: 10,
    totalSeconds: 65,
    formattedOnScreenTime: '0h 1m 5s',
    placements: [],
    ...extra,
  }) as unknown as SponsorValueReportItem;

describe('sponsor report placement labels', () => {
  it('maps placement names and aliases to friendly labels', () => {
    expect(sponsorReportPlacementLabel(4)).toBe('Overview');
    expect(sponsorReportPlacementLabel(16)).toBe('Live Stream Overlay');
    expect(sponsorReportPlacementLabel(0)).toBe('Overview');
    expect(sponsorReportPlacementLabel(' Details ')).toBe('Overview');
    expect(sponsorReportPlacementLabel('results')).toBe('Standings');
    expect(sponsorReportPlacementLabel('standings')).toBe('Standings');
    expect(sponsorReportPlacementLabel('Timetable')).toBe('Timetable');
    for (const alias of ['stream', 'BreakStream', 'LiveStreamOverlay', 'live stream overlay', 'SponsorExposure']) {
      expect(sponsorReportPlacementLabel(alias)).toBe('Live Stream Overlay');
    }
    expect(sponsorReportPlacementLabel('SponsorPage')).toBe('Sponsor Page');
    expect(sponsorReportPlacementLabel('sponsor page')).toBe('Sponsor Page');
    expect(sponsorReportPlacementLabel('Mystery')).toBe('Mystery');
  });

  it('lists labels for a bitmask and ignores non-integers', () => {
    expect(sponsorReportPlacementLabels(1 | 32)).toEqual(['Timetable', 'Sponsor Page']);
    expect(sponsorReportPlacementLabels(1.5)).toEqual([]);
    expect(sponsorReportPlacementLabels(Number.NaN)).toEqual([]);
  });
});

describe('toSponsorValueReportItem', () => {
  it('keeps an API item as is when it is complete', () => {
    const item = reportItem();
    expect(toSponsorValueReportItem(admin(), item)).toEqual(item);
  });

  it('fills in missing labels and on-screen time on an API item', () => {
    const merged = toSponsorValueReportItem(admin({ showOn: 1 }), reportItem({ placementLabels: undefined, formattedOnScreenTime: '' }));
    expect(merged.placementLabels).toEqual(['Timetable']);
    expect(merged.formattedOnScreenTime).toBe('0h 1m 5s');
    const emptyLabels = toSponsorValueReportItem(admin({ showOn: 2 }), reportItem({ placementLabels: [] }));
    expect(emptyLabels.placementLabels).toEqual(['Standings']);
  });

  it('shares views across on-page placements and gives the stream its seconds', () => {
    const item = toSponsorValueReportItem(admin({ tier: 2, showOn: 4 | 2 | 8 }), null);
    expect(item.tierLabel).toBe('Supporter');
    const byLabel = Object.fromEntries(item.placements.map((p) => [p.label, p]));
    expect(byLabel['Overview'].views).toBe(50);
    expect(byLabel['Standings'].views).toBe(50);
    expect(byLabel['Timetable'].views).toBe(0);
    expect(byLabel['Live Stream Overlay']).toMatchObject({ views: 0, seconds: 3725, formattedOnScreenTime: '1h 2m 5s' });
    expect(item.totalSeconds).toBe(3725);
    expect(item.formattedOnScreenTime).toBe('1h 2m 5s');
  });

  it('attributes every view to the stream when it is the only placement', () => {
    const item = toSponsorValueReportItem(admin({ tier: 1, showOn: 16 }), undefined);
    expect(item.tierLabel).toBe('Major');
    expect(item.placements.find((p) => p.label === 'Live Stream Overlay')?.views).toBe(100);
  });

  it('gives a sponsor with nothing switched on empty placements and an unknown tier a default label', () => {
    const item = toSponsorValueReportItem(admin({ tier: 99, showOn: 0 }), null);
    expect(item.tierLabel).toBe('Supporter');
    expect(item.placementLabels).toEqual([]);
    expect(item.placements.every((p) => p.views === 0 && p.seconds === 0)).toBe(true);
  });
});

describe('buildSponsorProofOfValueReport', () => {
  const apiItem = reportItem({ sponsorId: 1, totalViews: 7, totalSeconds: 60 });
  const api: SponsorValueReport = {
    competitionId: 3,
    totalViews: 7,
    totalSeconds: 60,
    formattedTotalOnScreenTime: '0h 1m 0s',
    sponsors: [apiItem],
  };

  it('merges API items with the admin list by sponsor id', () => {
    const report = buildSponsorProofOfValueReport(3, [admin({ id: 1, showOn: 4 }), admin({ id: 2, name: 'Other', views: 5, seconds: 5, showOn: 0 })], api);
    expect(report.sponsors.map((s) => s.sponsorId)).toEqual([1, 2]);
    expect(report.totalViews).toBe(7 + 5);
    expect(report.totalSeconds).toBe(65);
    expect(report.formattedTotalOnScreenTime).toBe('0h 1m 5s');
  });

  it('uses the API items when there are no admin rows', () => {
    const report = buildSponsorProofOfValueReport(3, [], api);
    expect(report.sponsors).toEqual([apiItem]);
    expect(report.totalViews).toBe(7);
  });

  it('builds from the admin rows when the API report is missing or empty', () => {
    const fromNull = buildSponsorProofOfValueReport(9, [admin()], null);
    expect(fromNull).toMatchObject({ competitionId: 9, totalViews: 100, totalSeconds: 3725 });
    const fromEmpty = buildSponsorProofOfValueReport(9, [admin()], { ...api, sponsors: [] });
    expect(fromEmpty.sponsors).toHaveLength(1);
    expect(fromEmpty.sponsors[0].sponsorName).toBe('Acme');
  });
});

describe('buildSponsorReportCsv', () => {
  it('writes one row per active placement, with quoting, status and API competition id', () => {
    const csv = buildSponsorReportCsv('Cup, "2031"', [admin({ name: 'A, B', showOn: 4 | 8, isEnabled: false })]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Competition,Sponsor,Tier,Status');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Cup, ""2031"""');
    expect(lines[1]).toContain('"A, B"');
    expect(lines[1]).toContain('Disabled');
    expect(lines[1]).toContain('"Overview, Live Stream Overlay"');
    expect(lines[2]).toContain('Live Stream Overlay,0,3725,1h 2m 5s');
  });

  it('writes a "None" row for a sponsor with no placements', () => {
    const csv = buildSponsorReportCsv('Cup', [admin({ showOn: 0 })], null);
    const row = csv.split('\n')[1];
    expect(row).toContain('Active');
    expect(row).toContain(',None,');
    expect(row.endsWith(',None,0,0,0h 0m 0s')).toBe(true);
  });

  it('includes placements with views even when labels are empty, and falls back for missing time text', () => {
    const api: SponsorValueReport = {
      competitionId: 4,
      totalViews: 1,
      totalSeconds: 0,
      formattedTotalOnScreenTime: '',
      sponsors: [
        reportItem({
          showOn: 0,
          placementLabels: [],
          totalViews: 1,
          totalSeconds: 0,
          placements: [
            { key: 'overview', label: 'Overview', views: 1, seconds: 0, formattedOnScreenTime: '' },
            { key: 'standings', label: 'Standings', views: 0, seconds: 0, formattedOnScreenTime: '' },
            { key: 'liveStreamOverlay', label: 'Live Stream Overlay', views: 0, seconds: 90, formattedOnScreenTime: '' },
          ],
        }),
      ],
    };
    const csv = buildSponsorReportCsv('Cup', [], api);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(',None,'); // placement list text
    expect(lines[1].endsWith('Overview,1,0,0h 0m 0s')).toBe(true);
    expect(lines[2].endsWith('Live Stream Overlay,0,90,0h 1m 30s')).toBe(true);
  });
});

describe('sponsor parsing and date edge cases', () => {
  it('rejects malformed sponsors and admin rows', () => {
    expect(parseSponsor({ id: 1.5, name: 'x' })).toBeNull();
    expect(parseSponsor({ id: 1, name: '   ' })).toBeNull();
    expect(parseSponsor([])).toBeNull();
    expect(parseSponsorAdmin({ id: 1, name: 'ok', isEnabled: false })).toMatchObject({ isEnabled: false, views: 0, startsAt: null });
    expect(parseSponsorAdmin('nope')).toBeNull();
    expect(parseSponsorAdmin({ id: 1, name: 'ok', views: -4, seconds: Number.NaN, startsAt: 'garbage' })).toMatchObject({ views: 0, seconds: 0, startsAt: null });
  });

  it('handles empty and invalid date strings', () => {
    expect(dateToEnd('2031-5-4')).toBeNull();
    expect(startToDate(null)).toBe('');
    expect(endToDate(null)).toBe('');
    expect(endToDate(dateToEnd('2031-05-04')!)).toBe('2031-05-04');
    expect(datesText(null, null)).toBe('');
    expect(datesText(null, dateToEnd('2031-05-04'))).toMatch(/^Until 4 May 2031$/);
    expect(datesText('2031-05-01T12:00:00Z', null)).toMatch(/^From 1 May 2031$/);
  });
});

describe('currentItem and onBreak edge cases', () => {
  it('prefers a session named for the arena, falls back to the next one, and handles none', () => {
    const all = session(1, { status: 1, orderIndex: 1 });
    const named = session(2, { status: 1, orderIndex: 2, arenaName: ' Main ' });
    const upcoming = session(3, { status: 0, orderIndex: 3, arenaName: null });
    const other = session(4, { status: 1, orderIndex: 4, arenaName: 'Side' });
    expect(currentItem([all, named, other], 'Main')?.id).toBe(2);
    expect(currentItem([all, other], 'Main')?.id).toBe(1);
    expect(currentItem([upcoming, other], 'Main')?.id).toBe(3);
    expect(currentItem([session(5, { status: 2 })], 'Main')).toBeNull();
    expect(onBreak([session(6, { status: 1, kind: 2 })], 'Main')).toBe(true);
    expect(onBreak([session(7, { status: 1, isBreak: true })], 'Main')).toBe(true);
    expect(onBreak([], 'Main')).toBe(false);
  });
});
