import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, KeyRound, QrCode, ShieldAlert, Upload, X } from 'lucide-react';
import { api } from '../api';
import {
  parseScorerSession,
   tokenFromHash,
  writeSavedScorerSession,
  writeScorerToken,
} from '../offline/scorerLink';
import type { ScorerSession } from '../types';

export type ParsedPermissionTarget =
  | { kind: 'scorer'; token: string }
  | { kind: 'broadcast'; competitionId: number; pair: string };

const SAFE_TOKEN_RE = /^[A-Za-z0-9_-]{6,}$/;
const SAFE_PAIR_RE = /^[A-Za-z0-9_-]{16,}$/;

/**
 * Strictly parses a scanned QR value or pasted link/token.
 * Rejects any URL or string that does not carry a cryptographic scorer token or broadcast pairing key.
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
    const url = new URL(trimmed, window.location.origin);

    if (url.pathname === '/score' || url.pathname === '/score/') {
      const fromHash = tokenFromHash(url.hash);
      const fromQuery = url.searchParams.get('t')?.trim() ?? null;
      const token = fromHash || fromQuery;
      return token && SAFE_TOKEN_RE.test(token) ? { kind: 'scorer', token } : null;
    }

    const broadcastMatch = url.pathname.match(/^\/competitions\/(\d+)\/broadcast\/?$/);
    if (broadcastMatch) {
      const competitionId = Number(broadcastMatch[1]);
      const pair = url.searchParams.get('pair')?.trim() ?? '';
      return competitionId > 0 && SAFE_PAIR_RE.test(pair)
        ? { kind: 'broadcast', competitionId, pair }
        : null;
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
  if (!('BarcodeDetector' in window)) return null;
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manualValue, setManualValue] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(() =>
    !navigator.mediaDevices?.getUserMedia
      ? 'Camera access is not available in this browser. Paste your permission link or upload a QR image below.'
      : null,
  );
  const verifyingRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);

  const navigateTo = useCallback((to: string) => {
    if (onNavigate) onNavigate(to);
    else window.location.assign(to);
  }, [onNavigate]);

  const handleCandidate = useCallback(async (raw: string) => {
    if (verifyingRef.current) return;
    setError(null);
    const parsed = parsePermissionTarget(raw);
    if (!parsed) {
      setError('Invalid permission QR code. A valid organiser-issued permission key is required.');
      return;
    }

    if (parsed.kind === 'broadcast') {
      onClose();
      navigateTo(`/competitions/${parsed.competitionId}/broadcast?pair=${encodeURIComponent(parsed.pair)}`);
      return;
    }

    verifyingRef.current = true;
    setVerifying(true);
    try {
      const response = await api.get<unknown>('/scorer/session', {
        headers: { 'X-Scorer-Token': parsed.token },
      });
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
      setError('Invalid or expired permission key. Ask the organiser for a fresh QR code.');
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  }, [navigateTo, onClose, onScorerVerified]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) return;

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
        const video = videoRef.current;
        if (video) {
          video.srcObject = mediaStream;
          void video.play().catch(() => {});
        }
        if (detector && video) {
          scanTimer = setInterval(async () => {
            if (verifyingRef.current || video.readyState < 2) return;
            try {
              const codes = await detector.detect(video);
              const rawValue = codes.find((c) => c.rawValue?.trim())?.rawValue;
              if (rawValue) await handleCandidate(rawValue);
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
    try {
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      const rawValue = codes.find((c) => c.rawValue?.trim())?.rawValue;
      if (!rawValue) {
        setError('No QR code was found in that image. Try another photo or paste the permission link.');
        return;
      }
      await handleCandidate(rawValue);
    } catch {
      setError('Could not read that QR image. Paste the permission link or key instead.');
    }
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label="Scan permission QR code"
      className="mg-font fixed inset-0 z-[100] m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/75 p-4 backdrop-blur-xs backdrop:bg-black/75"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
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
                Steward scoring &amp; camera pairing require a verified organiser key
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
    </dialog>,
    document.body,
  );
}
