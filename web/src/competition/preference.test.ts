import { describe, expect, it } from 'vitest';
import { competitionCookie, readCompetitionCookie } from './preference';

const encoded = (value: unknown) => encodeURIComponent(JSON.stringify(value));

describe('readCompetitionCookie', () => {
  it('reads the competition from among other cookies', () => {
    const cookies = `theme=dark; mg.competition=${encoded({ id: 4, name: 'Spring & Summer' })}; other=1`;
    expect(readCompetitionCookie(cookies)).toEqual({ id: 4, name: 'Spring & Summer' });
  });

  it('returns null when the cookie is absent or empty', () => {
    expect(readCompetitionCookie('')).toBeNull();
    expect(readCompetitionCookie('theme=dark')).toBeNull();
    expect(readCompetitionCookie('mg.competition=')).toBeNull();
  });

  it('does not match a cookie that merely starts with the same name', () => {
    expect(readCompetitionCookie(`mg.competitionX=${encoded({ id: 1, name: 'A' })}`)).toBeNull();
  });

  it.each([
    ['malformed JSON', 'mg.competition=%7Bbroken'],
    ['malformed escape', 'mg.competition=%E0%A4%A'],
    ['a JSON null', `mg.competition=${encoded(null)}`],
    ['a JSON string', `mg.competition=${encoded('x')}`],
    ['a zero id', `mg.competition=${encoded({ id: 0, name: 'A' })}`],
    ['a negative id', `mg.competition=${encoded({ id: -3, name: 'A' })}`],
    ['a fractional id', `mg.competition=${encoded({ id: 1.5, name: 'A' })}`],
    ['a string id', `mg.competition=${encoded({ id: '4', name: 'A' })}`],
    ['a missing id', `mg.competition=${encoded({ name: 'A' })}`],
    ['an empty name', `mg.competition=${encoded({ id: 4, name: '' })}`],
    ['a non-string name', `mg.competition=${encoded({ id: 4, name: 9 })}`],
  ])('rejects %s', (_label, cookies) => {
    expect(readCompetitionCookie(cookies)).toBeNull();
  });
});

describe('competitionCookie', () => {
  it('stores the competition for six months', () => {
    const cookie = competitionCookie({ id: 4, name: 'Spring' }, false);
    expect(cookie).toContain(`mg.competition=${encoded({ id: 4, name: 'Spring' })}`);
    expect(cookie).toContain(`Max-Age=${60 * 60 * 24 * 180}`);
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });

  it('adds Secure over https', () => {
    expect(competitionCookie({ id: 4, name: 'Spring' }, true)).toMatch(/; Secure$/);
  });

  it('expires the cookie when there is no competition to remember', () => {
    expect(competitionCookie(null, false)).toBe('mg.competition=; Path=/; Max-Age=0; SameSite=Lax');
  });

  it('round-trips through readCompetitionCookie', () => {
    const cookie = competitionCookie({ id: 9, name: 'Ünïcode; name=x' }, false).split('; Path')[0];
    expect(readCompetitionCookie(cookie)).toEqual({ id: 9, name: 'Ünïcode; name=x' });
  });
});
