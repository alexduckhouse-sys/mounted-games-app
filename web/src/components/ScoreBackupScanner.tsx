import { useT } from '../i18n/LanguageContext';
import { useEffect, useRef, useState } from 'react';
import { joinBackupFrames, readBackupFrame } from '../offline/outboxRecovery';
import { Notice } from './Notice';

interface Detector { detect(source: HTMLVideoElement | ImageBitmap): Promise<Array<{ rawValue?: string }>> }
function detector(): Detector | null {
  const Constructor = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => Detector }).BarcodeDetector;
  try { return Constructor ? new Constructor({ formats: ['qr_code'] }) : null; } catch { return null; }
}
export function ScoreBackupScanner({ onBackup }: { onBackup: (raw: string) => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const frames = useRef<string[]>([]);
  const onBackupRef = useRef(onBackup);
  useEffect(() => { onBackupRef.current = onBackup; }, [onBackup]);
  function accept(raw: string) {
    try {
      readBackupFrame(raw);
      if (!frames.current.includes(raw)) frames.current.push(raw);
      const result = joinBackupFrames(frames.current);
      setError('');
      setProgress(t('reliability.scanned', { n: result.received, total: result.total }));
      if (result.raw) { onBackupRef.current(result.raw); setActive(false); }
    } catch (e) { setError(e instanceof Error ? e.message : t('reliability.readCodeError')); }
  }
  const acceptRef = useRef(accept);
  useEffect(() => { acceptRef.current = accept; });
  useEffect(() => {
    if (!active) return;
    const reader = detector();
    if (!reader || !navigator.mediaDevices?.getUserMedia) return;
    let stopped = false, scanning = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(media => {
      if (stopped) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media;
      if (video.current) { video.current.srcObject = media; void video.current.play().catch(() => {}); }
      timer = setInterval(async () => {
        if (stopped || scanning || !video.current || video.current.readyState < 2) return;
        scanning = true;
        try {
          const codes = await reader.detect(video.current);
          if (!stopped) for (const code of codes) if (code.rawValue) acceptRef.current(code.rawValue);
        } catch { /* A blurred camera frame is retried. */ }
        finally { scanning = false; }
      }, 350);
    }).catch(() => { if (!stopped) { setError(t('reliability.cameraBlocked')); setActive(false); } });
    return () => { stopped = true; clearInterval(timer); stream?.getTracks().forEach(track => track.stop()); };
  }, [active, t]);
  return <div className="space-y-2">
    <button type="button" className="sc-link" onClick={() => {
      if (!detector()) { setError(t('reliability.noScanner')); return; }
      setError(''); setActive(value => !value);
    }}>{active ? t('reliability.stop') : t('reliability.scan')}</button>
    {active && <video ref={video} muted playsInline autoPlay aria-label={t('reliability.scanner')} className="w-full max-h-64 bg-black" />}
    {progress && <p role="status">{progress}</p>}
    {progress && <button type="button" className="sc-link" onClick={() => { frames.current = []; setProgress(''); setError(''); }}>{t('reliability.clear')}</button>}
    {error && <Notice>{error}</Notice>}
  </div>;
}
