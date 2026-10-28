import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n/LanguageContext';
import { activeLocale, tr } from '../../i18n/translate';
import { problemMessage } from '../../lib/apiError';
import type { CompetitionSummary } from '../../types';
import { RefineHeader, RefineChoiceRow, RefineList, RefinePage, RefineSection } from '../refine/Refine';
import type { CustomEmailAudienceCount, CustomEmailSummary } from './customEmailTypes';
import {
  AUDIENCES, MAX_LINKS, linkToOptions, audienceLabel, buildBlocks, defaultFooter, describeTarget, emptyTarget, isHttps, linkedParagraphs, loadDraft, saveDraft,
  targetFields, whyNot, withWords, emptyDraft, type EmailDraft, type LinkTarget, type LinkTo,
} from './emailDraft';
import { EmailPicture } from './EmailPicture';
import { pictureFrom, uploadPicture } from './emailUpload';
import { EmailPreview } from './EmailPreview';
import { EntriesDigestCard } from './EntriesDigestCard';
import { people } from './entriesDigestText';
import '../operations/operations.css';
import './emailPage.css';

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(activeLocale(), { day: 'numeric', month: 'short' });

/** Problems the API listed for a 400 (what to fix), else its message. */
function sendProblem(caught: unknown, fallback: string): string {
  const data = (caught as { response?: { data?: { problems?: unknown } } } | null)?.response?.data;
  const problems = Array.isArray(data?.problems) ? data.problems.filter((p): p is string => typeof p === 'string') : [];
  return problems.length > 0 ? problems.join(' ') : problemMessage(caught, fallback);
}

type Sending = { id: number; total: number; done: number; paused: boolean };
type Note = { kind: 'sent'; id: number; sent: number; failed: number } | { kind: 'stopped'; done: number };

/** "Links to", then the event when a site page is chosen, or the web address. Used for linked words and for a picture. */
function TargetFields({ target, onChange, comps, withNothing = false }: {
  target: LinkTarget | null; onChange: (next: LinkTarget | null) => void; comps: CompetitionSummary[]; withNothing?: boolean;
}) {
  const t = useT();
  const options = withNothing ? [{ value: 'nothing' as const, label: t('admin.email.nothing') }, ...linkToOptions()] : linkToOptions();
  const value = target?.to ?? 'nothing';
  const needsEvent = target !== null && target.to !== 'address';
  const bad = target?.to === 'address' && target.address.trim() !== '' && !isHttps(target.address);
  return (
    <>
      <RefineChoiceRow<LinkTo | 'nothing'>
        label={t('admin.email.linksTo')} value={value} options={options}
        onChange={(next) => {
          if (next === 'nothing') { onChange(null); return; }
          onChange({ ...(target ?? emptyTarget(comps[0]?.id ?? null)), to: next });
        }}
      />
      {needsEvent && (
        <RefineChoiceRow
          label={t('admin.email.event')} value={target.competitionId === null && comps.length > 0 ? String(comps[0].id) : target.competitionId === null ? '' : String(target.competitionId)} placeholder={comps.length === 0 ? t('admin.email.noEvents') : t('admin.email.choose')}
          options={comps.map((c) => ({ value: String(c.id), label: c.name }))} onChange={(next) => onChange({ ...target, competitionId: Number(next) })}
        />
      )}
      {target?.to === 'address' && (
        <div className="em-addr">
          <label className="rf-fld">{t('admin.email.webAddress')}
            <input type="url" inputMode="url" placeholder="https://" value={target.address} onChange={(event) => onChange({ ...target, address: event.target.value })} />
          </label>
          {bad && <span className="rf-t2 em-err">{t('admin.email.httpsOnly')}</span>}
        </div>
      )}
    </>
  );
}

