import { describe, expect, it } from 'vitest';
import { pickNotificationClient } from './notificationClient';

const win = (path: string) => ({ url: `https://example.test${path}` });

describe('pickNotificationClient', () => {
  it('skips broadcast and score windows', () => {
    const page = win('/competitions/3');
    expect(pickNotificationClient([win('/competitions/3/broadcast'), win('/score'), page])).toBe(page);
  });

  it('returns undefined when every window is one to leave alone', () => {
    expect(pickNotificationClient([win('/competitions/3/broadcast'), win('/score/1')])).toBeUndefined();
    expect(pickNotificationClient([])).toBeUndefined();
  });

  it('does not mistake similar paths for those pages, and tolerates a bad URL', () => {
    const scoreboard = win('/scoreboard');
    expect(pickNotificationClient([scoreboard])).toBe(scoreboard);
    const odd = { url: 'not a url' };
    expect(pickNotificationClient([odd])).toBe(odd);
  });
});
