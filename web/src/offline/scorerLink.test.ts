import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';
import { session } from '../test/factories';
import {
  angleFromHash, cleanAngle, clearScorerToken, parseScorerSession, readSavedScorerSession, readScorerAngle, readScorerToken, scorerApi, scorerFailure,
  scorerLinkUrl, tokenFromHash, writeSavedScorerSession, writeScorerAngle, writeScorerToken,
} from './scorerLink';

const valid = {
  label: 'Sam', competitionId: 4, competitionName: 'Spring Games', arenaName: 'Main', expiresAt: '2026-06-03T00:00:00Z',
  sessions: [session(1, { competitionId: 4 })],
};

describe('tokenFromHash', () => {
  it.each([
    ['#t=mgs_abc-DEF_123', 'mgs_abc-DEF_123'],
    ['t=mgs_abc', 'mgs_abc'],
    ['#t=%20mgs_abc%20', 'mgs_abc'],
    ['#x=1&t=mgs_abc', 'mgs_abc'],
  ])('reads %s', (hash, token) => expect(tokenFromHash(hash)).toBe(token));

  it.each(['', '#', '#t=', '#t=%20', '#other=mgs_abc'])('finds nothing in "%s"', (hash) => expect(tokenFromHash(hash)).toBeNull());
});

describe('scorerLinkUrl', () => {
  it('puts the token in the fragment, never the path or query', () => {
    const url = new URL(scorerLinkUrl('https://mg.example', 'mgs_abc'));
    expect(url.pathname).toBe('/score');
    expect(url.search).toBe('');
    expect(url.hash).toBe('#t=mgs_abc');
  });

  it('adds a camera position beside the token, still in the fragment', () => {
    const url = new URL(scorerLinkUrl('https://mg.example', 'mgs_abc', 'Finish line'));
    expect(url.search).toBe('');
    expect(url.hash).toBe('#t=mgs_abc&angle=Finish%20line');
    expect(tokenFromHash(url.hash)).toBe('mgs_abc');
    expect(angleFromHash(url.hash)).toBe('Finish line');
    expect(scorerLinkUrl('', 'mgs_abc', '   ')).toBe('/score#t=mgs_abc');
    expect(scorerLinkUrl('', 'mgs_abc', null)).toBe('/score#t=mgs_abc');
  });
});

describe('camera positions', () => {
  beforeEach(() => localStorage.clear());

  it('tidies what a link carries', () => {
    expect(cleanAngle('  Finish\u0007 \n line ')).toBe('Finish line');
    expect(cleanAngle('x'.repeat(80))).toHaveLength(60);
    expect(cleanAngle('\u007f')).toBeNull();
    expect(cleanAngle(undefined)).toBeNull();
    expect(angleFromHash('#t=mgs_abc')).toBeNull();
    expect(angleFromHash('angle=Main%20stand&t=mgs_abc')).toBe('Main stand');
  });

  it('is kept on the phone, replaced or forgotten with the link', () => {
    expect(readScorerAngle()).toBeNull();
    writeScorerAngle('Finish line');
    expect(readScorerAngle()).toBe('Finish line');
    writeScorerAngle(null);
    expect(readScorerAngle()).toBeNull();
    writeScorerAngle('Main stand');
    clearScorerToken();
    expect(readScorerAngle()).toBeNull();
  });

  it('copes with storage that refuses', () => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('full'); };
    try { expect(() => writeScorerAngle('Finish line')).not.toThrow(); } finally { Storage.prototype.setItem = set; }
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('denied'); };
    try { expect(readScorerAngle()).toBeNull(); } finally { Storage.prototype.getItem = get; }
  });
});

