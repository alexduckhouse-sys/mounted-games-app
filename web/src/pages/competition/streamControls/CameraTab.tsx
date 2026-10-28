import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../../api';
import { Notice } from '../../../components/Notice';
import { QrCode } from '../../../components/QrCode';
import { useToast } from '../../../components/Toast';
import { usePageVisible } from '../../../hooks/usePageVisible';
import { useLiteMode } from '../../../lite/LiteModeContext';
import type { StreamInvoke } from '../../../live/streamRuntime';
import { CAMERA_ANGLES, QUALITY_CHOICES, cameraLinkLabel, cameraSettings, cameraStatus, newCamera, previewStreams } from '../../../lib/streamControls';
import { scorerLinkUrl } from '../../../offline/scorerLink';
import type { CreatedScorerLink, LiveStream, StreamCommand, StreamTelemetry } from '../../../types';
import { apiMessage } from '../../operations/types';
import { RefineChoiceRow, RefineList, RefineSection, RefineSwitchRow } from '../../refine/Refine';
import { CameraPreview } from './CameraPreview';

interface Props {
  competitionId: number;
  streams: LiveStream[];
  onAir: LiveStream | null;
  telemetry?: Record<number, StreamTelemetry>;
  /** Arenas a camera link can be made for (`cameraArenas`), so the API accepts the one chosen. */
  arenas: string[];
  onPick: (stream: LiveStream) => void;
  /** The competition's hub, for the small live previews. Without it the list is text only. */
  invoke?: StreamInvoke;
  ready?: number;
  /** What the big player above is showing, so its camera's preview reuses that picture. */
  monitor?: { streamId: number | null; media: MediaStream | null };
}

type Override = { quality?: string; windFilter?: boolean; sound?: boolean };

/** Camera links are kept by arena and position while the tab is open, so the same choice shows the same QR code. */
const linkKey = (arena: string, angle: string) => `${arena}\n${angle}`;
const ANGLE_OPTIONS = CAMERA_ANGLES.map((name) => ({ value: name as string, label: name }));

