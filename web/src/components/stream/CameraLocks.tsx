import { useT } from '../../i18n/LanguageContext';
import type { CameraLockKind, CameraLocks } from '../../live/streamPublisher';

const LOCKS = [
  { kind: 'exposure', label: 'desk.stream.lock.exposure' },
  { kind: 'focus', label: 'desk.stream.lock.focus' },
  { kind: 'whiteBalance', label: 'desk.stream.lock.whiteBalance' },
] as const satisfies readonly { kind: CameraLockKind; label: string }[];

/**
 * Hold the camera's exposure, focus or white balance still, so clouds and passing ponies don't keep changing the
 * picture. Only the locks the camera reports are shown (most iPhones report none, so nothing shows there).
 */
export function CameraLockButtons({ locks, onChange, disabled = false, className = '', buttonClassName = '' }: {
  locks: CameraLocks | undefined;
  onChange: (kind: CameraLockKind, locked: boolean) => void;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
}) {
  const t = useT();
  const offered = LOCKS.filter(({ kind }) => locks?.[kind] !== undefined);
  if (offered.length === 0) return null;
  return (
    <div role="group" aria-label={t('desk.stream.lock.group')} className={className}>
      {offered.map(({ kind, label }) => (
        <button key={kind} type="button" aria-pressed={locks![kind]} disabled={disabled} className={buttonClassName}
          onClick={() => onChange(kind, !locks![kind])}>
          {t(label)}
        </button>
      ))}
    </div>
  );
}
