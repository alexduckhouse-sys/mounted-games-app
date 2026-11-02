import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { heat, race } from '../../test/factories';
import { ScoringSection } from './ScoringSection';
import { raceStartFor } from '../../offline/raceStartOutbox';
vi.mock('../../api', () => ({ api: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn() } }));
vi.mock('@microsoft/signalr', () => ({ HubConnectionBuilder: vi.fn() }));
beforeEach(() => { localStorage.clear(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); });
function setup() {
  const r = race(1);
  return render(<ScoringSection heat={heat(1, { entries: [{ id: 1, teamId: 1, teamName: 'Test team', laneIndex: 1 }], races: [r] })}
    races={[r]} activeRace={r} onSelectRace={vi.fn()} sessionBase={1} laneRules={{ lanesPerHeat: null, mode: 0 }} qualifiers={1}
    pending={[]} canScore queued={[]} onClickTeam={vi.fn()} onToggleElim={vi.fn()} onReset={vi.fn()} onSubmit={vi.fn()}
    correctionReason="" onCorrectionReason={vi.fn()} />);
}
it('opens a race for scoring straight away, with no start button', () => {
  setup();
  expect(screen.queryByRole('button', { name: 'Start race · flag down' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Score without start time' })).toBeNull();
  expect(screen.getByRole('button', { name: /Test team, lane/ })).not.toBeDisabled();
  expect(raceStartFor(1)).toBeUndefined();
});
