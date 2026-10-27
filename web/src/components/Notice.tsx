import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

export interface NoticeProps {
  /** `info` for something worth knowing (blue-grey); `problem` for something that went wrong or needs care (amber). */
  tone?: 'info' | 'problem';
  /** Defaults to an "i" for information and a warning triangle for problems. Pass another icon when it says more (a clock, a wifi-off). */
  icon?: LucideIcon;
  /** One small outlined button: "Try again", "Refresh". Give it `onAction`, or `actionTo` for a link. */
  actionLabel?: string;
  onAction?: () => void;
  actionTo?: string;
  actionDisabled?: boolean;
  /** Adds a small cross for strips the person can put away. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Defaults to `alert` for problems and `status` for information. Pass `null` for a strip that shouldn't be announced. */
  role?: 'alert' | 'status' | null;
  /** Anything that belongs under the message and its action: a field, a second choice. */
  extra?: ReactNode;
  className?: string;
  id?: string;
  children: ReactNode;
}

/**
 * The information strip and the problem strip: a rounded 12px strip with a small icon. Information is blue-grey
 * (saved copies, loading, closed entries, deadlines); a problem is amber and should say what to do next, with
 * "Try again" where a retry exists. Any action is a small outlined pill in the strip's own colour.
 */
export function Notice({ tone = 'problem', icon, actionLabel, onAction, actionTo, actionDisabled, onDismiss, dismissLabel, role, extra, className = '', id, children }: NoticeProps) {
  const t = useT();
  const Icon = icon ?? (tone === 'info' ? Info : TriangleAlert);
  const live = role === undefined ? (tone === 'info' ? 'status' : 'alert') : role ?? undefined;
  return (
    <div id={id} role={live} className={`kit-strip kit-strip-${tone} ${className}`.trim()}>
      <Icon aria-hidden="true" />
      <div className="kit-strip-body">
        <span>{children}</span>
        {actionLabel && actionTo && <Link to={actionTo} className="kit-strip-act">{actionLabel}</Link>}
        {actionLabel && !actionTo && <button type="button" className="kit-strip-act" onClick={onAction} disabled={actionDisabled}>{actionLabel}</button>}
        {extra}
      </div>
      {onDismiss && <button type="button" className="kit-strip-x" aria-label={dismissLabel ?? t('shell.notice.dismiss')} onClick={onDismiss}><X aria-hidden="true" /></button>}
    </div>
  );
}
