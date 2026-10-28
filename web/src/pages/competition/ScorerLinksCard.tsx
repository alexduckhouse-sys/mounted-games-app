import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { QrCode } from '../../components/QrCode';
import { scorerLinkUrl } from '../../offline/scorerLink';
import type { CreatedScorerLink, ScorerLink, ScorerLinkList, ScorerLinkScope } from '../../types';
import { RefineChoiceRow, RefineList, RefineNote, RefineSection } from '../refine/Refine';
import { apiMessage } from '../operations/types';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n/LanguageContext';
import { activeLocale } from '../../i18n/translate';

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
  return iso ? new Date(iso).toLocaleString(activeLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '';
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
  const t = useT();
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
      setProblem(apiMessage(error, t('ops3.plan.scorer.makeError')));
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.show(t('ops3.plan.scorer.copied'));
    } catch {
      setProblem(t('ops3.plan.scorer.copyFailed'));
    }
  }

  async function revoke(link: ScorerLink) {
    if (busy) return;
    if (!(await confirmDialog({ title: t('ops3.plan.scorer.confirmTitle', { name: link.label }), message: t('ops3.plan.scorer.confirmMessage'), confirmLabel: t('ops3.plan.scorer.confirmLabel'), destructive: true }))) return;
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await api.post<ScorerLink>(`/competitions/${competitionId}/scorer-links/${link.id}/revoke`);
      changeLinks((links) => links.map((item) => item.id === data.id ? data : item));
      toast.show(t('ops3.plan.scorer.stopped', { name: link.label }));
    } catch (error) {
      setProblem(apiMessage(error, t('ops3.plan.scorer.withdrawError', { name: link.label })));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="scorer-links" aria-label={t('ops3.plan.scorer.title')} className="scroll-mt-20">
      <RefineSection title={t('ops3.plan.scorer.title')} />
      {state === 'error' && (
        <Notice className="mt-2" actionLabel={t('common.tryAgain')} onAction={() => { setState(null); setRetry((n) => n + 1); }}>{t('ops3.plan.scorer.loadError')}</Notice>
      )}
      {state === null && <p role="status" className="rf-note">{t('ops3.plan.scorer.loading')}</p>}
      {list && (
        <>
          <RefineNote>{t('ops3.plan.scorer.note')}</RefineNote>

          {mayEdit && (list.arenas.length === 0
            ? <p className="rf-note">{t('ops3.plan.scorer.noArena')}</p>
            : (
              <form onSubmit={create} className="ops-form">
                <label className="rf-fld">{t('ops3.plan.scorer.name')}
                  <input type="text" required maxLength={60} autoComplete="off" value={label} onChange={(event) => setLabel(event.target.value)} />
                </label>
                <RefineList as="div">
                  <RefineChoiceRow label={t('ops3.plan.scorer.arena')} value={chosenArena} options={list.arenas.map((name) => ({ value: name, label: name }))} onChange={setArena} />
                  <RefineChoiceRow
                    label={t('ops3.plan.scorer.permissions')}
                    value={String(scope)}
                    options={[
                      { value: '0', label: t('ops3.plan.scorer.scopeScorer') },
                      { value: '2', label: t('ops3.plan.scorer.scopeStream') },
                      { value: '1', label: t('ops3.plan.scorer.scopeTripod') },
                    ]}
                    onChange={(next) => setScope(Number(next) as ScorerLinkScope)}
                  />
                </RefineList>
                <label className="rf-fld">{t('ops3.plan.scorer.expires')}
                  <input
                    type="datetime-local"
                    value={expires}
                    max={localInput(new Date(list.defaultExpiresAt))}
                    onChange={(event) => setExpires(event.target.value)}
                  />
                </label>
                <p className="mg-meta">{t('ops3.plan.scorer.defaults', { date: when(list.defaultExpiresAt) })}</p>
                <div className="kit-acts"><button type="submit" className="kit-pill kit-pill-fill" disabled={busy || !label.trim()}>{t('ops3.plan.scorer.make')}</button></div>
              </form>
            ))}

          {created && (
            <div role="status" className="rf-list mt-2 flex flex-col items-start gap-2 p-3">
              <p className="font-medium">{t('ops3.plan.scorer.ready', { name: created.label })}</p>
              <div className="rf-fld w-full">
                <input readOnly aria-label={t('ops3.plan.scorer.linkFor', { name: created.label })} className="w-full break-all" value={created.url} onFocus={(event) => event.currentTarget.select()} />
              </div>
              <div className="kit-acts"><button type="button" className="kit-pill kit-pill-fill" onClick={() => void copy(created.url)}>{t('ops3.plan.scorer.copy')}</button></div>
              <p className="mg-meta">{t('ops3.plan.scorer.scan')}</p>
              <QrCode value={created.url} label={t('ops3.plan.scorer.qr', { name: created.label })} className="w-48 max-w-full" />
            </div>
          )}

          <div className="mt-2">
            <RefineList label={t('ops3.plan.scorer.title')}>
            {list.links.map((link) => {
              const status = statusOf(link, now);
              return (
                <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {link.label} · {link.arenaName}
                      {link.scope === 1 && <span className="mg-badge mg-badge-outline ml-2">{t('ops3.plan.scorer.tripod')}</span>}
                      {link.scope === 2 && <span className="mg-badge mg-badge-outline ml-2">{t('ops3.plan.scorer.scorerStream')}</span>}
                    </span>
                    <span className="mg-meta block">
                      {status === 'revoked' ? t('ops3.plan.scorer.withdrawnOn', { date: when(link.revokedAt) })
                        : status === 'expired' ? t('ops3.plan.scorer.expiredOn', { date: when(link.expiresAt) })
                          : t('ops3.plan.scorer.worksUntil', { date: when(link.expiresAt) })}
                      {' · '}{link.lastUsedAt ? t('ops3.plan.scorer.lastUsed', { date: when(link.lastUsedAt) }) : t('ops3.plan.scorer.notUsed')}
                    </span>
                    <span className="mg-meta block">{t('ops3.plan.scorer.made', { date: when(link.createdAt) })}</span>
                  </span>
                  {status === 'active' && mayEdit
                    ? <button type="button" className="kit-redtext" disabled={busy} aria-label={t('ops3.plan.scorer.withdrawAria', { name: link.label })} onClick={() => void revoke(link)}>{t('ops3.plan.scorer.withdraw')}</button>
                    : <span className="mg-meta">{status === 'active' ? t('ops3.plan.scorer.active') : status === 'revoked' ? t('ops3.plan.scorer.withdrawn') : t('ops3.plan.scorer.expired')}</span>}
                </li>
              );
            })}
            {list.links.length === 0 && <li className="p-3 mg-meta">{t('ops3.plan.scorer.none')}</li>}
          </RefineList>
          </div>
        </>
      )}
      {problem && <Notice className="mt-2" onDismiss={() => setProblem(null)}>{problem}</Notice>}
      {toast.node}
    </section>
  );
}
