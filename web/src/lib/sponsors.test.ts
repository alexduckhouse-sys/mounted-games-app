import { afterEach, describe, expect, it, vi } from 'vitest';
import { session, sponsor } from '../test/factories';
import {
  FRESH_ROTATION, SPONSOR_PLACEMENTS, SPONSOR_TIERS, buildSponsorProofOfValueReport, buildSponsorReportCsv, currentItem,
  datesText, dateToEnd, dateToStart, endToDate, fitWithin, formatDurationHms, groupByTier,
  hasPlacement, isHttpsLink, logoSrc, msUntilNext, onBreak, parseSponsor, parseSponsorAdmin, parseSponsorAdmins, parseSponsorControl,
  parseSponsors, placementBit, rotationIndex, shownText, skipRotation, sponsorReportPlacementLabel, sponsorReportPlacementLabels,
  sponsorStatus, sponsorsFor, startToDate, withPlacement,
} from './sponsors';

afterEach(() => { vi.unstubAllEnvs(); });

describe('sponsorStatus', () => {
  const start = '2031-05-04T09:00:00Z';
  const end = '2031-05-05T09:00:00Z';
  const now = Date.parse(start);
  it('gives disabled sponsors precedence over their dates', () => {
    expect(sponsorStatus({ isEnabled: false, startsAt: end, endsAt: null }, now)).toBe('Disabled');
    expect(sponsorStatus({ isEnabled: false, startsAt: null, endsAt: start }, now)).toBe('Disabled');
  });
  it('matches the API: inclusive start and exclusive end', () => {
    const data = { isEnabled: true, startsAt: start, endsAt: end };
    expect(sponsorStatus(data, now - 1)).toBe('Scheduled');
    expect(sponsorStatus(data, now)).toBe('Active');
    expect(sponsorStatus(data, Date.parse(end) - 1)).toBe('Active');
    expect(sponsorStatus(data, Date.parse(end))).toBe('Expired');
  });
  it('supports open-ended schedules and offsets', () => {
    expect(sponsorStatus({ isEnabled: true, startsAt: null, endsAt: null }, now)).toBe('Active');
    expect(sponsorStatus({ isEnabled: true, startsAt: null, endsAt: start }, now)).toBe('Expired');
    expect(sponsorStatus({ isEnabled: true, startsAt: end, endsAt: null }, now)).toBe('Scheduled');
    expect(sponsorStatus({ isEnabled: true, startsAt: '2031-05-04T10:00:00+01:00', endsAt: null }, now)).toBe('Active');
  });
  it('can use the current time for a fresh render', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(sponsorStatus({ isEnabled: true, startsAt: start, endsAt: end })).toBe('Active');
    clock.mockRestore();
  });
});

describe('the placement registry', () => {
  it('gives each place its own single bit, a label and a description', () => {
    const bits = SPONSOR_PLACEMENTS.map((p) => p.placement);
    expect(new Set(bits).size).toBe(bits.length);
    for (const place of SPONSOR_PLACEMENTS) {
      expect(Math.log2(place.placement) % 1).toBe(0);
      expect(place.label).not.toBe('');
      expect(place.description).not.toBe('');
    }
  });

  it('switches places on and off in a set', () => {
    expect(placementBit('Results')).toBe(2);
    expect(hasPlacement(3, 'Timetable')).toBe(true);
    expect(hasPlacement(3, 'Details')).toBe(false);
    expect(withPlacement(0, 'Details', true)).toBe(4);
    expect(withPlacement(7, 'Results', false)).toBe(5);
    expect(withPlacement(5, 'Details', true)).toBe(5);
  });
});

