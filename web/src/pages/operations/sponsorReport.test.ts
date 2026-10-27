import { describe, expect, it } from 'vitest';
import { buildSponsorReportRows, placeFiguresText, sponsorCsvRows } from './sponsorReport';

const admin = [
  { id: 1, name: 'Acme Feeds', tier: 0, showOn: 1 | 32, views: 40, seconds: 90, logoUrl: '/l.png', linkUrl: 'https://acme.test' },
  { id: 2, name: 'Bay Saddlery', tier: 2, showOn: 8, views: 10, seconds: 0 },
];

describe('buildSponsorReportRows', () => {
  it('does not invent a split when the API gave totals only', () => {
    const rows = buildSponsorReportRows(null, admin);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Acme Feeds', totalViews: 40, totalSeconds: 90, switchedOn: ['Timetable', 'Sponsor page'], byPlace: null });
    expect(placeFiguresText(rows[0])).toBe('Not counted by place');
  });

  it('uses the per-place figures the API counted and drops empty places', () => {
    const stats = { sponsors: [{ sponsorId: 1, sponsorName: 'Acme Feeds', tier: 0, showOn: 33, totalViews: 52, totalSeconds: 120, placements: [
      { key: 'timetable', label: 'Timetable', views: 30, seconds: 0 },
      { key: 'standings', label: 'Standings', views: 0, seconds: 0 },
      { key: 'liveStreamOverlay', label: 'Live Stream Overlay', views: 22, seconds: 120 },
      { key: 'mystery', label: 'Mystery', views: 1, seconds: 0 },
      { key: 'x', views: 2 },
      'junk',
    ] }] };
    const [row] = buildSponsorReportRows(stats, admin);
    expect(row.totalViews).toBe(52);
    expect(row.byPlace?.map((p) => p.label)).toEqual(['Timetable', 'Live video', 'Mystery', 'Other']);
    expect(placeFiguresText(row)).toBe('Timetable 30, Live video 22, Mystery 1, Other 2');
  });

  it('reads a bare list of stats, ignores bad entries and says when there are no views', () => {
    const rows = buildSponsorReportRows([{ id: 3, name: ' Cob ', placements: [] }, { id: 'x' }, null, { id: 4, name: '' }], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Cob', tierLabel: 'Headline', switchedOn: [], totalViews: 0 });
    expect(placeFiguresText(rows[0])).toBe('No views yet');
  });

  it('copes with junk input', () => {
    expect(buildSponsorReportRows({ sponsors: 'no' }, 'no')).toEqual([]);
  });

  it('orders by level then views', () => {
    const rows = buildSponsorReportRows(null, [...admin, { id: 3, name: 'Cob', tier: 0, showOn: 0, views: 99, seconds: 0 }]);
    expect(rows.map((r) => r.name)).toEqual(['Cob', 'Acme Feeds', 'Bay Saddlery']);
  });
});

describe('sponsorCsvRows', () => {
  it('writes plain-language columns', () => {
    const rows = sponsorCsvRows(buildSponsorReportRows(null, [admin[0], { id: 9, name: 'None', tier: 0, views: 0, seconds: 0 }]));
    expect(rows[0]).toEqual(['Acme Feeds', 'Headline', 40, '0h 1m 30s', 90, 'Timetable, Sponsor page', 'Not counted by place']);
    expect(rows[1][5]).toBe('Not recorded');
  });
});
