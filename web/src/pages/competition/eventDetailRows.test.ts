import { describe, expect, it } from 'vitest';
import { eventDetailRows, venueMapUrl, type DetailLabels } from './eventDetailRows';

const labels: DetailLabels = {
  venue: 'Venue', postcode: 'Postcode', lorryPark: 'Lorry park', organiser: 'Organiser', email: 'Email', competitionNo: 'Competition no.',
  summary: { venue: 'venue', postcode: 'postcode', what3words: 'what3words', lorryPark: 'lorry park', organiser: 'organiser', email: 'email', competitionNo: 'competition number' },
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
    expect(eventDetailRows({ location: '  ', postcode: '', what3Words: '///', organiserName: ' ', contactEmail: '', competitionNumber: null, lorryWhat3Words: ' ', lorryDirectionsNote: '' }, labels)).toEqual([]);
  });

  it('gives a row for every detail that is set, in order, with icons only where there is somewhere to go', () => {
    const rows = eventDetailRows({
      location: ' Onley Grounds ', latitude: 52.3, longitude: -1.2, postcode: 'CV23 8AJ', what3Words: '///index.home.raft',
      lorryWhat3Words: 'bags.cool.lamp', lorryDirectionsNote: 'Enter by the north gate', organiserName: 'Warwickshire Mounted Games Club',
      contactEmail: 'competitions@example.org', competitionNumber: 'EGUK-2026-041',
    }, labels);
    expect(rows.map((row) => [row.key, row.label, row.value, row.icon, row.href])).toEqual([
      ['venue', 'Venue', 'Onley Grounds', 'pin', 'https://www.google.com/maps/search/?api=1&query=52.3,-1.2'],
      ['postcode', 'Postcode', 'CV23 8AJ', 'pin', 'https://www.google.com/maps/search/?api=1&query=CV23%208AJ'],
      ['what3words', 'what3words', '///index.home.raft', 'w3w', 'https://what3words.com/index.home.raft'],
      ['lorry', 'Lorry park', '///bags.cool.lamp · Enter by the north gate', 'w3w', 'https://what3words.com/bags.cool.lamp'],
      ['organiser', 'Organiser', 'Warwickshire Mounted Games Club', undefined, undefined],
      ['email', 'Email', 'competitions@example.org', 'mail', 'mailto:competitions@example.org'],
      ['compNo', 'Competition no.', 'EGUK-2026-041', undefined, undefined],
    ]);
    expect(rows.map((row) => row.summaryName)).toEqual(['venue', 'postcode', 'what3words', 'lorry park', 'organiser', 'email', 'competition number']);
  });

  it('shows a venue with no map as plain text', () => {
    expect(eventDetailRows({ location: 'Hartpury' }, labels)).toEqual([{ key: 'venue', label: 'Venue', summaryName: 'venue', value: 'Hartpury' }]);
  });

  it('shows a lorry park from its note alone as plain text, and skips one with only coordinates', () => {
    expect(eventDetailRows({ lorryDirectionsNote: 'Second gate on the left' }, labels)).toEqual([{ key: 'lorry', label: 'Lorry park', summaryName: 'lorry park', value: 'Second gate on the left' }]);
    expect(eventDetailRows({ lorryLatitude: 52.1, lorryLongitude: -1.5 }, labels)).toEqual([]);
  });
});
