import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, KeyRound, QrCode, ShieldAlert, Upload, X } from 'lucide-react';
import {
  parseScorerSession,
  scorerApi,
  tokenFromHash,
  writeSavedScorerSession,
  writeScorerToken,
} from '../offline/scorerLink';
import type { ScorerSession } from '../types';

type ParsedPermissionTarget = { kind: 'scorer'; token: string };

const SAFE_TOKEN_RE = /^mgs_[A-Za-z0-9_-]{1,60}$/;

/**
 * Strictly parses a scanned QR value or pasted link/token.
 * Shape validation only: the server verifies the token and its permissions before anything is saved.
 */
function parsePermissionTarget(raw: string): ParsedPermissionTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Direct fragment `#t=<token>`
  if (trimmed.startsWith('#')) {
    const token = tokenFromHash(trimmed);
    return token && SAFE_TOKEN_RE.test(token) ? { kind: 'scorer', token } : null;
  }

  // Raw scorer token (e.g. `mgs_...`)
  if (!trimmed.includes('/') && !trimmed.includes(':') && SAFE_TOKEN_RE.test(trimmed)) {
    return { kind: 'scorer', token: trimmed };
  }

  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://mountedgames.local';
    const url = new URL(trimmed, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;

    if (url.pathname === '/score' || url.pathname === '/score/') {
      const fromHash = tokenFromHash(url.hash);
      const fromQuery = url.searchParams.get('t')?.trim() ?? null;
      const token = fromHash || fromQuery;
      if (token && SAFE_TOKEN_RE.test(token)) {
        return { kind: 'scorer', token };
      }
      return null;
    }

  } catch {
    return null;
  }

  return null;
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
}