export function CameraTab({ competitionId, streams, onAir, telemetry, arenas, onPick, invoke, ready = 0, monitor }: Props) {
  const [showQr, setShowQr] = useState(false);
  const [arenaChoice, setArenaChoice] = useState<string | null>(null);
  const [angle, setAngle] = useState<string>(CAMERA_ANGLES[0]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [making, setMaking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  /** The cameras already live when the panel opened, so only a new one counts as "connected". */
  const [known, setKnown] = useState<number[]>([]);
  const [connected, setConnected] = useState<{ id: number; text: string } | null>(null);
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { lite } = useLiteMode();
  const visible = usePageVisible();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const onAirArena = onAir ? arenas.find((name) => name.trim().toLowerCase() === onAir.arenaName.trim().toLowerCase()) : undefined;
  const arena = arenaChoice && arenas.includes(arenaChoice) ? arenaChoice : onAirArena ?? arenas[0] ?? '';
  const key = linkKey(arena, angle);
  const link = links[key];

  // The phone has scanned and gone live: put the panel away and say so. Adjusting state while rendering
  // (rather than in an effect) closes the panel in the same paint the camera appears.
  const joined = showQr && link ? newCamera(streams, arena, angle, known) : null;
  if (joined) {
    setShowQr(false);
    setConnected({ id: joined.id, text: `${joined.angleName} camera connected` });
  }
  const { show } = toast;
  useEffect(() => { if (connected) show(connected.text); }, [connected, show]);

  function togglePanel() {
    if (!showQr) { setKnown(streams.map((stream) => stream.id)); setLinkError(null); }
    setShowQr((open) => !open);
  }

  async function makeLink() {
    if (making || !arena || links[key]) return;
    const wanted = { key, arena, angle };
    setMaking(true);
    setLinkError(null);
    try {
      const { data } = await api.post<CreatedScorerLink>(`/competitions/${competitionId}/scorer-links`, {
        label: cameraLinkLabel(wanted.arena, wanted.angle), arenaName: wanted.arena, scope: 1,
      });
      if (!data || typeof data.token !== 'string' || !data.token) throw new Error('No token in the reply');
      if (mounted.current) setLinks((current) => ({ ...current, [wanted.key]: scorerLinkUrl(window.location.origin, data.token, wanted.angle) }));
    } catch (problem) {
      if (mounted.current) setLinkError(apiMessage(problem, 'Couldn’t make the camera link. Check your signal and try again.'));
    } finally {
      if (mounted.current) setMaking(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      show('Link copied');
    } catch {
      setLinkError('Couldn’t copy the link. Press and hold it to copy, or scan the QR code.');
    }
  }

  async function send(stream: LiveStream, command: StreamCommand['command'], value: string | null): Promise<boolean> {
    setError(null);
    try {
      await api.post(`/competitions/${competitionId}/streams/${stream.id}/command`, { command, value });
      return true;
    } catch {
      setError('Couldn’t reach the camera phone. Check your signal and try again.');
      return false;
    }
  }
  const remember = (stream: LiveStream, patch: Override) => setOverrides((current) => ({ ...current, [stream.id]: { ...current[stream.id], ...patch } }));

  async function pick(stream: LiveStream) {
    if (await send(stream, 'selectAngle', String(stream.id))) onPick(stream);
  }

  const settings = onAir ? { ...cameraSettings(onAir, telemetry?.[onAir.id]), ...overrides[onAir.id] } : null;
  // Previews: never in Lite mode, never while the app is in the background, and only for the arena on air.
  const previewsOn = !lite && visible && !!invoke && typeof RTCPeerConnection !== 'undefined';
  const previewArena = onAir?.arenaName ?? streams[0]?.arenaName ?? '';
  const previewIds = previewsOn ? previewStreams(streams, previewArena).map((stream) => stream.id) : [];

  return (
    <>
      <RefineSection title="On air" />
      {streams.length === 0 ? (
        <p className="rf-note">No camera is live. Open the stream on a phone to start one.</p>
      ) : (
        <div role="radiogroup" aria-label="Camera"><RefineList as="div">
          {streams.map((stream) => {
            const on = onAir?.id === stream.id;
            return (
              <button key={stream.id} type="button" role="radio" aria-checked={on} className="rf-row" onClick={() => void pick(stream)}>
                <span className="sx-radio" aria-hidden="true" />
                {invoke && previewIds.includes(stream.id) && (
                  <CameraPreview stream={stream} invoke={invoke} ready={ready}
                    monitorMedia={monitor && monitor.streamId === stream.id ? monitor.media : undefined} />
                )}
                <span className="rf-grow"><span className="rf-t1">{stream.arenaName} · {stream.angleName}</span><span className="rf-t2">{cameraStatus(stream)}</span></span>
                {on && <span className="sx-onair">ON AIR</span>}
              </button>
            );
          })}
        </RefineList></div>
      )}

      <button type="button" className="sx-addbar" aria-expanded={showQr} onClick={togglePanel}>
        <Plus className="h-4 w-4" aria-hidden="true" />Add a camera phone
      </button>
      {showQr && (
        <div className="sx-panel sx-camera-panel" role="region" aria-label="Add a camera phone">
          <RefineList as="div" label="Camera phone">
            {arenas.length > 1 && (
              <RefineChoiceRow label="Arena" value={arena} options={arenas.map((name) => ({ value: name, label: name }))}
                onChange={(next) => { setArenaChoice(next); setLinkError(null); }} />
            )}
            <RefineChoiceRow label="Position" value={angle} options={ANGLE_OPTIONS} allowOther
              onChange={(next) => { setAngle(next); setLinkError(null); }} />
          </RefineList>
          {link ? (
            <div className="sx-camera-link">
              <QrCode value={link} label={`QR code for the ${angle} camera`} className="sx-qr" />
              <div className="sx-panel-copy">
                <strong>Scan with the camera phone</strong>
                <span className="rf-t2">No account needed. It goes live as {arena} · {angle}.</span>
                <p className="sx-link">{link}</p>
                <p className="rf-t2" role="status">Waiting for the camera to go live…</p>
                <div className="sx-pills">
                  <button type="button" className="rf-btn" onClick={() => void copy(link)}>Copy link</button>
                  <button type="button" className="rf-btn" onClick={() => setShowQr(false)}>Close</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="sx-pills">
              <button type="button" className="rf-btn rf-btn-primary" disabled={making || !arena} onClick={() => void makeLink()}>
                {making ? 'Making QR code…' : 'Make QR code'}
              </button>
              <button type="button" className="rf-btn" onClick={() => setShowQr(false)}>Close</button>
            </div>
          )}
          {linkError && (
            <Notice className="sx-status" actionLabel={link ? undefined : 'Try again'} onAction={() => void makeLink()} actionDisabled={making}>{linkError}</Notice>
          )}
        </div>
      )}

      {error && <Notice className="sx-status">{error}</Notice>}

      {onAir && settings && (
        <>
          <RefineSection title="Settings" meta={`${onAir.arenaName} · ${onAir.angleName}`} />
          <RefineList as="div" label="Camera settings">
            <div className="rf-row sx-row-pills">
              <span className="rf-grow rf-t1">Quality</span>
              <div className="sx-pills" role="radiogroup" aria-label="Quality">
                {QUALITY_CHOICES.map((choice) => (
                  <button key={choice.preset} type="button" role="radio" aria-checked={settings.quality === choice.preset} className="sx-pill"
                    onClick={() => void send(onAir, 'setQualityPreset', choice.preset).then((ok) => { if (ok) remember(onAir, { quality: choice.preset }); })}>{choice.label}</button>
                ))}
              </div>
            </div>
            <RefineSwitchRow label="Wind filter" on={settings.windFilter}
              onChange={(next) => void send(onAir, 'windFilter', String(next)).then((ok) => { if (ok) remember(onAir, { windFilter: next }); })} />
            <RefineSwitchRow label="Sound" on={settings.sound}
              onChange={(next) => void send(onAir, 'mute', String(!next)).then((ok) => { if (ok) remember(onAir, { sound: next }); })} />
            <div className="rf-row">
              <span className="rf-grow rf-t1">Flip camera</span>
              <button type="button" className="rf-btn" onClick={() => void send(onAir, 'flipCamera', null)}>Flip</button>
            </div>
          </RefineList>
        </>
      )}
      {toast.node}
    </>
  );
}
