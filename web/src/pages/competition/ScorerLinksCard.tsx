import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { QrCode } from '../../components/QrCode';
import { scorerLinkUrl } from '../../offline/scorerLink';
import type { CreatedScorerLink, ScorerLink, ScorerLinkList, ScorerLinkScope } from '../../types';
import { RefineList, RefineNote, RefineSection } from '../refine/Refine';
import { apiMessage } from '../operations/types';
import { SelectField } from '../../components/SelectField';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';

/** Keeps a wrong or partial response from reaching the screen. */
function parseList(data: unknown): ScorerLinkList | null {
  const list = data as Partial<ScorerLinkList> | null;
  if (!list || !Array.isArray(list.arenas) || !Array.isArray(list.links) || typeof list.defaultExpiresAt !== 'string') return null;
  return {
    arenas: list.arenas.filter((a): a is string => typeof a === 'string'),
    defaultExpiresAt: list.defaultExpiresAt,
    links: list.links.filter((l) => !!l && typeof l.id === 'number'),
  };
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function statusOf(link: ScorerLink, now: number): 'active' | 'revoked' | 'expired' {
  if (link.revokedAt) return 'revoked';
  return new Date(link.expiresAt).getTime() <= now ? 'expired' : 'active';
}

/** `datetime-local` wants the device's local time, without a zone. */
function localInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

type State = { competitionId: number; list: ScorerLinkList } | 'error' | null;

/**
 * Scorer links: a volunteer scores the competition from a link, with no account. The organiser makes a link per
 * scorer, copies it once (the token is never shown again), and can withdraw it at any time. The API decides who
 * may do this; the card only hides what won't work.
 */
export function ScorerLinksCard({ competitionId, canWrite = true }: { competitionId: number; canWrite?: boolean }) {
  const [state, setState] = useState<State>(null);
  const [retry, setRetry] = useState(0);
  const [label, setLabel] = useState('');
  const [arena, setArena] = useState('');
  const [scope, setScope] = useState<ScorerLinkScope>(0);
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();
  const [created, setCreated] = useState<{ label: string; url: string } | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    api.get<unknown>(`/competitions/${competitionId}/scorer-links`)
      .then(({ data }) => {
        const list = parseList(data);
        if (!cancelled) setState(list ? { competitionId, list } : 'error');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [competitionId, retry]);

  const list = state && state !== 'error' && state.competitionId === competitionId ? state.list : null;
  const chosenArena = list ? (list.arenas.includes(arena) ? arena : list.arenas[0] ?? '') : '';
  const mayEdit = !!list && canWrite;

  function changeLinks(change: (links: ScorerLink[]) => ScorerLink[]) {
    setState((current) => current && current !== 'error'
      ? { ...current, list: { ...current.list, links: change(current.list.links) } }
      : current);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!list || busy || !label.trim() || !chosenArena) return;
    setBusy(true);
    setProblem(null);
    setCreated(null);
    try {
      const { data } = await api.post<CreatedScorerLink>(`/competitions/${competitionId}/scorer-links`, {
        label: label.trim(),
        arenaName: chosenArena,
        ...(scope ? { scope } : {}),
        ...(expires ? { expiresAt: new Date(expires).toISOString() } : {}),
      });
      changeLinks((links) => [data.link, ...links]);
      setCreated({ label: data.link.label, url: scorerLinkUrl(window.location.origin, data.token) });
      setLabel('');
      setExpires('');
    } catch (error) {
      setProblem(apiMessage(error, 'Couldn’t make that link. Check your signal and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.show('Link copied');
    } catch {
      setProblem('Couldn’t copy the link. Press and hold it to copy, or show the QR code.');
    }
  }

  async function revoke(link: ScorerLink) {
    if (busy) return;
    if (!(await confirmDialog({ title: `Withdraw ${link.label}’s scorer link?`, message: 'It stops working straight away.', confirmLabel: 'Withdraw link', destructive: true }))) return;
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await api.post<ScorerLink>(`/competitions/${competitionId}/scorer-links/${link.id}/revoke`);
      changeLinks((links) => links.map((item) => item.id === data.id ? data : item));
      toast.show(`${link.label}’s link no longer works`);
    } catch (error) {
      setProblem(apiMessage(error, `Couldn’t withdraw ${link.label}’s link. Check your signal and try again.`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="scorer-links" aria-label="Scorer links" className="scroll-mt-20">
      <RefineSection title="Scorer links" />
      {state === 'error' && (
        <Notice className="mt-2" actionLabel="Try again" onAction={() => { setState(null); setRetry((n) => n + 1); }}>Couldn’t load the scorer links. Check your signal and try again.</Notice>
      )}
      {state === null && <p role="status" className="rf-note">Loading scorer links…</p>}
      {list && (
        <>
          <RefineNote>
            Phone scoring links — no account needed.
          </RefineNote>

          {mayEdit && (list.arenas.length === 0
            ? <p className="rf-note">Name an arena on a session in the timetable first. Each link covers the whole competition.</p>
            : (
              <form onSubmit={create} className="rf-list flex flex-col gap-2 p-3">
                <label className="rf-fld">Scorer’s name
                  <input type="text" required maxLength={60} autoComplete="off" value={label} onChange={(event) => setLabel(event.target.value)} />
                </label>
                <label className="rf-fld">Arena
                  <SelectField value={chosenArena} onChange={(event) => setArena(event.target.value)}>
                    {list.arenas.map((name) => <option key={name} value={name}>{name}</option>)}
                  </SelectField>
                </label>
                <label className="rf-fld">Link permissions
                  <SelectField value={String(scope)} onChange={(event) => setScope(Number(event.target.value) as ScorerLinkScope)}>
                    <option value="0">Scorer (enter race results)</option>
                    <option value="2">Scorer + stream controller (score + remote camera &amp; replays)</option>
                    <option value="1">Tripod camera (broadcast arena video only)</option>
                  </SelectField>
                </label>
                <label className="rf-fld">Stops working at (optional)
                  <input
                    type="datetime-local"
                    value={expires}
                    max={localInput(new Date(list.defaultExpiresAt))}
                    onChange={(event) => setExpires(event.target.value)}
                  />
                </label>
                <p className="mg-meta">Defaults to {when(list.defaultExpiresAt)}.</p>
                <div><button type="submit" className="mg-btn mg-btn-primary" disabled={busy || !label.trim()}>Make scorer link</button></div>
              </form>
            ))}

          {created && (
            <div role="status" className="rf-list mt-2 flex flex-col items-start gap-2 p-3">
              <p className="font-medium">{created.label}’s link is ready. Copy it now: it can’t be shown again.</p>
              <div className="rf-fld w-full">
                <input readOnly aria-label={`Link for ${created.label}`} className="w-full break-all" value={created.url} onFocus={(event) => event.currentTarget.select()} />
              </div>
              <button type="button" className="mg-btn mg-btn-primary" onClick={() => void copy(created.url)}>Copy link</button>
              <p className="mg-meta">Or let them scan this with their phone’s camera.</p>
              <QrCode value={created.url} label={`QR code for ${created.label}’s scorer link`} className="w-48 max-w-full" />
            </div>
          )}

          <div className="mt-2">
            <RefineList label="Scorer links">
            {list.links.map((link) => {
              const status = statusOf(link, now);
              return (
                <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {link.label} · {link.arenaName}
                      {link.scope === 1 && <span className="mg-badge mg-badge-outline ml-2">Tripod camera</span>}
                      {link.scope === 2 && <span className="mg-badge mg-badge-outline ml-2">Scorer + stream</span>}
                    </span>
                    <span className="mg-meta block">
                      {status === 'revoked' ? `Withdrawn ${when(link.revokedAt)}`
                        : status === 'expired' ? `Expired ${when(link.expiresAt)}`
                          : `Works until ${when(link.expiresAt)}`}
                      {' · '}{link.lastUsedAt ? `last used ${when(link.lastUsedAt)}` : 'not used yet'}
                    </span>
                    <span className="mg-meta block">Made {when(link.createdAt)}</span>
                  </span>
                  {status === 'active' && mayEdit
                    ? <button type="button" className="mg-btn mg-btn-secondary" disabled={busy} aria-label={`Withdraw ${link.label}’s link`} onClick={() => void revoke(link)}>Withdraw</button>
                    : <span className="mg-meta">{status === 'active' ? 'Active' : status === 'revoked' ? 'Withdrawn' : 'Expired'}</span>}
                </li>
              );
            })}
            {list.links.length === 0 && <li className="p-3 mg-meta">No scorer links yet.</li>}
          </RefineList>
          </div>
        </>
      )}
      {problem && <Notice className="mt-2" onDismiss={() => setProblem(null)}>{problem}</Notice>}
      {toast.node}
    </section>
  );
}