describe('ordering', () => {
  const list = [
    sponsor(1, { tier: 2, sortOrder: 0 }), sponsor(2, { tier: 0, sortOrder: 5 }), sponsor(3, { tier: 1, sortOrder: 1 }),
    sponsor(4, { tier: 1, sortOrder: 0 }), sponsor(5, { tier: 0, sortOrder: 5, showOn: 1 }),
  ];

  it('puts the headline tier first, then the organiser’s order, for one place', () => {
    expect(sponsorsFor(list, 'Results').map((s) => s.id)).toEqual([2, 4, 3, 1]);
    expect(sponsorsFor(list, 'Timetable').map((s) => s.id)).toEqual([2, 5, 4, 3, 1]);
    expect(sponsorsFor([], 'Stream')).toEqual([]);
  });

  it('groups by tier and leaves out empty ones', () => {
    expect(groupByTier(list.filter((s) => s.tier !== 1)).map((g) => [g.label, g.sponsors.map((s) => s.id)])).toEqual([['Headline', [2, 5]], ['Supporter', [1]]]);
    expect(SPONSOR_TIERS.map((t) => t.label)).toEqual(['Headline', 'Major', 'Supporter']);
  });
});

describe('links and logos', () => {
  it('accepts only https links', () => {
    expect(isHttpsLink('https://example.com/a')).toBe(true);
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'example.com', '', null, 7]) expect(isHttpsLink(bad)).toBe(false);
  });

  it('puts the API’s own address in front of a logo path when the build has one', () => {
    expect(logoSrc('/api/competitions/1/sponsors/2/logo?v=1')).toBe('/api/competitions/1/sponsors/2/logo?v=1');
    expect(logoSrc('/api/competitions/1/sponsors/2/logo?v=1', '/api')).toBe('/api/competitions/1/sponsors/2/logo?v=1');
    expect(logoSrc('/api/competitions/1/sponsors/2/logo?v=1', 'https://api.example.com/api')).toBe('https://api.example.com/api/competitions/1/sponsors/2/logo?v=1');
  });

  it('shrinks to fit without enlarging or distorting', () => {
    expect(fitWithin(2000, 1000, 512)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(500, 1000, 512)).toEqual({ width: 256, height: 512 });
    expect(fitWithin(300, 200, 512)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(10000, 1, 512)).toEqual({ width: 512, height: 1 });
  });
});

describe('reading the API', () => {
  const good = { id: 4, name: 'Acme', linkUrl: 'https://acme.example', logoUrl: '/api/competitions/1/sponsors/4/logo?v=2', tier: 2, sortOrder: 3, showOn: 17 };

  it('keeps a good sponsor as it is', () => {
    expect(parseSponsor(good)).toEqual(good);
  });

  it('drops unsafe links and logos from anywhere else, and fills gaps', () => {
    expect(parseSponsor({ ...good, linkUrl: 'javascript:alert(1)', logoUrl: 'https://evil.example/logo.png', tier: 9, sortOrder: 'x', showOn: null }))
      .toEqual({ ...good, linkUrl: null, logoUrl: null, tier: 0, sortOrder: 0, showOn: 0 });
    expect(parseSponsor({ ...good, logoUrl: '/api/competitions/1/sponsors/4/logo' })!.logoUrl).toBe('/api/competitions/1/sponsors/4/logo');
    expect(parseSponsor({ ...good, logoUrl: '/api/competitions/1/sponsors/4/logo?v=2&x=<script>' })!.logoUrl).toBeNull();
  });

  it('skips sponsors that are not sponsors, and a web page where a list should be', () => {
    expect(parseSponsor(null)).toBeNull();
    expect(parseSponsor({ ...good, id: 'x' })).toBeNull();
    expect(parseSponsor({ ...good, name: '  ' })).toBeNull();
    expect(parseSponsor({ ...good, name: 4 })).toBeNull();
    expect(parseSponsors([good, 'x', { id: 1 }])).toEqual([good]);
    expect(parseSponsors('<!doctype html>')).toEqual([]);
    expect(parseSponsorAdmins({})).toEqual([]);
  });

  it('reads the organiser fields', () => {
    expect(parseSponsorAdmin({ ...good, isEnabled: false, startsAt: '2026-11-01T00:00:00Z', endsAt: 'nonsense', views: 12, seconds: -4 }))
      .toEqual({ ...good, isEnabled: false, startsAt: '2026-11-01T00:00:00Z', endsAt: null, views: 12, seconds: 0 });
    expect(parseSponsorAdmin({ ...good })).toMatchObject({ isEnabled: true, startsAt: null, views: 0 });
    expect(parseSponsorAdmin(7)).toBeNull();
    expect(parseSponsorAdmin({ id: 1 })).toBeNull();
    expect(parseSponsorAdmins([{ ...good }, 3])).toHaveLength(1);
  });

  it('understands the skip instruction and nothing else', () => {
    expect(parseSponsorControl({ action: 'skip' })).toBe('skip');
    expect(parseSponsorControl({ action: 'delete' })).toBeNull();
    expect(parseSponsorControl(null)).toBeNull();
    expect(parseSponsorControl([])).toBeNull();
  });
});