function createQrDetector(): BarcodeDetectorLike | null {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
  try {
    const Ctor = (window as unknown as {
      BarcodeDetector: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
    }).BarcodeDetector;
    return new Ctor({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

export function QrPermissionScannerModal({
  open,
  onClose,
  onNavigate,
  onScorerVerified,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate?: (to: string) => void;
  onScorerVerified?: (token: string, session: ScorerSession) => void;
}) {
  if (!open) return null;
  return (
    <QrPermissionScannerDialog
      onClose={onClose}
      onNavigate={onNavigate}
      onScorerVerified={onScorerVerified}
    />
  );
}

function QrPermissionScannerDialog({
  onClose,
  onNavigate,
  onScorerVerified,
}: {
  onClose: () => void;
  onNavigate?: (to: string) => void;
  onScorerVerified?: (token: string, session: ScorerSession) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manualValue, setManualValue] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(() =>
    typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia
      ? 'Camera access is not available in this browser. Paste your permission link or upload a QR image below.'
      : null,
  );
  const verifyingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const navigateTo = useCallback((to: string) => {
    if (onNavigate) {
      onNavigate(to);
    } else if (typeof window !== 'undefined') {
      window.location.assign(to);
    }
  }, [onNavigate]);

  const handleCandidate = useCallback(async (raw: string) => {
    if (verifyingRef.current) return;
    setError(null);
    const parsed = parsePermissionTarget(raw);
    if (!parsed) {
      setError('Invalid permission QR code. A valid organiser-issued permission key is required.');
      return;
    }

    verifyingRef.current = true;
    setVerifying(true);
    try {
      const response = await scorerApi.get<unknown>('/scorer/session', {
        headers: { 'X-Scorer-Token': parsed.token },
      });
      if (!mountedRef.current) return;
      const session = parseScorerSession(response.data);
      if (!session) {
        setError('Invalid or expired permission key. Ask the organiser for a fresh QR code.');
        return;
      }
      writeScorerToken(parsed.token);
      writeSavedScorerSession(session);
      onScorerVerified?.(parsed.token, session);
      onClose();
      navigateTo(`/score#t=${encodeURIComponent(parsed.token)}`);
    } catch {
      if (!mountedRef.current) return;
      setError('Invalid or expired permission key. Ask the organiser for a fresh QR code.');
    } finally {
      verifyingRef.current = false;
      if (mountedRef.current) setVerifying(false);
    }
  }, [navigateTo, onClose, onScorerVerified]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let scanTimer: ReturnType<typeof setInterval> | null = null;
    const detector = createQrDetector();

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((mediaStream) => {
        if (cancelled) {
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = mediaStream;
        setCameraActive(true);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          void videoRef.current.play().catch(() => {});
        }
        if (detector) {
          scanTimer = setInterval(async () => {
            if (cancelled || verifyingRef.current || !videoRef.current || videoRef.current.readyState < 2) return;
            try {
              const codes = await detector.detect(videoRef.current);
              const rawValue = codes.find((c) => c.rawValue?.trim())?.rawValue;
              if (!cancelled && rawValue) {
                await handleCandidate(rawValue);
              }
            } catch {
              // Ignore transient frame detection errors
            }
          }, 300);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCameraActive(false);
          setCameraError('Camera permission was declined or unavailable. Paste your permission link or upload a QR photo below.');
        }
      });

    return () => {
      cancelled = true;
      if (scanTimer) clearInterval(scanTimer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [handleCandidate]);

  async function handleImageUpload(file: File | undefined) {
    if (!file) return;
    setError(null);
    const detector = createQrDetector();
    if (!detector || typeof createImageBitmap === 'undefined') {
      setError('QR image decoding is not supported by this browser. Paste the permission link or key instead.');
      return;
    }
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      if (!mountedRef.current) return;
      const rawValue = codes.find((c) => c.rawValue?.trim())?.rawValue;
      if (!rawValue) {
        setError('No QR code was found in that image. Try another photo or paste the permission link.');
        return;
      }
      await handleCandidate(rawValue);
    } catch {
      if (mountedRef.current) setError('Could not read that QR image. Paste the permission link or key instead.');
    } finally {
      bitmap?.close();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan permission QR code"
      className="mg-font fixed inset-0 z-[110] flex items-center justify-center bg-[rgb(var(--mg-overlay)/0.65)] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="mg-card flex w-full max-w-md flex-col gap-4 p-4 text-[rgb(var(--mg-ink))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 shrink-0 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
            <div>
              <h2 className="mg-display text-lg font-bold leading-tight text-[rgb(var(--mg-heading))]">
                Scan permission QR code
              </h2>
              <p className="text-xs text-[rgb(var(--mg-muted))]">
                Scan the scoring or camera permission link from your organiser.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR scanner"
            className="mg-icon-btn !h-9 !w-9"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative aspect-square max-h-60 w-full overflow-hidden rounded-xl bg-black/90 flex items-center justify-center">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            aria-label="QR code camera scanner"
            className={`h-full w-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
          />
          {!cameraActive && (
            <div className="flex flex-col items-center gap-2 p-4 text-center text-xs text-white/80">
              <Camera className="h-7 w-7 text-white/60" aria-hidden="true" />
              <span>{cameraError ?? 'Starting camera…'}</span>
            </div>
          )}
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs font-medium text-red-900">
            <ShieldAlert className="h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <label className="mg-btn mg-btn-secondary !min-h-10 flex-1 cursor-pointer !text-xs">
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>Scan QR photo</span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="Upload QR code image"
              onChange={(e) => void handleImageUpload(e.target.files?.[0])}
            />
          </label>
        </div>

        <form
          className="flex flex-col gap-2 border-t border-[rgb(var(--mg-rule-soft))] pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCandidate(manualValue);
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-semibold text-[rgb(var(--mg-muted))]">
            <span className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              Or enter permission link / secret key
            </span>
            <input
              type="text"
              aria-label="Permission link or key"
              placeholder="Paste /score#t=… link or mgs_… key"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              className="input !min-h-10 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={verifying || !manualValue.trim()}
            className="mg-btn mg-btn-primary !min-h-11 text-sm"
          >
            {verifying ? 'Verifying key…' : 'Verify permission key'}
          </button>
        </form>
      </div>
    </div>
  );
}
