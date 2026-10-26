import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, KeyRound, Upload } from 'lucide-react';
import {
  parseScorerSession,
  scorerApi,
  tokenFromHash,
  writeSavedScorerSession,
  writeScorerToken,
} from '../offline/scorerLink';
import type { ScorerSession } from '../types';
import { Notice } from './Notice';
import { Sheet } from './Sheet';

type ParsedPermissionTarget = { kind: 'scorer'; token: string };

const NOT_ACCEPTED = 'That QR code isn’t a scoring or camera code, or it has stopped working. Ask the organiser for a new one.';

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
  const pasteRef = useRef<HTMLInputElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(() =>
    typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia
      ? 'This browser can’t use the camera. Paste the link or upload a photo of the QR code instead.'
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
      setError(NOT_ACCEPTED);
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
        setError(NOT_ACCEPTED);
        return;
      }
      writeScorerToken(parsed.token);
      writeSavedScorerSession(session);
      onScorerVerified?.(parsed.token, session);
      onClose();
      navigateTo(`/score#t=${encodeURIComponent(parsed.token)}`);
    } catch {
      if (!mountedRef.current) return;
      setError(NOT_ACCEPTED);
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
          setCameraError('The camera is blocked. Paste the link or upload a photo of the QR code instead.');
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
      setError('This browser can’t read QR photos. Paste the link instead.');
      return;
    }
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      if (!mountedRef.current) return;
      const rawValue = codes.find((c) => c.rawValue?.trim())?.rawValue;
      if (!rawValue) {
        setError('There’s no QR code in that photo. Try another photo or paste the link.');
        return;
      }
      await handleCandidate(rawValue);
    } catch {
      if (mountedRef.current) setError('Couldn’t read that photo. Try another photo or paste the link.');
    } finally {
      bitmap?.close();
    }
  }

  return createPortal(
    <Sheet title="Scan the QR code" description="Point the camera at the scoring or camera QR code from your organiser." onClose={onClose}>
      {({ close }) => (
        <>
          {cameraError && !cameraActive ? (
            <Notice role="status" actionLabel="Paste the link" onAction={() => pasteRef.current?.focus()}>{cameraError}</Notice>
          ) : (
            <div className="relative flex aspect-square max-h-60 w-full items-center justify-center overflow-hidden rounded-xl bg-black/90">
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
                  <span>Starting camera…</span>
                </div>
              )}
            </div>
          )}

          {error && <Notice>{error}</Notice>}

          <div className="kit-acts">
            <label className="kit-pill kit-pill-fill cursor-pointer">
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span>Upload a photo</span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                aria-label="Upload QR code image"
                onChange={(e) => void handleImageUpload(e.target.files?.[0])}
              />
            </label>
            {!(cameraError && !cameraActive) && <button type="button" className="kit-pill" onClick={() => pasteRef.current?.focus()}>Paste the link</button>}
            <button type="button" className="kit-pill" aria-label="Close QR scanner" onClick={() => close()}>Close</button>
          </div>

          <form
            className="flex flex-col gap-2 border-t border-[rgb(var(--mg-rule-soft))] pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCandidate(manualValue);
            }}
          >
            <label className="kit-sheet-field">
              <span className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                Or enter permission link / secret key
              </span>
              <input
                ref={pasteRef}
                type="text"
                aria-label="Permission link or key"
                placeholder="Paste /score#t=… link or mgs_… key"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={verifying || !manualValue.trim()}
              className="kit-pill kit-pill-fill"
            >
              {verifying ? 'Verifying key…' : 'Verify permission key'}
            </button>
          </form>
        </>
      )}
    </Sheet>,
    document.body,
  );
}
