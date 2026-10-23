import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { heat, race } from '../../test/factories';
import type { Heat } from '../../types';
import { LaneRotationMode } from '../../lib/lanes';
import { ScoringSection, type PendingPlace } from './ScoringSection';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@microsoft/signalr', () => ({ HubConnectionBuilder: vi.fn() }));

const h: Heat = heat(1, { entries: [
  { id: 1, teamId: 1, teamName: 'Alpha', laneIndex: 3, bibColour: 'Red' },
  { id: 2, teamId: 2, teamName: 'Bravo', laneIndex: 1, bibColour: 'Royal blue' },
  { id: 3, teamId: 3, teamName: 'Charlie', laneIndex: 2, bibColour: null },
], races: [race(1, { name: 'Race 1' }), race(2, { name: 'Race 2' })] });

function Harness({ raceIdx }: { raceIdx: number }) {
  const [pending, setPending] = useState<PendingPlace[]>([]);
  return (
    <ScoringSection
      heat={h} races={h.races} activeRace={h.races[raceIdx]} onSelectRace={() => {}} sessionBase={3}
      laneRules={{ lanesPerHeat: null, mode: LaneRotationMode.MoveUp }} qualifiers={3} pending={pending} canScore queued={[]}
      showResults={false} onToggleResults={() => {}} showLaneView={false} onToggleLaneView={() => {}}
      onClickTeam={(teamId) => setPending((p) => [...p, { teamId, place: p.length + 1, eliminated: false }])}
      onToggleElim={() => {}} onReset={() => {}} onSubmit={() => {}} correctionReason="" onCorrectionReason={() => {}}
    />
  );
}

const tileOrder = () => screen.getAllByTitle(/^Lane /).map((el) => el.parentElement?.textContent ?? '');

describe('ScoringSection tiles', () => {
  it('lists teams in lane order with the bib colour under each name', () => {
    render(<Harness raceIdx={0} />);
    const tiles = tileOrder();
    expect(tiles[0]).toContain('Bravo');
    expect(tiles[0]).toContain('Royal blue bib');
    expect(tiles[1]).toContain('Charlie');
    expect(tiles[1]).toContain('No bib colour');
    expect(tiles[2]).toContain('Alpha');
    expect(tiles[2]).toContain('Red bib');
  });

  it('uses the rotated lane in the next race', () => {
    render(<Harness raceIdx={1} />);
    // Move up one lane: Alpha (drawn 3) is now in lane 1 and Bravo (drawn 1) in lane 2.
    const tiles = tileOrder();
    expect(tiles[0]).toContain('Alpha');
    expect(tiles[1]).toContain('Bravo');
    expect(tiles[2]).toContain('Charlie');
  });

  it('keeps the rows where they are after a placing is entered', () => {
    render(<Harness raceIdx={0} />);
    fireEvent.click(screen.getByText('Alpha'));
    fireEvent.click(screen.getByText('Bravo'));
    const after = tileOrder();
    expect(after[0]).toContain('Bravo');
    expect(after[1]).toContain('Charlie');
    expect(after[2]).toContain('Alpha');
  });
});
