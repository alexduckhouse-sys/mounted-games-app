import { beforeEach, describe, expect, it, vi } from 'vitest';

const put = vi.fn();
vi.mock('../api', () => ({ api: { put: (...a: unknown[]) => put(...a) } }));

import { setHeatEntryBibOverride, suggestFreeBibColour } from './heatBibOverride';

describe('heat bib override', () => {
  beforeEach(() => { put.mockReset(); put.mockResolvedValue({}); });

  it('suggests the first spare colour nobody is wearing', () => {
    expect(suggestFreeBibColour([{ teamId: 1, bibColour: 'Red bibs' }, { teamId: 2, bibColour: 'red', bibColourOverride: 'blue' }])).toBe('yellow');
    expect(suggestFreeBibColour([])).toBe('red');
  });

  it('returns null when every spare colour is in use', () => {
    const all = ['red', 'blue', 'yellow', 'green', 'white', 'orange', 'purple', 'pink'].map((c, i) => ({ teamId: i, bibColour: c }));
    expect(suggestFreeBibColour(all)).toBeNull();
  });

  it('puts the override to the heat entry route', async () => {
    await setHeatEntryBibOverride(1, 2, 3, 4, 'blue');
    expect(put).toHaveBeenCalledWith('/competitions/1/sessions/2/heats/3/entries/4/bib-override', { bibColourOverride: 'blue' });
    await setHeatEntryBibOverride(1, 2, 3, 4, null);
    expect(put).toHaveBeenLastCalledWith(expect.any(String), { bibColourOverride: null });
  });
});
