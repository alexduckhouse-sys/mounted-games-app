import { describe, expect, it } from 'vitest';
import { StatsSubjectKind, type StatsHit } from '../../types';
import { groupRiders, riderLine } from './riderList';

const hit = (name: string, competitions = 2): StatsHit => ({ kind: StatsSubjectKind.Rider, name, key: name.toLowerCase(), competitions });

describe('riderLine', () => {
  it('puts the last word first as the surname', () => {
    expect(riderLine(hit('Arthur Barker'))).toMatchObject({ surname: 'Barker', given: 'Arthur', initialOnly: false, letter: 'B', sortKey: 'barker arthur' });
    expect(riderLine(hit('  Mary   Ann  Smith '))).toMatchObject({ surname: 'Smith', given: 'Mary Ann' });
  });
  it('keeps lower-case particles with the surname', () => {
    expect(riderLine(hit('Mary van der Berg'))).toMatchObject({ surname: 'van der Berg', given: 'Mary', letter: 'V' });
    expect(riderLine(hit('van Berg'))).toMatchObject({ surname: 'Berg', given: 'van' });
  });
  it('leaves a rider shown by surname initial as it is and sorts them by first name', () => {
    expect(riderLine(hit('Catriona E.'))).toMatchObject({ surname: 'Catriona E.', given: '', initialOnly: true, letter: 'C', sortKey: 'catriona e.' });
  });
  it('leaves a single name as it is', () => {
    expect(riderLine(hit('Madonna'))).toMatchObject({ surname: 'Madonna', given: '', initialOnly: false, letter: 'M' });
    expect(riderLine(hit(''))).toMatchObject({ surname: '', letter: '#' });
  });
  it('files accents under their letter and anything else under #', () => {
    expect(riderLine(hit('Zoe Évans')).letter).toBe('E');
    expect(riderLine(hit('Kim 3rd')).letter).toBe('#');
  });
});

describe('groupRiders', () => {
  it('sorts surname first and groups under A to Z, with # last', () => {
    const groups = groupRiders([hit('Owen Barker'), hit('Catriona E.'), hit('Edie Callaghan'), hit('Arthur Barker'), hit('Ewan Carter'), hit('Kim 3rd')]);
    expect(groups.map((group) => group.letter)).toEqual(['B', 'C', '#']);
    expect(groups[0].riders.map((line) => line.hit.name)).toEqual(['Arthur Barker', 'Owen Barker']);
    // "Catriona E." sorts by first name, so it lands after Callaghan and Carter.
    expect(groups[1].riders.map((line) => line.hit.name)).toEqual(['Edie Callaghan', 'Ewan Carter', 'Catriona E.']);
  });
  it('orders names that sort the same by their key, and gives nothing for nothing', () => {
    const same = [hit('Sam Lee'), hit('Sam Lee')].map((entry, index) => ({ ...entry, key: `k${1 - index}` }));
    expect(groupRiders(same).flatMap((group) => group.riders.map((line) => line.hit.key))).toEqual(['k0', 'k1']);
    expect(groupRiders([])).toEqual([]);
  });
});
