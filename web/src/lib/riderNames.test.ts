import { describe, expect, it } from 'vitest';
import { publicRiderName } from './riderNames';

describe('publicRiderName', () => {
  it('shortens the surname only when the rider asked for it', () => {
    expect(publicRiderName({ fullName: '  Alice Smith ', useInitialOnly: false })).toBe('Alice Smith');
    expect(publicRiderName({ fullName: 'Alice Smith', useInitialOnly: true })).toBe('Alice S.');
    expect(publicRiderName({ fullName: 'Mary Jane van smith', useInitialOnly: true })).toBe('Mary Jane van S.');
  });

  it('leaves a single name or an existing initial alone', () => {
    expect(publicRiderName({ fullName: 'Alice', useInitialOnly: true })).toBe('Alice');
    expect(publicRiderName({ fullName: 'Alice S.', useInitialOnly: true })).toBe('Alice S.');
    expect(publicRiderName({ fullName: 'Alice S', useInitialOnly: true })).toBe('Alice S');
  });
});
