import { describe, expect, it } from 'vitest';
import { initialsOf, roleLabel } from './profile';

describe('initialsOf', () => {
  it('uses the first and last word of a name', () => {
    expect(initialsOf('Alex Morgan')).toBe('AM');
    expect(initialsOf('  sam  jay   lee ')).toBe('SL');
  });

  it('uses the start of a single word', () => {
    expect(initialsOf('Priya')).toBe('PR');
    expect(initialsOf('X')).toBe('X');
  });

  it('falls back to the email, then a question mark', () => {
    expect(initialsOf('', 'coach.alex@example.com')).toBe('CO');
    expect(initialsOf(null, '--@example.com')).toBe('?');
    expect(initialsOf(undefined)).toBe('?');
  });
});

describe('roleLabel', () => {
  it('picks the most senior role', () => {
    expect(roleLabel(['Member', 'Trainer', 'Admin'])).toBe('Admin');
    expect(roleLabel(['Trainer', 'Manager'])).toBe('Team manager');
    expect(roleLabel(['Member', 'Trainer'])).toBe('Trainer');
  });

  it('shows a waiting trainer as a request, and anyone else as a member', () => {
    expect(roleLabel(['Member', 'TrainerRequest'])).toBe('Trainer request');
    expect(roleLabel(['Member'])).toBe('Member');
    expect(roleLabel([])).toBe('Member');
  });
});