describe('dates', () => {
  it('turns a date box into the first moment, or the end, of that day in the device’s zone', () => {
    const start = new Date(dateToStart('2026-11-03')!);
    const end = new Date(dateToEnd('2026-11-03')!);
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 10, 3, 0]);
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours()]).toEqual([2026, 10, 4, 0]);
    expect(dateToStart('3 Nov')).toBeNull();
    expect(dateToEnd('')).toBeNull();
  });

  it('turns them back into the same date', () => {
    expect(startToDate(dateToStart('2026-12-31'))).toBe('2026-12-31');
    expect(endToDate(dateToEnd('2026-12-31'))).toBe('2026-12-31');
    expect(startToDate(null)).toBe('');
    expect(endToDate(null)).toBe('');
  });

  it('says the dates in words', () => {
    const from = dateToStart('2026-11-01');
    const to = dateToEnd('2026-11-03');
    expect(datesText(from, to)).toBe('1 Nov 2026 to 3 Nov 2026');
    expect(datesText(from, null)).toBe('From 1 Nov 2026');
    expect(datesText(null, to)).toBe('Until 3 Nov 2026');
    expect(datesText(null, null)).toBe('');
  });
});

describe('breaks', () => {
  const race = (id: number, extra = {}) => session(id, { kind: 0, ...extra });
  const brk = (id: number, extra = {}) => session(id, { kind: 1, isBreak: true, ...extra });

  it('is on the session running in the arena, otherwise the next one to run', () => {
    expect(currentItem([race(1, { status: 2 }), brk(2, { status: 0 }), race(3, { status: 0 })], 'Arena 1')!.id).toBe(2);
    expect(currentItem([race(1, { status: 1 }), brk(2, { status: 0 })], 'Arena 1')!.id).toBe(1);
    expect(currentItem([race(1, { status: 2 })], 'Arena 1')).toBeNull();
    expect(currentItem([], 'Arena 1')).toBeNull();
  });

  it('looks only at this arena’s sessions and the ones with no arena', () => {
    const sessions = [race(1, { status: 1, arenaName: 'Arena 2' }), brk(2, { status: 0, arenaName: ' Arena 1 ' }), brk(3, { status: 0 })];
    expect(currentItem(sessions, 'Arena 1')!.id).toBe(2);
    expect(currentItem(sessions, 'Arena 2')!.id).toBe(1);
    expect(currentItem(sessions, 'Arena 3')!.id).toBe(3);
  });

  it('prefers the arena’s own running session to one for every arena', () => {
    const sessions = [brk(1, { status: 1 }), race(2, { status: 1, arenaName: 'Arena 1' })];
    expect(currentItem(sessions, 'Arena 1')!.id).toBe(2);
    expect(currentItem(sessions, 'Arena 2')!.id).toBe(1);
  });

  it('counts breaks and briefings, not races or custom items', () => {
    expect(onBreak([brk(1, { status: 1 })], 'A')).toBe(true);
    expect(onBreak([session(1, { kind: 2, isBreak: false, status: 1 })], 'A')).toBe(true);
    expect(onBreak([session(1, { kind: 0, isBreak: true, status: 1 })], 'A')).toBe(true);
    expect(onBreak([session(1, { kind: 3, isBreak: false, status: 1 })], 'A')).toBe(false);
    expect(onBreak([race(1, { status: 1 })], 'A')).toBe(false);
    expect(onBreak([], 'A')).toBe(false);
  });
});

