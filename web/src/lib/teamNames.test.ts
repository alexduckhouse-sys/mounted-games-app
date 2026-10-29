import { describe, expect, it } from 'vitest';
import { clubToShow } from './teamNames';

describe('clubToShow', () => {
  it('shows a club that differs from the team name', () => {
    expect(clubToShow('Oak A', 'Oak Pony Club')).toBe('Oak Pony Club');
  });

  it('shows nothing when the team is named after its club, ignoring case and spacing', () => {
    expect(clubToShow('Atherstone', 'Atherstone')).toBe('');
    expect(clubToShow('  atherstone ', 'ATHERSTONE')).toBe('');
    expect(clubToShow('Berwyn  &  Dee', 'Berwyn & Dee')).toBe('');
  });

  it('shows nothing when the name already carries the club, as a prefix or after it', () => {
    expect(clubToShow('Atherstone Juniors', 'Atherstone')).toBe('');
    expect(clubToShow('Berwyn & Dee Novices A', 'Berwyn & Dee')).toBe('');
    expect(clubToShow('Junior Atherstone', 'Atherstone')).toBe('');
  });

  it('matches whole words only', () => {
    expect(clubToShow('Deeside Novices', 'Dee')).toBe('Dee');
  });

  it('shows nothing for no club or the Unaffiliated placeholder', () => {
    expect(clubToShow('Oak A', null)).toBe('');
    expect(clubToShow('Oak A', undefined)).toBe('');
    expect(clubToShow('Oak A', 'Unaffiliated')).toBe('');
  });
});
