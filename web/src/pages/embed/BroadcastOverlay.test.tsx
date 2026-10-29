import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BroadcastOverlay } from './BroadcastOverlay';
import { PublicBroadcastHttp } from './useBroadcastLive';
import type { BroadcastSnapshot } from '../../lib/broadcast';

const { resource } = vi.hoisted(() => ({ resource: vi.fn() }));
vi.mock('../../hooks/useEmbedResource', () => ({ useEmbedResource: resource }));
vi.mock('./useBroadcastLive', async importOriginal => ({ ...await importOriginal<typeof import('./useBroadcastLive')>(), useBroadcastLive: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const snapshot: BroadcastSnapshot = { revision: 1, observedAt: '2026-10-29T12:00:00Z', serverTime: '2026-10-29T12:00:00Z',
  playbackAt: '2026-10-29T12:00:00Z', expiresAt: '2026-10-29T12:00:15Z', hidden: false, warmingUp: false,
  graphics: { competitionName: 'Example event', arena: 'Main', current: { heatId: 1, label: 'Heat 1', sessionName: 'Morning', sectionId: 1, sectionName: 'Under 12', raceId: 1, raceName: 'Bending', started: true,
    rows: [{ teamId: 1, name: 'Example team', bibColour: null, lane: 2, sitOut: false, hc: false, place: null, joint: false, points: null, eliminated: false }] },
    next: null, score: null, standings: [], banner: null, sponsors: [], cues: [] } };
const show = (query = '') => render(<MemoryRouter initialEntries={[`/embed/competitions/1/overlay?arena=Main&delay=0${query}`]}><Routes><Route path="/embed/competitions/:id/overlay" element={<BroadcastOverlay />} /></Routes></MemoryRouter>);

describe('isolated broadcast output', () => {
  it('renders public line-ups without navigation, camera, storage or diagnostics on air', () => {
    resource.mockReturnValue({ data: snapshot, updatedAt: new Date(), error: null, reload: vi.fn() });
    const storage = vi.spyOn(Storage.prototype, 'getItem');
    const { container } = show();
    expect(screen.getByText('Example team')).toBeInTheDocument();
    expect(container.querySelector('nav, video, iframe')).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.documentElement).toHaveClass('broadcast-document');
    expect(storage).not.toHaveBeenCalled();
  });
  it('shows connection diagnostics only in the producer preview', () => {
    resource.mockReturnValue({ data: null, updatedAt: null, error: 'failed', reload: vi.fn() });
    const view = show();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(view.container.querySelector('.bc-canvas')).toBeNull();
    view.unmount(); show('&preview=1');
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for a fresh update.');
  });
  it('keeps every public hub request free of cookies and cached responses', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('hello', { status: 200 })); vi.stubGlobal('fetch', fetcher);
    const answer = await new PublicBroadcastHttp().send({ url: 'https://example.test/hubs/live', method: 'POST', content: 'payload' });
    expect(answer.content).toBe('hello');
    expect(fetcher).toHaveBeenCalledWith('https://example.test/hubs/live', expect.objectContaining({ credentials: 'omit', cache: 'no-store', body: 'payload', headers: { 'X-MG-Embed': '1' } }));
    await expect(new PublicBroadcastHttp().send({})).rejects.toThrow('Missing public hub address');
  });
});
