import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Megaphone, Save, SkipForward, Trash2, X } from 'lucide-react';
import { api } from '../../api';
import { sponsorsFor } from '../../lib/sponsors';
import { CompetitionContext, useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { StreamOverlays } from '../../components/stream/StreamOverlays';
import { DEFAULT_OVERLAY, ELEMENT_PLACES, parseLook, type OverlayElement, type OverlayLook, type OverlayPlace } from '../../lib/overlays';
import type { OverlayBannerStyle, OverlayMode, StreamOverlay } from '../../types';
import type { OverlaySaveResult } from '../../hooks/useStreamOverlay';
import { readMessages, writeMessages } from '../../lib/overlayMessages';
import { ScoreCardQueue } from './ScoreCardQueue';
import { SavedLooks } from './SavedLooks';
import { FilmingBanner } from '../../components/FilmingBanner';

const STYLES: { value: OverlayBannerStyle; label: string }[] = [{ value: 0, label: 'Ticker' }, { value: 1, label: 'Lower bar' }, { value: 2, label: 'Alert' }];
const MODES: { value: OverlayMode; label: string }[] = [{ value: 0, label: 'Auto' }, { value: 1, label: 'On' }, { value: 2, label: 'Off' }];
const ELEMENTS: { key: OverlayElement; label: string }[] = [
  { key: 'strip', label: 'Now racing strip' }, { key: 'scoreCard', label: 'Score card' }, { key: 'banner', label: 'Banner' },
  { key: 'viewers', label: 'Viewer count' }, { key: 'arena', label: 'Arena name' }, { key: 'clock', label: 'Clock' }, { key: 'logo', label: 'Event logo' },
];
const PLACE_LABELS: Record<OverlayPlace, string> = {
  'top-left': 'Top left', 'top-right': 'Top right', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right', top: 'Top', bottom: 'Bottom', right: 'Right',
};
const SPONSOR_MODES: { value: OverlayMode; label: string }[] = [{ value: 0, label: 'In breaks' }, { value: 1, label: 'Always' }, { value: 2, label: 'Off' }];
const OUTCOME: Record<Exclude<OverlaySaveResult, 'saved'>, string> = {
  conflict: 'Someone else just changed the overlays. This is their version, so make your change again if you still need it.',
  failed: 'Couldn’t save. Check your connection and try again.',
};

/** Settings edited together and saved with one button; the banner saves on its own. */
interface Draft { stripMode: OverlayMode; scoreCardMode: OverlayMode; scoreCardDelaySeconds: number; scoreCardSeconds: number; look: OverlayLook }
const draftOf = (overlay: StreamOverlay): Draft => ({
  stripMode: overlay.stripMode, scoreCardMode: overlay.scoreCardMode,
  scoreCardDelaySeconds: overlay.scoreCardDelaySeconds, scoreCardSeconds: overlay.scoreCardSeconds, look: parseLook(overlay.look),
});

function Segmented<T extends number | string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="mg-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  );
}

/** The producer screen: banners, the now-racing strip, score card timing and the event's look, for every arena. */
export function ProducePage() {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  if (!canOrganise(competition)) return <p className="pt-6">Only the event’s organisers can change what viewers see.</p>;
  return <Producer key={competition.id} />;
}