describe('rotation', () => {
  it('follows the clock, so every viewer agrees', () => {
    expect([0, 7_999, 8_000, 16_000, 24_000].map((now) => rotationIndex(now, FRESH_ROTATION, 8_000, 3))).toEqual([0, 0, 1, 2, 0]);
    expect(rotationIndex(5, FRESH_ROTATION, 8_000, 0)).toBe(-1);
    expect(msUntilNext(3_000, FRESH_ROTATION, 8_000)).toBe(5_000);
  });

  it('moves on at once when skipped, and gives the next one a full turn', () => {
    const skipped = skipRotation(FRESH_ROTATION, 10_000, 8_000, 3);
    expect(rotationIndex(10_000, skipped, 8_000, 3)).toBe(2);
    expect(rotationIndex(17_999, skipped, 8_000, 3)).toBe(2);
    expect(rotationIndex(18_000, skipped, 8_000, 3)).toBe(0);
    expect(msUntilNext(10_000, skipped, 8_000)).toBe(8_000);
    expect(skipRotation(FRESH_ROTATION, 10_000, 8_000, 0)).toBe(FRESH_ROTATION);
  });
});

describe('shownText', () => {
  it('counts times and minutes on video', () => {
    expect(shownText(0, 0)).toBe('Shown 0 times');
    expect(shownText(1, 59)).toBe('Shown 1 time');
    expect(shownText(1234, 600)).toBe('Shown 1,234 times · 10 min on video');
  });
});

describe('sponsor proof-of-value report & CSV', () => {
  it('formats live stream on-screen time as Xh Ym Zs', () => {
    expect(formatDurationHms(0)).toBe('0h 0m 0s');
    expect(formatDurationHms(-15)).toBe('0h 0m 0s');
    expect(formatDurationHms(125)).toBe('0h 2m 5s');
    expect(formatDurationHms(4530)).toBe('1h 15m 30s');
  });

  it('replaces raw enum names and bitmasks with human-friendly placement labels', () => {
    expect(sponsorReportPlacementLabel('SponsorExposure')).toBe('Live Stream Overlay');
    expect(sponsorReportPlacementLabel('Details')).toBe('Overview');
    expect(sponsorReportPlacementLabel('Results')).toBe('Standings');
    expect(sponsorReportPlacementLabel('Timetable')).toBe('Timetable');
    expect(sponsorReportPlacementLabel('SponsorPage')).toBe('Sponsor Page');
    expect(sponsorReportPlacementLabel('Replays')).toBe('Live Stream Overlay');
    expect(sponsorReportPlacementLabel(64)).toBe('Live Stream Overlay');
    expect(sponsorReportPlacementLabels(64)).toEqual(['Live Stream Overlay']);
    expect(sponsorReportPlacementLabel(4)).toBe('Overview');
    expect(sponsorReportPlacementLabel(2)).toBe('Standings');
    expect(sponsorReportPlacementLabels(1 | 2 | 4 | 8 | 32)).toEqual([
      'Overview',
      'Standings',
      'Timetable',
      'Live Stream Overlay',
      'Sponsor Page',
    ]);
  });

  it('builds a proof-of-value summary and CSV with Views (Impressions) and Xh Ym Zs on-screen time per sponsor and per placement', () => {
    const admins = [
      {
        ...sponsor(1, { name: 'Baileys Horse Feeds', tier: 0, showOn: 4 | 2 | 8 }),
        isEnabled: true,
        startsAt: null,
        endsAt: null,
        views: 420,
        seconds: 3725,
      },
    ];
    const report = buildSponsorProofOfValueReport(7, admins, null);
    expect(report.totalViews).toBe(420);
    expect(report.totalSeconds).toBe(3725);
    expect(report.formattedTotalOnScreenTime).toBe('1h 2m 5s');
    expect(report.sponsors[0].placementLabels).toEqual(['Overview', 'Standings', 'Live Stream Overlay']);

    const csv = buildSponsorReportCsv('Spring Championships', admins, null);
    expect(csv).not.toContain('SponsorExposure');
    expect(csv).toContain('Total Views (Impressions)');
    expect(csv).toContain('Live Stream On-Screen Time');
    expect(csv).toContain('Baileys Horse Feeds');
    expect(csv).toContain('1h 2m 5s');
    expect(csv).toContain('Overview');
    expect(csv).toContain('Standings');
    expect(csv).toContain('Live Stream Overlay');
  });
});
