import { describe, expect, it } from 'vitest';
import { formBanner, isLocked, lockHeading, lockMoment } from './decFormDeadline';

const SOON = new Date(2030, 9, 23, 18, 0).toISOString();
const before = new Date(2030, 9, 20).getTime();
const after = new Date(2030, 9, 24).getTime();

describe('lockMoment', () => {
  it('writes the day and the 24 hour time', () => {
    expect(lockMoment(SOON)).toBe('Wed 23 Oct, 18:00');
  });
  it('gives nothing for an unreadable date', () => {
    expect(lockMoment('nonsense')).toBe('');
  });
});

describe('isLocked', () => {
  it('is open with no deadline, and open until the deadline', () => {
    expect(isLocked(null)).toBe(false);
    expect(isLocked({ declarationsCloseAt: null, isClosed: true })).toBe(false);
    expect(isLocked({ declarationsCloseAt: SOON, isClosed: false }, before)).toBe(false);
  });
  it('is locked once the deadline passes or an organiser has closed it', () => {
    expect(isLocked({ declarationsCloseAt: SOON, isClosed: false }, after)).toBe(true);
    expect(isLocked({ declarationsCloseAt: SOON, isClosed: true }, before)).toBe(true);
  });
  it('reads the clock when no time is given', () => {
    expect(isLocked({ declarationsCloseAt: '2000-01-01T00:00:00Z', isClosed: false })).toBe(true);
  });
});

describe('lockHeading', () => {
  it('says when it locks, that it has, or nothing', () => {
    expect(lockHeading({ declarationsCloseAt: SOON, isClosed: false }, before)).toBe('Locks Wed 23 Oct, 18:00');
    expect(lockHeading({ declarationsCloseAt: SOON, isClosed: false }, after)).toBe('Locked');
    expect(lockHeading({ declarationsCloseAt: null, isClosed: false })).toBeNull();
    expect(lockHeading(undefined)).toBeNull();
  });
});

describe('formBanner', () => {
  it('asks for the form by the deadline, amber', () => {
    expect(formBanner(false, { declarationsCloseAt: SOON, isClosed: false })).toEqual({ text: 'Send by Wed 23 Oct, 18:00.', tone: 'warn' });
  });
  it('says it has not been sent when there is no deadline', () => {
    expect(formBanner(false, null)).toEqual({ text: 'Not sent yet.', tone: 'warn' });
  });
  it('tells a sender how long they can change it, green', () => {
    expect(formBanner(true, { declarationsCloseAt: SOON, isClosed: false })).toEqual({ text: 'Sent. You can change it until Wed 23 Oct, 18:00.', tone: 'good' });
    expect(formBanner(true, undefined)).toEqual({ text: 'Sent. You can still change it.', tone: 'good' });
  });
});
