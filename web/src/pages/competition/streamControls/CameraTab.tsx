import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../../api';
import { Notice } from '../../../components/Notice';
import { QrCode } from '../../../components/QrCode';
import { CAMERA_ANGLES, QUALITY_CHOICES, cameraPhoneLink, cameraSettings, cameraStatus } from '../../../lib/streamControls';
import type { LiveStream, StreamCommand, StreamTelemetry } from '../../../types';
import { RefineList, RefineSection, RefineSwitchRow } from '../../refine/Refine';

interface Props {
  competitionId: number;
  streams: LiveStream[];
  onAir: LiveStream | null;
  telemetry?: Record<number, StreamTelemetry>;
  defaultArena: string;
  onPick: (stream: LiveStream) => void;
}

type Override = { quality?: string; windFilter?: boolean; sound?: boolean };

export function CameraTab({ competitionId, streams, onAir, telemetry, defaultArena, onPick }: Props) {
  const [showQr, setShowQr] = useState(false);
  const [angle, setAngle] = useState<string>(CAMERA_ANGLES[0]);
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [error, setError] = useState<string | null>(null);

  const arena = onAir?.arenaName || defaultArena;
  const link = useMemo(() => cameraPhoneLink(typeof window === 'undefined' ? '' : window.location.origin, competitionId, arena, angle), [competitionId, arena, angle]);

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
                <span className="rf-grow"><span className="rf-t1">{stream.arenaName} · {stream.angleName}</span><span className="rf-t2">{cameraStatus(stream)}</span></span>
                {on && <span className="sx-onair">ON AIR</span>}
              </button>
            );
          })}
        </RefineList></div>
      )}

      <button type="button" className="sx-addbar" aria-expanded={showQr} onClick={() => setShowQr((open) => !open)}>
        <Plus className="h-4 w-4" aria-hidden="true" />{showQr ? 'Hide QR code' : 'Add a camera phone'}
      </button>
      {showQr && (
        <div className="sx-panel" role="region" aria-label="Add a camera phone">
          <QrCode value={link} label="QR code to add a camera phone" className="sx-qr" />
          <div className="sx-panel-copy">
            <strong>Scan with the new phone</strong>
            <div className="sx-pills" role="radiogroup" aria-label="Camera position">
              {CAMERA_ANGLES.map((name) => (
                <button key={name} type="button" role="radio" aria-checked={angle === name} className="sx-pill" onClick={() => setAngle(name)}>{name}</button>
              ))}
            </div>
            <p className="sx-link">{link}</p>
            <button type="button" className="rf-btn" onClick={() => setShowQr(false)}>It’s connected</button>
          </div>
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
    </>
  );
}
