import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CameraLockButtons } from '../../components/stream/CameraLocks';
import { ReplayInspector, SavedReplaysDrawer } from '../../components/stream/ReplayInspector';
import { StreamControlStrip } from '../../components/stream/StreamControlStrip';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { LiteModeProvider } from '../../lite/LiteModeContext';
import { competition, heat, race, session } from '../../test/factories';
import { liveStream } from '../../test/streamFakes';
import type { SavedReplayClip } from '../../live/replayBuffer';
import type { StreamOverlay } from '../../types';
import { CompetitionContext } from './context';
import { ProducePage } from './ProducePage';
import { StreamControlsPage } from './StreamControlsPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => true, user: { fullName: 'Example Organiser', roles: ['Trainer'] } }) }));
vi.mock('../../components/stream/LiveVideo', () => ({ LiveVideo: () => <div data-testid="live-video" /> }));

const save = vi.fn();
beforeEach(() => {
  localStorage.clear();
  save.mockReset().mockResolvedValue('saved');
  vi.mocked(api.get).mockResolvedValue({ data: { streams: [liveStream()] } });
  vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} });
});
afterEach(cleanup);

function controls(url: string, lang: 'fr' | 'cy') {
  const value = {
    competition: competition({
      sessions: [session(1, { arenaName: 'Main Arena', heats: [heat(1, { label: 'Heat 1', races: [race(1, { name: 'Bending', isComplete: true }), race(2, { name: 'Mug' })] })] })],
    }),
    reload: vi.fn(), streams: [liveStream()], overlay: DEFAULT_OVERLAY as StreamOverlay, saveOverlay: save, streamingEnabled: true,
    invoke: vi.fn() as never, ready: 1, streamMessages: [],
  };
  return render(
    <LanguageProvider initial={lang}>
      <LiteModeProvider>
        <MemoryRouter initialEntries={[url]}>
          <CompetitionContext.Provider value={value}>
            <Routes><Route path="/competitions/:id/stream-controls" element={<StreamControlsPage />} /></Routes>
          </CompetitionContext.Provider>
        </MemoryRouter>
      </LiteModeProvider>
    </LanguageProvider>,
  );
}

