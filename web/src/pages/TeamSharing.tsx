import { useEffect, useState } from 'react';
import { CalendarPlus, Copy } from 'lucide-react';
import { api } from '../api';
import { QrCode } from '../components/QrCode';
import { useLanguage } from '../i18n/LanguageContext';
import { tr } from '../i18n/translate';
import { feedLinks, joinTeamLink, type FeedLinks } from '../lib/sharing';
import type { Team } from '../types';
import { confirmDialog } from '../components/ConfirmDialog';
import { Notice } from '../components/Notice';
import { useToast } from '../components/Toast';

/** A QR code for a team's join key, so supporters can scan it instead of typing the key. */
export function JoinQr({ team }: { team: Pick<Team, 'displayName' | 'supporterJoinKey'> }) {
  const { t } = useLanguage();
  if (!team.supporterJoinKey) return null;
  return (
    <div className="flex items-center gap-3">
      <QrCode
        value={joinTeamLink(team.supporterJoinKey, window.location.origin)}
        label={t('account.share.qrLabel', { team: team.displayName })}
        className="w-28 shrink-0 rounded-md border border-[rgb(var(--mg-rule))]"
      />
      <p className="text-[11px] text-[rgb(var(--mg-muted))]">
        {t('account.share.qrHelp', { team: team.displayName })}
      </p>
    </div>
  );
}

interface FeedStatus { enabled: boolean; createdAt: string | null }
interface FeedCreated { token: string; path: string; createdAt: string }

function apiMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { message?: string } | string } }).response?.data;
  return typeof data === 'string' ? data : data?.message ?? fallback;
}

/**
 * A calendar link for one team's heats. Calendar apps can't sign in, so the link itself is the key:
 * it is shown once when made, and making a new one stops the old one working.
 */
export function TeamCalendarFeed({ team }: { team: Pick<Team, 'id' | 'displayName'> }) {
  const { t, locale } = useLanguage();
  const [status, setStatus] = useState<FeedStatus | null>(null);
  const [links, setLinks] = useState<FeedLinks | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<FeedStatus>(`/teams/${team.id}/calendar-feed`)
      .then(({ data }) => { if (!cancelled) setStatus(data); })
      .catch(() => { if (!cancelled) setError(tr('account.share.checkFailed')); });
    return () => { cancelled = true; };
  }, [team.id]);

  async function make() {
    if (status?.enabled && !(await confirmDialog({ title: t('account.share.makeTitle'), message: t('account.share.makeMessage'), confirmLabel: t('account.share.makeConfirm') }))) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<FeedCreated>(`/teams/${team.id}/calendar-feed`);
      setLinks(feedLinks(data.path, window.location.origin));
      setStatus({ enabled: true, createdAt: data.createdAt });
    } catch (caught) {
      setError(apiMessage(caught, t('account.share.makeFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!(await confirmDialog({ title: t('account.share.offTitle'), message: t('account.share.offMessage'), confirmLabel: t('account.share.offConfirm'), destructive: true }))) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/teams/${team.id}/calendar-feed`);
      setLinks(null);
      setStatus({ enabled: false, createdAt: null });
    } catch (caught) {
      setError(apiMessage(caught, t('account.share.offFailed')));
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!links) return;
    navigator.clipboard?.writeText(links.https)
      .then(() => toast.show(t('account.share.copied')))
      .catch(() => setError(t('account.share.copyFailed')));
  }

  return (
    <div className="space-y-1.5" aria-label={t('account.share.groupLabel', { team: team.displayName })} role="group">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--mg-muted))]">
        <CalendarPlus className="h-3.5 w-3.5" /> {t('account.share.title')}
      </div>
      <p className="text-[11px] text-[rgb(var(--mg-muted))]">
        {t('account.share.help', { team: team.displayName })}
      </p>
      {links && (
        <div className="space-y-1.5 rounded-md border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-subtle))] p-2">
          <p className="text-[11px] font-semibold text-[rgb(var(--mg-heading))]">{t('account.share.yourLink')}</p>
          <input className="input w-full !py-1 font-mono text-xs" readOnly value={links.https} aria-label={t('account.share.linkAria')} onFocus={(event) => event.target.select()} />
          <div className="flex flex-wrap gap-1.5">
            <a className="mg-btn mg-btn-primary !min-h-8 !px-2.5 !py-1 text-xs" href={links.webcal}><CalendarPlus className="h-3.5 w-3.5" /> {t('account.share.add')}</a>
            <button type="button" onClick={copy} className="mg-small-btn gap-1.5 !min-h-8 !px-2.5 !py-1 text-xs">
              <Copy className="h-3.5 w-3.5" /> {t('account.share.copy')}
            </button>
          </div>
        </div>
      )}
      {status && !links && status.enabled && (
        <p className="text-[11px]">{status.createdAt
          ? t('account.share.isOnMade', { date: new Date(status.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) })
          : t('account.share.isOn')}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {status && (
          <button type="button" onClick={make} disabled={busy} className={status.enabled ? 'mg-small-btn !min-h-8 !px-2.5 !py-1 text-xs' : 'mg-btn mg-btn-primary !min-h-8 !px-2.5 !py-1 text-xs'}>
            {status.enabled ? t('account.share.makeNew') : t('account.share.create')}
          </button>
        )}
        {status?.enabled && (
          <button type="button" onClick={turnOff} disabled={busy} className="mg-small-btn !min-h-8 !px-2.5 !py-1 text-xs !text-[rgb(var(--mg-elim))]">{t('account.share.turnOff')}</button>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      {toast.node}
    </div>
  );
}