describe('the stored token', () => {
  beforeEach(() => localStorage.clear());

  it('is kept, read back and forgotten along with the saved timetable', () => {
    expect(readScorerToken()).toBeNull();
    expect(writeScorerToken('mgs_abc')).toBe(true);
    writeSavedScorerSession(parseScorerSession(valid)!);
    expect(readScorerToken()).toBe('mgs_abc');
    expect(readSavedScorerSession()?.arenaName).toBe('Main');
    clearScorerToken();
    expect(readScorerToken()).toBeNull();
    expect(readSavedScorerSession()).toBeNull();
  });

  it('copes with storage that refuses or holds junk', () => {
    localStorage.setItem('mg.scorer.session', '{broken');
    expect(readSavedScorerSession()).toBeNull();
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('full'); };
    try {
      expect(writeScorerToken('mgs_abc')).toBe(false);
      expect(() => writeSavedScorerSession(parseScorerSession(valid)!)).not.toThrow();
    } finally { Storage.prototype.setItem = set; }
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('denied'); };
    try {
      expect(readScorerToken()).toBeNull();
    } finally { Storage.prototype.getItem = get; }
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = () => { throw new Error('denied'); };
    try {
      expect(() => clearScorerToken()).not.toThrow();
    } finally { Storage.prototype.removeItem = remove; }
  });
});

describe('scorerApi', () => {
  beforeEach(() => localStorage.clear());
  type Handler = { fulfilled: (c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig };
  const run = (config: Partial<InternalAxiosRequestConfig>) => {
    const handlers = (scorerApi.interceptors.request as unknown as { handlers: Handler[] }).handlers;
    return handlers[0].fulfilled({ headers: new AxiosHeaders(), ...config } as InternalAxiosRequestConfig);
  };

  it('sends the token in X-Scorer-Token and never as a bearer token', () => {
    writeScorerToken('mgs_abc');
    localStorage.setItem('mg.auth', JSON.stringify({ token: 'jwt', expiresAt: '2999-01-01T00:00:00Z', user: {} }));
    const config = run({ method: 'get' });
    expect(config.headers.get('X-Scorer-Token')).toBe('mgs_abc');
    expect(config.headers.get('Authorization')).toBeUndefined();
    expect(config.timeout).toBe(15_000);
  });

  it('verifies an explicitly supplied token without replacing it with the saved link', () => {
    writeScorerToken('mgs_old');
    const config = run({ method: 'get', headers: new AxiosHeaders({ 'X-Scorer-Token': 'mgs_new' }) });
    expect(config.headers.get('X-Scorer-Token')).toBe('mgs_new');
  });

  it('sends no header when the phone has no token, and leaves other timeouts alone', () => {
    const config = run({ method: 'post', timeout: 5000 });
    expect(config.headers.get('X-Scorer-Token')).toBeUndefined();
    expect(config.timeout).toBe(5000);
  });
});

describe('parseScorerSession', () => {
  it('accepts a timetable and drops half-formed sessions', () => {
    const parsed = parseScorerSession({ ...valid, scope: 2, sessions: [session(1), null, { id: 9 }] });
    expect(parsed?.sessions.map((s) => s.id)).toEqual([1]);
    expect(parsed?.competitionName).toBe('Spring Games');
    expect(parsed?.scope).toBe(2);
  });

  it('fills in a missing name or expiry', () => {
    expect(parseScorerSession({ ...valid, competitionName: undefined, expiresAt: undefined })).toMatchObject({ competitionName: '', expiresAt: '' });
  });

  it.each([null, undefined, 'html', 3, {}, { ...valid, sessions: 'x' }, { ...valid, competitionId: '4' }, { ...valid, label: 1 }, { ...valid, arenaName: null }])(
    'refuses %j', (data) => expect(parseScorerSession(data)).toBeNull());
});

describe('scorerFailure', () => {
  const fail = (status: number) => ({ response: { status } });
  it.each([
    [undefined, 'offline'], [null, 'offline'], [{}, 'offline'], [fail(500), 'offline'], [fail(503), 'offline'], [fail(408), 'offline'], [fail(429), 'offline'],
    [fail(401), 'missing'], [fail(404), 'invalid'], [fail(410), 'withdrawn'], [fail(400), 'other'], [fail(403), 'other'],
  ])('reads %j as %s', (err, expected) => expect(scorerFailure(err)).toBe(expected));
});