function Producer() {
  const context = useCompetition();
  const { competition, streams, saveOverlay } = context;
  const overlay = context.overlay ?? DEFAULT_OVERLAY;
  const arenas = useMemo(() => [...new Set([
    ...streams.map((stream) => stream.arenaName),
    ...competition.sessions.map((session) => session.arenaName).filter((name): name is string => !!name),
  ])].sort(), [streams, competition.sessions]);

  const [bannerText, setBannerText] = useState('');
  const [bannerStyle, setBannerStyle] = useState<OverlayBannerStyle>(1);
  const [bannerArenas, setBannerArenas] = useState<string[]>([]);
  const [messages, setMessages] = useState(() => readMessages(competition.id));
  const [edited, setEdited] = useState<Draft | null>(null);
  const draft = edited ?? draftOf(overlay);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(change: (current: StreamOverlay) => StreamOverlay, done?: () => void) {
    if (!saveOverlay) return;
    setBusy(true);
    setNotice(null);
    const outcome = await saveOverlay(change);
    setBusy(false);
    if (outcome === 'saved') done?.();
    else setNotice(OUTCOME[outcome]);
    if (outcome === 'conflict') setEdited(null);
  }

  const videoSponsors = sponsorsFor(context.sponsors ?? [], 'BreakStream');
  const setSponsorMode = (sponsorMode: OverlayMode) => run((current) => ({ ...current, sponsorMode }));
  async function skipSponsor() {
    setNotice(null);
    try {
      await api.post(`/competitions/${competition.id}/sponsors/skip`);
    } catch {
      setNotice('Couldn’t skip. Check your connection and try again.');
    }
  }

  const putBannerOnAir = () => run((current) => ({ ...current, bannerText: bannerText.trim(), bannerStyle, bannerArenas }));
  const clearBanner = () => run((current) => ({ ...current, bannerText: null }));
  const saveLook = () => run((current) => ({ ...current, ...draft, look: draft.look }), () => setEdited(null));
  const edit = (change: Partial<Draft>) => setEdited({ ...draft, ...change });
  const editElement = (key: OverlayElement, change: Partial<OverlayLook['elements'][OverlayElement]>) =>
    edit({ look: { ...draft.look, elements: { ...draft.look.elements, [key]: { ...draft.look.elements[key], ...change } } } });

  function saveMessage() {
    const text = bannerText.trim();
    if (!text || messages.some((m) => m.text === text)) return;
    const next = [...messages, { text, style: bannerStyle }];
    setMessages(next);
    writeMessages(competition.id, next);
  }
  function forgetMessage(text: string) {
    const next = messages.filter((m) => m.text !== text);
    setMessages(next);
    writeMessages(competition.id, next);
  }

  // The preview draws the real overlays with the unsaved look, over the first arena's name.
  const previewOverlay: StreamOverlay = { ...overlay, ...draft, look: draft.look };
  const previewStream = {
    id: 0, competitionId: competition.id, arenaName: overlay.bannerArenas[0] ?? arenas[0] ?? 'Main arena', angleName: 'Preview',
    status: 0 as const, caption: null, audioMuted: false, hasAudio: false, startedAt: '', viewerCount: 48, generation: 0,
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-4">
      <div className="flex items-center gap-2">
        <Link to={`/competitions/${competition.id}/chat`} className="mg-nav-btn !px-0" aria-label="Back to Live & stream"><ChevronLeft className="h-5 w-5" /></Link>
        <h1 className="mg-h1 mg-h1-sm flex-1">Producer</h1>
        <span className="text-sm text-[rgb(var(--mg-muted))]">{streams.filter((s) => s.status !== 2).length} live</span>
      </div>
      {notice && (
        <div className="live-action-error" role="alert">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X aria-hidden="true" /></button>
        </div>
      )}

      <FilmingBanner competitionId={competition.id} refreshKey={competition.sessions} />

      <section className="mg-card flex flex-col gap-3 p-4" aria-labelledby="banner-title">
        <div className="flex items-center justify-between gap-2">
          <h2 id="banner-title" className="flex items-center gap-2 font-bold"><Megaphone className="h-4 w-4" aria-hidden="true" />Banner</h2>
          <span className="text-sm">{overlay.bannerText ? <>On air: <strong>{overlay.bannerText}</strong></> : 'No banner up'}</span>
        </div>
        <label className="mg-field">
          <span className="sr-only">Banner text</span>
          <input value={bannerText} maxLength={140} onChange={(event) => setBannerText(event.target.value)} placeholder="e.g. Lunch break until 1pm" />
        </label>
        <Segmented label="Banner style" options={STYLES} value={bannerStyle} onChange={setBannerStyle} />
        {arenas.length > 1 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show in">
            <span className="text-xs font-bold uppercase tracking-wider">Show in</span>
            {arenas.map((arena) => {
              const on = bannerArenas.includes(arena);
              return <button key={arena} type="button" className="mg-pill" aria-pressed={on}
                onClick={() => setBannerArenas(on ? bannerArenas.filter((a) => a !== arena) : [...bannerArenas, arena])}>{arena}</button>;
            })}
            <span className="text-xs text-[rgb(var(--mg-muted))]">{bannerArenas.length === 0 ? 'All arenas' : ''}</span>
          </div>
        )}
        {messages.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="Saved messages">
            {messages.map((message) => (
              <li key={message.text} className="flex items-center gap-2">
                <button type="button" className="flex-1 truncate text-left underline" onClick={() => { setBannerText(message.text); setBannerStyle(message.style); }}>{message.text}</button>
                <span className="text-xs">{STYLES[message.style].label}</span>
                <button type="button" aria-label={`Forget “${message.text}”`} onClick={() => forgetMessage(message.text)}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="mg-btn mg-btn-primary" disabled={busy || !bannerText.trim()} onClick={putBannerOnAir}>{overlay.bannerText ? 'Update banner' : 'Put on air'}</button>
          <button type="button" className="mg-btn mg-btn-secondary" disabled={busy || !overlay.bannerText} onClick={clearBanner}>Clear banner</button>
          <button type="button" className="mg-btn mg-btn-secondary" disabled={!bannerText.trim()} onClick={saveMessage}>Save message</button>
        </div>
      </section>

      <section className="mg-card flex flex-col gap-3 p-4" aria-labelledby="sponsors-title">
        <h2 id="sponsors-title" className="font-bold">Sponsors on the video</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-32 text-sm">Sponsor cards</span>
          <Segmented label="Sponsor cards" options={SPONSOR_MODES} value={overlay.sponsorMode} onChange={(mode) => void setSponsorMode(mode)} />
        </div>
        <p className="text-sm text-[rgb(var(--mg-muted))]">
          {videoSponsors.length === 0 ? 'No sponsors are set to show on the video during breaks.' : `${videoSponsors.length} ${videoSponsors.length === 1 ? 'sponsor' : 'sponsors'} in the break rotation, headline first.`}
        </p>
        <div>
          <button type="button" className="mg-btn mg-btn-secondary !min-h-11" disabled={videoSponsors.length === 0 || overlay.sponsorMode === 2} onClick={() => void skipSponsor()}><SkipForward className="h-4 w-4" aria-hidden="true" />Skip sponsor</button>
        </div>
      </section>

      <ScoreCardQueue competitionId={competition.id} cards={context.scoreCards ?? []} onError={setNotice} />

      <section className="mg-card flex flex-col gap-3 p-4" aria-labelledby="look-title">
        <h2 id="look-title" className="font-bold">Strip, score cards and look</h2>
        <SavedLooks current={draft.look} onApply={(look) => edit({ look })} onError={setNotice} />
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-32 text-sm">Now racing strip</span>
          <Segmented label="Now racing strip" options={MODES} value={draft.stripMode} onChange={(stripMode) => edit({ stripMode })} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-32 text-sm">Score cards</span>
          <Segmented label="Score cards" options={MODES.filter((m) => m.value !== 1)} value={draft.scoreCardMode === 1 ? 0 : draft.scoreCardMode} onChange={(scoreCardMode) => edit({ scoreCardMode })} />
          <label className="flex items-center gap-1 text-sm">Show after
            <input className="w-14 rounded border px-1" type="number" min={0} max={30} value={draft.scoreCardDelaySeconds}
              onChange={(event) => edit({ scoreCardDelaySeconds: Math.min(30, Math.max(0, Number(event.target.value) || 0)) })} /> s</label>
          <label className="flex items-center gap-1 text-sm">for
            <input className="w-14 rounded border px-1" type="number" min={3} max={60} value={draft.scoreCardSeconds}
              onChange={(event) => edit({ scoreCardSeconds: Math.min(60, Math.max(3, Number(event.target.value) || 3)) })} /> s</label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">Highlight <input type="color" value={draft.look.accent} onChange={(event) => edit({ look: { ...draft.look, accent: event.target.value } })} /></label>
          <label className="flex items-center gap-2 text-sm">Background <input type="color" value={draft.look.background} onChange={(event) => edit({ look: { ...draft.look, background: event.target.value } })} /></label>
          <Segmented label="Size" options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]}
            value={draft.look.size} onChange={(size) => edit({ look: { ...draft.look, size } })} />
        </div>
        <label className="mg-field">
          <span className="text-sm">Logo link (https)</span>
          <input value={draft.look.logoUrl ?? ''} placeholder="https://…" onChange={(event) => edit({ look: { ...draft.look, logoUrl: event.target.value.trim() || null } })} />
        </label>
        <table className="text-sm">
          <caption className="sr-only">What viewers see</caption>
          <tbody>
            {ELEMENTS.map(({ key, label }) => (
              <tr key={key}>
                <th scope="row" className="py-1 text-left font-normal">{label}</th>
                <td><input type="checkbox" aria-label={`Show ${label.toLowerCase()}`} checked={draft.look.elements[key].show} onChange={(event) => editElement(key, { show: event.target.checked })} /></td>
                <td>
                  <select aria-label={`Where to show ${label.toLowerCase()}`} value={draft.look.elements[key].place} onChange={(event) => editElement(key, { place: event.target.value as OverlayPlace })}>
                    {ELEMENT_PLACES[key].map((place) => <option key={place} value={place}>{PLACE_LABELS[place]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="mg-btn mg-btn-primary" disabled={busy || !edited} onClick={saveLook}><Save className="h-4 w-4" aria-hidden="true" />Save for this event</button>
          <button type="button" className="mg-btn mg-btn-secondary" disabled={!edited} onClick={() => setEdited(null)}>Undo changes</button>
        </div>
      </section>

      <section aria-labelledby="preview-title" className="flex flex-col gap-2">
        <h2 id="preview-title" className="font-bold">Preview</h2>
        <div className="relative aspect-video overflow-hidden rounded-xl bg-[rgb(var(--mg-header-deep))]" aria-hidden="true">
          <CompetitionContext.Provider value={{ ...context, overlay: previewOverlay }}>
            <StreamOverlays stream={previewStream} label="Seniors · Heat 2" reconnecting={false} muted={false} onSound={() => {}} />
          </CompetitionContext.Provider>
        </div>
      </section>
    </div>
  );
}
