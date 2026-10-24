import { useEffect, useState } from 'react';
import { CalendarPlus, Check, Copy } from 'lucide-react';
import { api } from '../api';
import { QrCode } from '../components/QrCode';
import { feedLinks, joinTeamLink, type FeedLinks } from '../lib/sharing';
import type { Team } from '../types';
import { confirmDialog } from '../components/ConfirmDialog';

/** A QR code for a team's join key, so supporters can scan it instead of typing the key. */
export function JoinQr({ team }: { team: Pick<Team, 'displayName' | 'supporterJoinKey'> }) {
  if (!team.supporterJoinKey) return null;
  return (
    <div className="flex items-center gap-3">
      <QrCode
        value={joinTeamLink(team.supporterJoinKey, window.location.origin)}
        label={`QR code to join ${team.displayName}`}
        className="w-28 shrink-0 rounded-md border border-[rgb(var(--mg-rule))]"
      />
      <p className="text-[11px] text-[rgb(var(--mg-muted))]">
        Supporters and parents can scan this to join {team.displayName}. They’ll need to sign in first, and you still approve them.
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
  const [status, setStatus] = useState<FeedStatus | null>(null);
  const [links, setLinks] = useState<FeedLinks | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<FeedStatus>(`/teams/${team.id}/calendar-feed`)
      .then(({ data }) => { if (!cancelled) setStatus(data); })
      .catch(() => { if (!cancelled) setError('Couldn’t check the calendar link. Try again in a moment.'); });
    return () => { cancelled = true; };
  }, [team.id]);

  async function make() {
    if (status?.enabled && !(await confirmDialog({ title: 'Make a new link?', message: 'Make a new link? The old one will stop working, so anyone using it will need the new one.', confirmLabel: 'Make new link', destructive: true }))) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<FeedCreated>(`/teams/${team.id}/calendar-feed`);
      setLinks(feedLinks(data.path, window.location.origin));
      setStatus({ enabled: true, createdAt: data.createdAt });
      setCopied(false);
    } catch (caught) {
      setError(apiMessage(caught, 'Couldn’t make the link. Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!(await confirmDialog({ title: 'Turn the link off?', message: 'Turn the calendar link off? It will stop working for everyone using it.', confirmLabel: 'Turn link off', destructive: true }))) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/teams/${team.id}/calendar-feed`);
      setLinks(null);
      setStatus({ enabled: false, createdAt: null });
    } catch (caught) {
      setError(apiMessage(caught, 'Couldn’t turn the link off. Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!links) return;
    navigator.clipboard?.writeText(links.https)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  }

  return (
    <div className="space-y-1.5" aria-label={`Calendar link for ${team.displayName}`} role="group">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--mg-muted))]">
        <CalendarPlus className="h-3.5 w-3.5" /> Team calendar
      </div>
      <p className="text-[11px] text-[rgb(var(--mg-muted))]">
        Add {team.displayName}’s heats to a phone calendar. The times change by themselves if the timetable moves.
        Anyone with the link can see the heat times, so share it only with people you trust.
      </p>
      {links && (
        <div className="space-y-1.5 rounded-md border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-subtle))] p-2">
          <p className="text-[11px] font-semibold text-[rgb(var(--mg-heading))]">Here’s your link. Copy it now, because it won’t be shown again.</p>
          <input className="input w-full !py-1 font-mono text-xs" readOnly value={links.https} aria-label="Calendar link" onFocus={(event) => event.target.select()} />
          <div className="flex flex-wrap gap-1.5">
            <a className="mg-btn mg-btn-primary !min-h-8 !px-2.5 !py-1 text-xs" href={links.webcal}><CalendarPlus className="h-3.5 w-3.5" /> Add to calendar</a>
            <button type="button" onClick={copy} className="mg-small-btn gap-1.5 !min-h-8 !px-2.5 !py-1 text-xs">
              {copied ? <Check className="h-3.5 w-3.5 text-[rgb(var(--mg-ok))]" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      )}
      {status && !links && status.enabled && (
        <p className="text-[11px]">A calendar link is on{status.createdAt ? `, made ${new Date(status.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}. We can’t show it again; make a new one if you’ve lost it.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {status && (
          <button type="button" onClick={make} disabled={busy} className={status.enabled ? 'mg-small-btn !min-h-8 !px-2.5 !py-1 text-xs' : 'mg-btn mg-btn-primary !min-h-8 !px-2.5 !py-1 text-xs'}>
            {status.enabled ? 'Make a new link' : 'Create calendar link'}
          </button>
        )}
        {status?.enabled && (
          <button type="button" onClick={turnOff} disabled={busy} className="mg-small-btn !min-h-8 !px-2.5 !py-1 text-xs !text-[rgb(var(--mg-elim))]">Turn off</button>
        )}
      </div>
      {error && <p role="alert" className="text-[11px] text-[rgb(var(--mg-elim))]">{error}</p>}
    </div>
  );
}