/** Write an email to one of the site's lists, as plain text with links or as one picture, and send it a batch at a time. */
export function EmailPage() {
  const t = useT();
  const [draft, setDraftState] = useState<EmailDraft>(loadDraft);
  const [counts, setCounts] = useState<CustomEmailAudienceCount[] | null>(null);
  const [comps, setComps] = useState<CompetitionSummary[]>([]);
  const [sentList, setSentList] = useState<CustomEmailSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [adder, setAdder] = useState<{ words: string; target: LinkTarget } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState<Sending | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [test, setTest] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const stop = useRef(false);
  const alive = useRef(true);

  const setDraft = useCallback((patch: Partial<EmailDraft>) => setDraftState((current) => ({ ...current, ...patch })), []);
  // Every change is kept as it is made, so closing the page loses nothing.
  useEffect(() => { saveDraft(draft); }, [draft]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const loadSent = useCallback(() => api.get<CustomEmailSummary[]>('/admin/custom-emails')
    .then(({ data }) => { if (alive.current) setSentList(Array.isArray(data) ? data : []); })
    .catch(() => { if (alive.current) setSentList((current) => current ?? []); }), []);

  useEffect(() => {
    let cancelled = false;
    api.get<CustomEmailAudienceCount[]>('/admin/custom-emails/audiences')
      .then(({ data }) => { if (!cancelled) setCounts(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) { setCounts([]); setError(tr('admin.email.err.counts')); } });
    api.get<CompetitionSummary[]>('/competitions')
      .then(({ data }) => { if (!cancelled) setComps(Array.isArray(data) ? data : []); }).catch(() => undefined);
    api.get<CustomEmailSummary[]>('/admin/custom-emails')
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setSentList(list);
        // A send that was left part-way (the page was closed) waits here to be carried on or stopped.
        const open = list.find((e) => e.status === 0 && e.remaining > 0);
        if (open) setSending({ id: open.id, total: open.total, done: open.total - open.remaining, paused: true });
      }).catch(() => { if (!cancelled) setSentList([]); });
    return () => { cancelled = true; };
  }, []);

  const countOf = (audience: number) => counts?.find((c) => c.audience === audience)?.recipients ?? null;
  const recipients = countOf(draft.audience);
  const eventName = useCallback((id: number) => comps.find((c) => c.id === id)?.name, [comps]);
  // A picture link set up before the events arrived takes the first event, as its row shows.
  const ready = useMemo<EmailDraft>(() => (draft.pictureLink && draft.pictureLink.competitionId === null && comps.length > 0
    ? { ...draft, pictureLink: { ...draft.pictureLink, competitionId: comps[0].id } } : draft), [draft, comps]);
  const blocks = useMemo(() => buildBlocks(ready), [ready]);
  const reason = whyNot(ready, recipients);
  const canSend = reason === null && blocks !== null && !busy && sending === null;
  const toText = `${audienceLabel(draft.audience)} (${recipients ?? '…'})`;
  const { missing } = useMemo(() => linkedParagraphs(draft.message, draft.links), [draft.message, draft.links]);

  // A picture pasted anywhere on the page becomes the email's picture, when the email is a picture.
  useEffect(() => {
    if (draft.kind !== 'picture') return undefined;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || target?.closest('input, textarea')) return;
      const file = pictureFrom(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      setError(null);
      uploadPicture(file).then((picture) => setDraft({ picture }), (caught: Error) => setError(caught.message));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [draft.kind, setDraft]);

  // ---- links ----

  const openAdder = () => setAdder({ words: '', target: emptyTarget(comps[0]?.id ?? null) });
  const adderOk = adder !== null && adder.words.trim() !== '' && targetFields({ ...adder.target, competitionId: adder.target.competitionId ?? comps[0]?.id ?? null }) !== null && draft.links.length < MAX_LINKS;
  function addLink() {
    if (!adder || !adderOk) return;
    const words = adder.words.trim();
    setDraft({ message: withWords(draft.message, words), links: [...draft.links, { ...adder.target, competitionId: adder.target.competitionId ?? comps[0]?.id ?? null, words }] });
    setAdder(null);
  }

  // ---- sending ----

  async function drive(id: number, from: Sending) {
    stop.current = false;
    setSending({ ...from, paused: false });
    setNote(null);
    setError(null);
    try {
      for (;;) {
        const { data } = await api.post<CustomEmailSummary>(`/admin/custom-emails/${id}/send-batch`);
        if (!alive.current || stop.current) return;
        if (data.remaining === 0 || data.status !== 0) {
          setSending(null);
          if (data.status === 2) setNote({ kind: 'stopped', done: data.sent + data.failed + data.skipped });
          else if (data.failed > 0) setNote({ kind: 'sent', id, sent: data.sent, failed: data.failed });
          else toast.show(tr('admin.email.sentToast', { people: people(data.sent) }));
          void loadSent();
          return;
        }
        setSending({ id, total: data.total, done: data.total - data.remaining, paused: false });
      }
    } catch (caught) {
      if (!alive.current) return;
      setSending((current) => (current ? { ...current, paused: true } : current));
      setError(problemMessage(caught, tr('admin.email.err.dropped')));
    }
  }

  async function send() {
    if (!canSend || blocks === null || recipients === null) return;
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<CustomEmailSummary>('/admin/custom-emails', {
        subject: draft.subject.trim(), audience: draft.audience, blocks, confirm: true, expectedRecipients: recipients,
      });
      setDraftState((current) => ({ ...emptyDraft(current.audience) }));
      setAdder(null);
      setView('write');
      setBusy(false);
      void api.get<CustomEmailAudienceCount[]>('/admin/custom-emails/audiences').then(({ data: next }) => { if (alive.current && Array.isArray(next)) setCounts(next); }).catch(() => undefined);
      await drive(data.id, { id: data.id, total: data.total, done: 0, paused: false });
    } catch (caught) {
      setError(sendProblem(caught, tr('admin.email.err.send')));
    } finally {
      setBusy(false);
    }
  }

  async function stopSending() {
    if (!sending) return;
    stop.current = true;
    try {
      const { data } = await api.post<CustomEmailSummary>(`/admin/custom-emails/${sending.id}/cancel`);
      setNote({ kind: 'stopped', done: data.sent + data.failed + data.skipped });
      setSending(null);
      void loadSent();
    } catch (caught) {
      stop.current = false;
      setError(problemMessage(caught, tr('admin.email.err.stop')));
    }
  }

  async function retry(id: number) {
    setBusy(true);
    try {
      const { data } = await api.post<CustomEmailSummary>(`/admin/custom-emails/${id}/retry-failed`);
      setBusy(false);
      await drive(id, { id, total: data.total, done: data.total - data.remaining, paused: false });
    } catch (caught) {
      setError(problemMessage(caught, tr('admin.email.err.retry')));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!canSend || blocks === null) return;
    setTest('sending');
    setError(null);
    try {
      const { data } = await api.post<{ status: number }>('/admin/custom-emails/test', { subject: draft.subject.trim(), audience: draft.audience, blocks });
      if (data.status === 1) setTest('sent');
      else { setTest('idle'); setError(tr('admin.email.err.testOff')); }
    } catch (caught) {
      setTest('idle');
      setError(sendProblem(caught, tr('admin.email.err.test')));
    }
  }

  const sendLabel = recipients === null ? t('admin.email.send') : t('admin.email.sendTo', { people: people(recipients) });
  const editing = (patch: Partial<EmailDraft>) => { setTest('idle'); setDraft(patch); };

  return (
    <RefinePage wide>
      <RefineHeader back="/admin" backLabel={t('admin.email.backLabel')} context={t('admin.email.context')} title={t('admin.email.title')} />
      <div className="ops-cards ops-tt ops-admin em-page" aria-busy={busy}>
        {error && <Notice>{error}</Notice>}
        {note?.kind === 'stopped' && <Notice tone="info">{t('admin.email.stopped', { people: people(note.done) })}</Notice>}
        {note?.kind === 'sent' && (
          <Notice actionLabel={t('admin.email.sendAgain')} onAction={() => void retry(note.id)} actionDisabled={busy}>
            {t('admin.email.sentSome', { people: people(note.sent), failed: note.failed })}
          </Notice>
        )}
        {toast.node}

        <div className="em-tabs" role="tablist" aria-label={t('admin.email.title')}>
          {(['write', 'preview'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}>{id === 'write' ? t('admin.email.tab.write') : t('admin.email.tab.preview')}</button>
          ))}
        </div>

        <div className="em-grid" data-view={view}>
          <div className="em-write">
            <RefineList as="div" label={t('admin.email.who')}>
              <RefineChoiceRow<`${number}`>
                label={t('admin.email.to')} value={`${draft.audience}`}
                options={AUDIENCES.map((a) => ({ value: `${a.audience}` as `${number}`, label: `${t(a.label)} · ${countOf(a.audience) ?? '…'}` }))}
                onChange={(next) => editing({ audience: Number(next) as EmailDraft['audience'] })}
              />
              <RefineChoiceRow<'text' | 'picture'>
                label={t('admin.email.title')} value={draft.kind} options={[{ value: 'text', label: t('admin.email.kind.text') }, { value: 'picture', label: t('admin.email.kind.picture') }]}
                onChange={(next) => editing({ kind: next })}
              />
              <label className="rf-fld em-subj">{t('admin.email.subject')}
                <input value={draft.subject} maxLength={150} placeholder="New: Two-Day Zone Champs" onChange={(event) => editing({ subject: event.target.value })} />
              </label>
            </RefineList>

            {draft.kind === 'text' && (
              <RefineList as="div" label={t('admin.email.textLabel')}>
                <div className="em-body">
                  <label className="rf-fld">{t('admin.email.message')}
                    <textarea className="ops-textarea em-msg" value={draft.message} placeholder={t('admin.email.messagePlaceholder')} maxLength={5000} onChange={(event) => editing({ message: event.target.value })} />
                  </label>
                  {draft.links.length > 0 && (
                    <ul className="em-links" aria-label={t('admin.email.linksAria')}>
                      {draft.links.map((link, i) => (
                        <li key={`${link.words}-${i}`} className="rf-row">
                          <span className="rf-grow">
                            <span className="rf-t1 em-lnk">{link.words}</span>
                            <span className="rf-t2">{missing.includes(link.words) ? t('admin.email.notInMessage') : describeTarget(link, eventName)}</span>
                          </span>
                          <button type="button" className="ops-danger-link" aria-label={t('admin.email.removeLinkAria', { words: link.words })} onClick={() => editing({ links: draft.links.filter((_, j) => j !== i) })}>{t('admin.email.remove')}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {adder === null && draft.links.length < MAX_LINKS && <button type="button" className="rf-btn em-addbtn" onClick={openAdder}>{t('admin.email.addLinkOpen')}</button>}
                  {adder !== null && (
                    <div className="em-adder">
                      <label className="rf-fld">{t('admin.email.wordsToLink')}
                        <input value={adder.words} maxLength={100} placeholder="enter now" onChange={(event) => setAdder({ ...adder, words: event.target.value })} />
                      </label>
                      <TargetFields target={adder.target} comps={comps} onChange={(next) => next && setAdder({ ...adder, target: next })} />
                      <span className="ops-acts em-adder-acts">
                        <button type="button" className="rf-btn rf-btn-primary" disabled={!adderOk} onClick={addLink}>{t('admin.email.addLink')}</button>
                        <button type="button" className="rf-btn" onClick={() => setAdder(null)}>{t('common.cancel')}</button>
                      </span>
                    </div>
                  )}
                </div>
              </RefineList>
            )}

            {draft.kind === 'picture' && (
              <RefineList as="div" label={t('admin.email.pictureOptions')}>
                <div className="em-body">
                  <EmailPicture big label={t('admin.email.pictureLabel')} title={t('admin.email.pictureTitle')} picture={draft.picture} onError={setError} onChange={(picture) => editing({ picture })} />
                </div>
                <TargetFields withNothing target={draft.pictureLink} comps={comps} onChange={(next) => editing({ pictureLink: next })} />
              </RefineList>
            )}

            <RefineList as="div" label={t('admin.email.footer')}>
              <div className="rf-row em-foot-head">
                <span className="rf-grow rf-t1">{t('admin.email.footer')}</span>
                {draft.footerText !== null && <button type="button" className="rf-btn" onClick={() => editing({ footerText: null })}>{t('admin.email.footerUsual')}</button>}
              </div>
              <div className="em-body">
                <EmailPicture label={t('admin.email.footerPictureLabel')} title={t('admin.email.footerPictureTitle')} picture={draft.footerPicture} onError={setError} onChange={(footerPicture) => editing({ footerPicture })} />
                {draft.footerPicture && <button type="button" className="ops-danger-link em-rm" onClick={() => editing({ footerPicture: null })}>{t('admin.email.removePicture')}</button>}
                <textarea
                  className="em-foottext" aria-label={t('admin.email.footerTextAria')} maxLength={1000}
                  value={draft.footerText ?? defaultFooter(draft.audience)}
                  onChange={(event) => editing({ footerText: event.target.value === defaultFooter(draft.audience) ? null : event.target.value })}
                />
                {draft.audience === 0 && <span className="rf-t2">{t('admin.email.unsubNote')}</span>}
              </div>
            </RefineList>
          </div>

          <div className="em-side">
            <span className="em-side-lbl">{t('admin.email.sidePreview')}</span>
            <EmailPreview draft={draft} to={toText} />
          </div>
        </div>

        {sending === null && (
          <>
            <div className="em-acts">
              <button type="button" className="rf-btn rf-btn-primary" disabled={!canSend} onClick={() => setConfirming(true)}>{sendLabel}</button>
              <button type="button" className="rf-btn" disabled={!canSend || test === 'sending'} onClick={() => void sendTest()}>{test === 'sent' ? t('admin.email.testSent') : t('admin.email.testSend')}</button>
            </div>
            {reason && (draft.subject.trim() || draft.message.trim() || draft.picture) && <p className="rf-note">{reason}</p>}
          </>
        )}
        {sending !== null && (
          <div role="status" className="em-note">
            <span className="rf-t1">{t(sending.paused ? 'admin.email.paused' : 'admin.email.sending', { done: sending.done, total: sending.total })}</span>
            <span className="em-bar" aria-hidden="true"><span style={{ width: `${sending.total > 0 ? Math.round((100 * sending.done) / sending.total) : 0}%` }} /></span>
            <span className="rf-t2">{t('admin.email.keepOpen')}</span>
            <span className="ops-acts">
              {sending.paused && <button type="button" className="rf-btn" onClick={() => void drive(sending.id, sending)}>{t('admin.email.carryOn')}</button>}
              <button type="button" className="ops-danger-link" onClick={() => void stopSending()}>{t('admin.email.stopSending')}</button>
            </span>
          </div>
        )}

        <EntriesDigestCard />

        <RefineSection title={t('admin.email.sent')} />
        <RefineList as="div" label={t('admin.email.sent')}>
          {sentList === null && <div className="rf-row"><span className="rf-t2" role="status">{t('common.loading')}</span></div>}
          {sentList?.map((email) => (
            <div key={email.id} className="rf-row">
              <span className="rf-grow">
                <span className="rf-t1">{email.subject}</span>
                <span className="rf-t2">{[
                  shortDate(email.createdAt), audienceLabel(email.audience),
                  email.status === 0 ? t('admin.email.sentList.sending', { done: email.total - email.remaining, total: email.total }) : t('admin.email.sentList.sent', { sent: email.sent }),
                  email.status === 2 ? t('admin.email.sentList.stopped') : t('admin.email.sentList.failed', { failed: email.failed }),
                ].join(' · ')}</span>
              </span>
            </div>
          ))}
          {sentList?.length === 0 && <div className="rf-row"><span className="rf-t2">{t('admin.email.sentList.none')}</span></div>}
        </RefineList>
      </div>

      {confirming && (
        <Sheet title={t('admin.email.sheet.title')} description={t(AUDIENCES.find((a) => a.audience === draft.audience)?.sheet ?? 'admin.email.sheet.descNews', { people: people(recipients ?? 0) })} onClose={() => setConfirming(false)}>
          {({ close }) => (
            <div className="em-confirm">
              <div className="em-confirm-prev"><EmailPreview draft={draft} to={toText} /></div>
              <div className="kit-acts">
                <button type="button" className="kit-pill kit-pill-fill" onClick={() => close(() => void send())}>{sendLabel}</button>
                <button type="button" className="kit-redtext" onClick={() => close()}>{t('common.cancel')}</button>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </RefinePage>
  );
}
