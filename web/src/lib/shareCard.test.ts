import { describe, expect, it } from 'vitest';
import {
  competitionCard, dateText, escapeHtml, genericCard, isPreviewCrawler, readCompetition, readTeamProfile,
  renderCardPage, shareApiPath, sharePageFor, teamProfileCard, tidy,
} from './shareCard';

const ORIGIN = 'https://mg.example';
const HOSTILE = '"><script>alert(1)</script>';

describe('isPreviewCrawler', () => {
  it.each([
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0 A',
    'Twitterbot/1.0',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'Slackbot-LinkExpanding 1.0',
    'Mozilla/5.0 (Macintosh) AppleWebKit/600.2.5 Version/8.0.2 Safari/600.2.5 (Applebot/0.1)',
  ])('recognises %s', (ua) => expect(isPreviewCrawler(ua)).toBe(true));

  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    '', null, undefined,
  ])('leaves %s to the app', (ua) => expect(isPreviewCrawler(ua)).toBe(false));
});

describe('sharePageFor', () => {
  it('finds a competition and its tabs', () => {
    expect(sharePageFor('/competitions/12')).toEqual({ kind: 'competition', id: '12' });
    expect(sharePageFor('/competitions/12/')).toEqual({ kind: 'competition', id: '12' });
    expect(sharePageFor('/competitions/12/scoring')).toEqual({ kind: 'competition', id: '12' });
    expect(sharePageFor('/competitions/12/session/4')).toEqual({ kind: 'competition', id: '12' });
  });

  it('finds a team profile and lower-cases its id', () => {
    expect(sharePageFor('/team-profiles/3F2504E0-4F89-11D3-9A0C-0305E82C3301'))
      .toEqual({ kind: 'team-profile', id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' });
  });

  it('gives the home and list pages the generic card', () => {
    for (const path of ['/', '/events', '/competitions', '/competitions/past', '/competitions/', '/seasons', '/stats', '/shop']) {
      expect(sharePageFor(path)).toEqual({ kind: 'generic' });
    }
  });

  it('ignores everything else, including ids that could carry markup or traversal', () => {
    for (const path of ['/login', '/competitions/abc', '/competitions/1234567890', '/competitions/1/../2x', '/competitions/1/<script>',
      '/team-profiles', '/team-profiles/not-a-guid', '/team-profiles/3f2504e0-4f89-11d3-9a0c-0305e82c3301/extra', '/seasons/1']) {
      expect(sharePageFor(path)).toBeNull();
    }
  });
});

describe('shareApiPath', () => {
  it('points at the public card endpoints', () => {
    expect(shareApiPath({ kind: 'competition', id: '7' })).toBe('/api/share/competitions/7');
    expect(shareApiPath({ kind: 'team-profile', id: 'abc' })).toBe('/api/share/team-profiles/abc');
    expect(shareApiPath({ kind: 'generic' })).toBeNull();
  });
});

describe('text helpers', () => {
  it('escapes every character that can break out of markup or a quoted attribute', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&\`</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;&lt;/a&gt;');
    expect(escapeHtml('plain text')).toBe('plain text');
  });

  it('flattens line breaks and control characters, then shortens on a character boundary', () => {
    expect(tidy('a\nb\r\n\tc\u0000d', 50)).toBe('a b c d');
    expect(tidy(null, 10)).toBe('');
    expect(tidy('x'.repeat(20), 10)).toBe(`${'x'.repeat(9)}…`);
    // An emoji is two UTF-16 units; it must not be cut in half.
    expect(tidy('😀'.repeat(6), 4)).toBe('😀😀😀…');
  });

  it('writes dates in UK style and zone', () => {
    expect(dateText('2026-10-17T08:00:00Z', null)).toBe('Saturday 17 October 2026');
    expect(dateText('2026-10-17T08:00:00Z', '2026-10-17T16:00:00Z')).toBe('Saturday 17 October 2026');
    expect(dateText('2026-10-17T08:00:00Z', '2026-10-18T16:00:00Z')).toBe('Saturday 17 October 2026 to Sunday 18 October 2026');
    // 23:30 UTC on 16 June is already 00:30 on the 17th in London.
    expect(dateText('2026-06-16T23:30:00Z', null)).toBe('Wednesday 17 June 2026');
    expect(dateText('2026-10-18T08:00:00Z', '2026-10-17T08:00:00Z')).toBe('Sunday 18 October 2026');
    expect(dateText('nonsense', null)).toBe('');
    expect(dateText('2026-10-17T08:00:00Z', 'nonsense')).toBe('Saturday 17 October 2026');
  });
});

describe('cards', () => {
  const comp = { name: 'Spring Games', startDate: '2026-10-17T08:00:00Z', endDate: null, location: 'Tatton Park', teamCount: 12 };

  it('describes a competition by name, date, venue and size', () => {
    const card = competitionCard(comp, ORIGIN, '12');
    expect(card).toEqual({
      title: 'Spring Games',
      description: 'Saturday 17 October 2026 at Tatton Park. 12 teams entered. Timetable, live scores and results.',
      url: `${ORIGIN}/competitions/12`,
      image: `${ORIGIN}/og/mounted-games.png`,
    });
  });

  it('copes with a missing venue, no teams and one team', () => {
    expect(competitionCard({ ...comp, location: null, teamCount: 0 }, ORIGIN, '1').description)
      .toBe('Saturday 17 October 2026. Timetable, live scores and results.');
    expect(competitionCard({ ...comp, teamCount: 1 }, ORIGIN, '1').description).toContain('1 team entered.');
    expect(competitionCard({ ...comp, startDate: 'bad', location: null, teamCount: Number.NaN }, ORIGIN, '1').description)
      .toBe('Timetable, live scores and results.');
  });

  it('falls back to the site name when the title is blank', () => {
    expect(competitionCard({ ...comp, name: '  \n ' }, ORIGIN, '1').title).toBe('Mounted Games');
    expect(teamProfileCard({ displayName: '', clubName: '', eventCount: 0 }, ORIGIN, 'x').title).toBe('Mounted Games');
  });

  it('describes a team profile', () => {
    expect(teamProfileCard({ displayName: 'Cheshire A', clubName: 'Cheshire Pony Club', eventCount: 3 }, ORIGIN, 'abc')).toEqual({
      title: 'Cheshire A',
      description: 'Cheshire Pony Club. Results from 3 events. Team results and history on Mounted Games.',
      url: `${ORIGIN}/team-profiles/abc`,
      image: `${ORIGIN}/og/mounted-games.png`,
    });
    expect(teamProfileCard({ displayName: 'A', clubName: 'C', eventCount: 1 }, ORIGIN, 'x').description).toContain('1 event.');
    expect(teamProfileCard({ displayName: 'A', clubName: '', eventCount: 0 }, ORIGIN, 'x').description).toBe('Team results and history on Mounted Games.');
  });

  it('gives the generic card for known pages only', () => {
    expect(genericCard(ORIGIN, '/').url).toBe(`${ORIGIN}/`);
    expect(genericCard(ORIGIN, '/events').url).toBe(`${ORIGIN}/events`);
    expect(genericCard(ORIGIN, '/competitions/').url).toBe(`${ORIGIN}/competitions`);
    expect(genericCard(ORIGIN, '/competitions/past').url).toBe(`${ORIGIN}/competitions/past`);
    expect(genericCard(ORIGIN, '/seasons')).toMatchObject({
      title: 'Mounted Games: season tables and standings',
      url: `${ORIGIN}/seasons`,
    });
    expect(genericCard(ORIGIN, '/stats')).toMatchObject({
      title: 'Mounted Games: rider, pony and team stats',
      url: `${ORIGIN}/stats`,
    });
    expect(genericCard(ORIGIN, '/shop')).toMatchObject({
      title: 'Mounted Games: equipment and marketplace',
      url: `${ORIGIN}/shop`,
    });
    expect(genericCard(ORIGIN, '/anything"><script>').url).toBe(`${ORIGIN}/`);
  });
});

describe('reading the API body', () => {
  it('accepts the expected shape and defaults the optional parts', () => {
    expect(readCompetition({ name: 'A', startDate: 'd' })).toEqual({ name: 'A', startDate: 'd', endDate: null, location: null, teamCount: 0 });
    expect(readCompetition({ name: 'A', startDate: 'd', endDate: 'e', location: 'L', teamCount: 4 }))
      .toEqual({ name: 'A', startDate: 'd', endDate: 'e', location: 'L', teamCount: 4 });
    expect(readTeamProfile({ displayName: 'T' })).toEqual({ displayName: 'T', clubName: '', eventCount: 0 });
    expect(readTeamProfile({ displayName: 'T', clubName: 'C', eventCount: 2 })).toEqual({ displayName: 'T', clubName: 'C', eventCount: 2 });
  });

  it('refuses anything else', () => {
    for (const body of [null, 'x', 5, {}, { name: 1, startDate: 'd' }, { name: 'A' }]) expect(readCompetition(body)).toBeNull();
    for (const body of [null, 'x', {}, { displayName: 3 }]) expect(readTeamProfile(body)).toBeNull();
  });
});

describe('renderCardPage', () => {
  it('carries the Open Graph and Twitter tags', () => {
    const html = renderCardPage(competitionCard({ name: 'Spring Games', startDate: '2026-10-17T08:00:00Z', endDate: null, location: 'Tatton Park', teamCount: 2 }, ORIGIN, '12'));
    expect(html).toContain('<title>Spring Games</title>');
    expect(html).toContain('<meta property="og:title" content="Spring Games">');
    expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/competitions/12">`);
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/og/mounted-games.png">`);
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('Saturday 17 October 2026 at Tatton Park.');
    expect(html).toContain(`<a href="${ORIGIN}/competitions/12">`);
  });

  it('cannot be made to inject markup by a hostile competition, venue, club or team name', () => {
    const pages = [
      renderCardPage(competitionCard({ name: HOSTILE, startDate: '2026-10-17T08:00:00Z', endDate: null, location: HOSTILE, teamCount: 1 }, ORIGIN, '1')),
      renderCardPage(teamProfileCard({ displayName: HOSTILE, clubName: HOSTILE, eventCount: 1 }, ORIGIN, 'x')),
    ];
    for (const html of pages) {
      expect(html).not.toContain('<script');
      expect(html).not.toContain('"><');
      expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
      // The only tags in the page are the ones the template wrote.
      const names = new Set((html.match(/<[a-z!/][^\s>]*/gi) ?? []).map((tag) => tag.slice(1).replace('/', '').toLowerCase()));
      expect([...names].sort()).toEqual(['!doctype', 'a', 'body', 'h1', 'head', 'html', 'link', 'meta', 'p', 'title']);
    }
  });

  it('escapes even a hostile origin', () => {
    const html = renderCardPage(genericCard('https://x"><script>alert(1)</script>', '/'));
    expect(html).not.toContain('<script');
  });
});
