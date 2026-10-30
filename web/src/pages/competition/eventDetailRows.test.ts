import { describe, expect, it } from 'vitest';
import { eventDetailRows, venueMapUrl, type DetailLabels } from './eventDetailRows';

const labels: DetailLabels = {
  venue: 'Venue', postcode: 'Postcode', organiser: 'Organiser', email: 'Email', competitionNo: 'Competition no.', openMaps: 'Open in Maps',
  summary: { venue: 'venue', postcode: 'postcode', what3words: 'what3words', organiser: 'organiser', email: 'email', competitionNo: 'competition number' },
};

describe('venueMapUrl', () => {
  it('prefers the organiser’s own link, then the pin, then nothing', () => {
    expect(venueMapUrl({ appleMapsUrl: 'https://maps.apple.com/?q=x', latitude: 1, longitude: 2 })).toBe('https://maps.apple.com/?q=x');
    expect(venueMapUrl({ latitude: 51.9, longitude: -2.3 })).toBe('https://www.google.com/maps/search/?api=1&query=51.9,-2.3');
    expect(venueMapUrl({ latitude: 51.9 })).toBeNull();
    expect(venueMapUrl({})).toBeNull();
  });
});

describe('eventDetailRows', () => {
  it('makes no rows when nothing is set, or only blanks', () => {
    expect(eventDetailRows({}, labels)).toEqual([]);
    expect(eventDetailRows({ location: '  ', postcode: '', what3Words: '///', organiserName: ' ', contactEmail: '', competitionNumber: null }, labels)).toEqual([]);
  });

  it('gives a row for every detail that is set, in order, getting there first, with icons only where there is somewhere to go', () => {
    const rows = eventDetailRows({
      location: ' Onley Grounds ', latitude: 52.3, longitude: -1.2, postcode: 'CV23 8AJ', what3Words: '///index.home.raft',
      organiserName: 'Warwickshire Mounted Games Club',
      contactEmail: 'competitions@example.org', competitionNumber: 'EGUK-2026-041',
    }, labels);
    expect(rows.map((row) => [row.key, row.group, row.label, row.value, row.icon, row.href])).toEqual([
      ['venue', 'arrival', 'Venue', 'Onley Grounds', 'pin', 'https://www.google.com/maps/search/?api=1&query=52.3,-1.2'],
      ['postcode', 'arrival', 'Postcode', 'CV23 8AJ', 'pin', 'https://www.google.com/maps/search/?api=1&query=CV23%208AJ'],
      ['what3words', 'arrival', 'what3words', '///index.home.raft', 'w3w', 'https://what3words.com/index.home.raft'],
      ['organiser', 'more', 'Organiser', 'Warwickshire Mounted Games Club', undefined, undefined],
      ['email', 'more', 'Email', 'competitions@example.org', 'mail', 'mailto:competitions@example.org'],
      ['compNo', 'more', 'Competition no.', 'EGUK-2026-041', undefined, undefined],
    ]);
    expect(rows.map((row) => row.summaryName)).toEqual(['venue', 'postcode', 'what3words', 'organiser', 'email', 'competition number']);
  });

  it('shows a venue with no map as plain text', () => {
    expect(eventDetailRows({ location: 'Hartpury' }, labels)).toEqual([{ key: 'venue', group: 'arrival', label: 'Venue', summaryName: 'venue', value: 'Hartpury' }]);
  });

  it('keeps the map link for a venue known only by its pin', () => {
    expect(eventDetailRows({ latitude: 52.1, longitude: -1.5 }, labels)).toEqual([
      { key: 'venue', group: 'arrival', label: 'Venue', summaryName: 'venue', value: 'Open in Maps', href: 'https://www.google.com/maps/search/?api=1&query=52.1,-1.5', icon: 'pin' },
    ]);
  });
});
