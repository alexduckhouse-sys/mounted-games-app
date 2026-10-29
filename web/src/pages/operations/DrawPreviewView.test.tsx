import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DrawResult } from './DrawPreviewView';
import type { DrawPreview } from './types';

const preview = (fingerprint: string, lanes: Record<number, number>): DrawPreview => ({
  sectionId: 1, seed: 1, fingerprint,
  fairness: { teamCount: 2, sessionCount: 1, heatSizeSpread: 0, maximumOpponentMeetings: 1, repeatedOpponentPairs: 0, maximumLaneUseSpread: 0, everyTeamAppearsOncePerSession: true, warnings: [] },
  sessions: [{
    sessionId: 5, name: 'Round 1',
    heats: [{ heatId: 9, orderIndex: 1, label: '', teams: [{ teamId: 1, teamName: 'Oak A', laneIndex: lanes[1] }, { teamId: 2, teamName: 'Ash B', laneIndex: lanes[2] }] }],
  }],
} as unknown as DrawPreview);

describe('DrawResult', () => {
  it('marks the lanes that moved since the last draw number', () => {
    const before = preview('a', { 1: 1, 2: 2 });
    const after = preview('b', { 1: 2, 2: 2 });
    render(<DrawResult preview={after} previous={before} round={0} onRound={vi.fn()} onNewSeed={vi.fn()} busy={false} />);
    expect(screen.getByText('was lane 1')).toBeInTheDocument();
    expect(screen.getAllByText(/^was lane/)).toHaveLength(1);
  });

  it('marks nothing on a first preview', () => {
    render(<DrawResult preview={preview('a', { 1: 1, 2: 2 })} round={0} onRound={vi.fn()} onNewSeed={vi.fn()} busy={false} />);
    expect(screen.queryByText(/^was lane/)).not.toBeInTheDocument();
  });
});
