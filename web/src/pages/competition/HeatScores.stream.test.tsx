import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { HeatScores } from './HeatScores';
import { competition, heat, session } from '../../test/factories';
import { liveStream } from '../../test/streamFakes';
const state = vi.hoisted(() => ({ active: true, fallback: false }));
vi.mock('./context', () => ({ useCompetition: () => ({ competition: competition({ streamUrl: state.fallback ? 'https://youtu.be/example' : null }), streams: state.active ? [liveStream()] : [] }) }));
it('links native and fallback streams to the Live & stream tab, and hides the link without either', () => {
  const view = () => <MemoryRouter><HeatScores session={session(1)} heats={[heat(1)]} activeHeatId={1} /></MemoryRouter>;
  const { rerender } = render(view());
  expect(screen.getByRole('link', { name: 'Watch stream' })).toHaveAttribute('href', '/competitions/1/chat');
  state.active = false; rerender(view()); expect(screen.queryByRole('link', { name: 'Watch stream' })).toBeNull();
  state.fallback = true; rerender(view()); expect(screen.getByRole('link', { name: 'Watch stream' })).toHaveAttribute('href', '/competitions/1/chat');
});