describe('stream desks in French and Welsh', () => {
  it('shows the stream controls page, tabs and overlay choices in French', () => {
    controls('/competitions/1/stream-controls', 'fr');
    expect(screen.getByRole('heading', { name: 'Commandes de diffusion' })).toBeInTheDocument();
    const tabs = within(screen.getByRole('tablist', { name: 'Commandes de diffusion' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Incrustation', 'Auto', 'Rediffusion', 'Caméra']);
    expect(screen.getByRole('button', { name: 'Terminer la diffusion' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Classement' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Tableau de manche' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rediffusion instantanée · 30 s/ })).toBeInTheDocument();
    expect(screen.getByText('Message en haut de l’écran')).toBeInTheDocument();
    expect(screen.queryByText('Stream banner')).toBeNull();
    expect(screen.queryByText('Back to live stream')).toBeNull();
  });

  it('shows the automations in Welsh', () => {
    controls('/competitions/1/stream-controls?tab=auto', 'cy');
    expect(screen.getAllByText('Rhedeg awtomeiddio').length).toBeGreaterThan(0);
    expect(screen.getByText('Ar ôl pob ras')).toBeInTheDocument();
    expect(screen.getByText('Tabl rhagras am 20 eil')).toBeInTheDocument();
    expect(screen.queryByText('After each race')).toBeNull();
  });

  it('shows the replay and camera tabs in French', () => {
    controls('/competitions/1/stream-controls?tab=replay', 'fr');
    expect(screen.getByText('Enregistrements des courses')).toBeInTheDocument();
    expect(screen.getByText('Aucune rediffusion enregistrée')).toBeInTheDocument();
    expect(screen.queryByText('Saved replays')).toBeNull();
    cleanup();
    controls('/competitions/1/stream-controls?tab=camera', 'fr');
    expect(screen.getByText('À l’antenne')).toBeInTheDocument();
    expect(screen.getByText('12 spectateurs · En direct')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un téléphone caméra' }));
    expect(screen.getByRole('button', { name: 'Créer le code QR' })).toBeInTheDocument();
    expect(screen.getByText('Qualité')).toBeInTheDocument();
    expect(screen.queryByText('Add a camera phone')).toBeNull();
  });

  it('shows the control strip in French', async () => {
    const context = { competition: competition(), streams: [], ready: 1, reload: vi.fn(), invoke: vi.fn(), streamingEnabled: true, streamMessages: [], saveOverlay: save };
    render(<LanguageProvider initial="fr"><CompetitionContext.Provider value={context}><StreamControlStrip competitionId={1} sectionId={5} /></CompetitionContext.Provider></LanguageProvider>);
    await act(async () => {});
    expect(screen.getByText('Commandes de la diffusion et des incrustations')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom à distance 2x' }));
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('Demandé : Zoom 2x');
    fireEvent.click(screen.getByRole('button', { name: /Afficher les couloirs/ }));
    await act(async () => {});
    expect(save).toHaveBeenCalled();
    expect(screen.queryByText('Live Stream & Overlay Controls')).toBeNull();
  });

  it('shows the remote stream controller in Welsh', async () => {
    const value = { competition: competition(), streams: [liveStream({ id: 7 })], reload: vi.fn(), overlay: DEFAULT_OVERLAY, saveOverlay: save, streamingEnabled: true, invoke: vi.fn() as never, ready: 1, streamMessages: [] };
    render(<LanguageProvider initial="cy"><MemoryRouter><CompetitionContext.Provider value={value}><ProducePage /></CompetitionContext.Provider></MemoryRouter></LanguageProvider>);
    expect(screen.getByRole('heading', { name: 'Rheolydd ffrwd o bell' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chwyddo 2x' }));
    await act(async () => {});
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/7/command', { command: 'setZoom', value: '2' });
    expect(screen.getByText('Chwyddo’r camera wedi’i osod i 2x')).toBeInTheDocument();
    expect(screen.queryByText('Remote stream controller')).toBeNull();
  });

  it('shows the camera locks and the saved replays drawer in French', () => {
    render(<LanguageProvider initial="fr"><CameraLockButtons locks={{ exposure: false }} onChange={vi.fn()} /></LanguageProvider>);
    expect(screen.getByRole('group', { name: 'Verrous de la caméra' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verrouiller l’exposition' })).toBeInTheDocument();
    cleanup();
    render(<LanguageProvider initial="fr"><SavedReplaysDrawer open competitionId={99} onClose={vi.fn()} onSelectClip={vi.fn()} onCaptureBufferClip={vi.fn()} bufferedSeconds={42} /></LanguageProvider>);
    expect(screen.getByRole('dialog', { name: 'Rediffusions enregistrées' })).toBeInTheDocument();
    expect(screen.getByText('42 s en mémoire tampon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer la dernière minute' })).toBeInTheDocument();
    expect(screen.getByText('Aucune rediffusion enregistrée pour l’instant')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fermer les rediffusions enregistrées' })).toHaveFocus();
  });

  it('shows the replay inspector in Welsh', () => {
    const clip: SavedReplayClip = {
      id: 'c1', competitionId: 42, streamId: 7, arenaName: 'Main Arena', label: 'Heat 3 Decider', createdAt: '2026-10-24T14:30:00Z', durationSeconds: 15,
      mimeType: 'video/webm', blob: new Blob(['x'], { type: 'video/webm' }), url: 'blob:mock', savedHighlight: false, trimStartSeconds: 0, trimEndSeconds: 15, resolutionLabel: '1080p',
    };
    render(<LanguageProvider initial="cy"><ReplayInspector clip={clip} onClose={vi.fn()} /></LanguageProvider>);
    expect(screen.getByRole('dialog', { name: 'Archwiliwr ailchwarae' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cau’r ailchwarae' })).toHaveFocus();
    expect(screen.getByText('Wedi’i docio: 00:00.0 – 00:15.0 (15.0 eil)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadw’r uchafbwynt' })).toBeInTheDocument();
    expect(screen.getByText('Tapiwch y fideo ddwywaith i chwyddo’r ffocws')).toBeInTheDocument();
    expect(screen.queryByText('Save Highlight')).toBeNull();
  });
});

vi.mock('./streamControls/SavedOverlayLooks', () => ({ SavedOverlayLooks: () => null }));
