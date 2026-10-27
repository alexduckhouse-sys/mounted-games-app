import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { problemMessage } from '../../lib/apiError';
import type { CompetitionSummary } from '../../types';
import { RefineHeader, RefineChoiceRow, RefineList, RefinePage, RefineSection } from '../refine/Refine';
import type { CustomEmailAudienceCount, CustomEmailSummary } from './customEmailTypes';
import {
  AUDIENCES, LINK_TO_OPTIONS, MAX_LINKS, audienceLabel, buildBlocks, defaultFooter, describeTarget, emptyTarget, isHttps, linkedParagraphs, loadDraft, saveDraft,
  targetFields, whyNot, withWords, emptyDraft, type EmailDraft, type LinkTarget, type LinkTo,
} from './emailDraft';
import { EmailPicture } from './EmailPicture';
import { pictureFrom, uploadPicture } from './emailUpload';
import { EmailPreview } from './EmailPreview';
import { EntriesDigestCard } from './EntriesDigestCard';
import '../operations/operations.css';
import './emailPage.css';

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

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
  const options = withNothing ? [{ value: 'nothing' as const, label: 'Nothing' }, ...LINK_TO_OPTIONS] : LINK_TO_OPTIONS;
  const value = target?.to ?? 'nothing';
  const needsEvent = target !== null && target.to !== 'address';
  const bad = target?.to === 'address' && target.address.trim() !== '' && !isHttps(target.address);
  return (
    <>
      <RefineChoiceRow<LinkTo | 'nothing'>
        label="Links to" value={value} options={options}
        onChange={(next) => {
          if (next === 'nothing') { onChange(null); return; }
          onChange({ ...(target ?? emptyTarget(comps[0]?.id ?? null)), to: next });
        }}
      />
      {needsEvent && (
        <RefineChoiceRow
          label="Event" value={target.competitionId === null && comps.length > 0 ? String(comps[0].id) : target.competitionId === null ? '' : String(target.competitionId)} placeholder={comps.length === 0 ? 'No events yet' : 'Choose'}
          options={comps.map((c) => ({ value: String(c.id), label: c.name }))} onChange={(next) => onChange({ ...target, competitionId: Number(next) })}
        />
      )}
      {target?.to === 'address' && (
        <div className="em-addr">
          <label className="rf-fld">Web address
            <input type="url" inputMode="url" placeholder="https://" value={target.address} onChange={(event) => onChange({ ...target, address: event.target.value })} />
          </label>
          {bad && <span className="rf-t2 em-err">Web addresses must start with https://</span>}
        </div>
      )}
    </>
  );
}

/** Write an email to one of the site's lists, as plain text with links or as one picture, and send it a batch at a time. */
export function EmailPage() {
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
      .catch(() => { if (!cancelled) { setCounts([]); setError('Couldn’t count who is on each list. Check your signal and try again.'); } });
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
          else toast.show(`Sent to ${people(data.sent)}`);
          void loadSent();
          return;
        }
        setSending({ id, total: data.total, done: data.total - data.remaining, paused: false });
      }
    } catch (caught) {
      if (!alive.current) return;
      setSending((current) => (current ? { ...current, paused: true } : current));
      setError(problemMessage(caught, 'Sending stopped because the connection dropped. Carry on when you’re back online.'));
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
      setError(sendProblem(caught, 'Couldn’t send the email. Nothing was sent.'));
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
      setError(problemMessage(caught, 'Couldn’t stop the send. Check your signal and try again.'));
    }
  }

  async function retry(id: number) {
    setBusy(true);
    try {
      const { data } = await api.post<CustomEmailSummary>(`/admin/custom-emails/${id}/retry-failed`);
      setBusy(false);
      await drive(id, { id, total: data.total, done: data.total - data.remaining, paused: false });
    } catch (caught) {
      setError(problemMessage(caught, 'Couldn’t try those again. Check your signal and try again.'));
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
      else { setTest('idle'); setError('The test email wasn’t sent. Email may be switched off on this server.'); }
    } catch (caught) {
      setTest('idle');
      setError(sendProblem(caught, 'Couldn’t send the test. Check your signal and try again.'));
    }
  }

  const sendLabel = recipients === null ? 'Send' : `Send to ${people(recipients)}`;
  const editing = (patch: Partial<EmailDraft>) => { setTest('idle'); setDraft(patch); };

  return (
    <RefinePage wide>
      <RefineHeader back="/admin" backLabel="Back to site admin" context="Site admin" title="Email" />
      <div className="ops-cards ops-tt ops-admin em-page" aria-busy={busy}>
        {error && <Notice>{error}</Notice>}
        {note?.kind === 'stopped' && <Notice tone="info">Stopped after {people(note.done)}.</Notice>}
        {note?.kind === 'sent' && (
          <Notice actionLabel="Send those again" onAction={() => void retry(note.id)} actionDisabled={busy}>
            Sent to {people(note.sent)}. {note.failed} didn’t go through.
          </Notice>
        )}
        {toast.node}

        <div className="em-tabs" role="tablist" aria-label="Email">
          {(['write', 'preview'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}>{id === 'write' ? 'Write' : 'Preview'}</button>
          ))}
        </div>

        <div className="em-grid" data-view={view}>
          <div className="em-write">
            <RefineList as="div" label="Who it goes to">
              <RefineChoiceRow<`${number}`>
                label="To" value={`${draft.audience}`}
                options={AUDIENCES.map((a) => ({ value: `${a.audience}` as `${number}`, label: `${a.label} · ${countOf(a.audience) ?? '…'}` }))}
                onChange={(next) => editing({ audience: Number(next) as EmailDraft['audience'] })}
              />
              <RefineChoiceRow<'text' | 'picture'>
                label="Email" value={draft.kind} options={[{ value: 'text', label: 'Text' }, { value: 'picture', label: 'A picture' }]}
                onChange={(next) => editing({ kind: next })}
              />
              <label className="rf-fld em-subj">Subject
                <input value={draft.subject} maxLength={150} placeholder="New: Two-Day Zone Champs" onChange={(event) => editing({ subject: event.target.value })} />
              </label>
            </RefineList>

            {draft.kind === 'text' && (
              <RefineList as="div" label="Email text">
                <div className="em-body">
                  <label className="rf-fld">Message
                    <textarea className="ops-textarea em-msg" value={draft.message} placeholder="Write your email" maxLength={5000} onChange={(event) => editing({ message: event.target.value })} />
                  </label>
                  {draft.links.length > 0 && (
                    <ul className="em-links" aria-label="Links in the message">
                      {draft.links.map((link, i) => (
                        <li key={`${link.words}-${i}`} className="rf-row">
                          <span className="rf-grow">
                            <span className="rf-t1 em-lnk">{link.words}</span>
                            <span className="rf-t2">{missing.includes(link.words) ? 'Not in the message any more' : describeTarget(link, eventName)}</span>
                          </span>
                          <button type="button" className="ops-danger-link" aria-label={`Remove the link on ${link.words}`} onClick={() => editing({ links: draft.links.filter((_, j) => j !== i) })}>Remove</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {adder === null && draft.links.length < MAX_LINKS && <button type="button" className="rf-btn em-addbtn" onClick={openAdder}>Add a link</button>}
                  {adder !== null && (
                    <div className="em-adder">
                      <label className="rf-fld">Words to link
                        <input value={adder.words} maxLength={100} placeholder="enter now" onChange={(event) => setAdder({ ...adder, words: event.target.value })} />
                      </label>
                      <TargetFields target={adder.target} comps={comps} onChange={(next) => next && setAdder({ ...adder, target: next })} />
                      <span className="ops-acts em-adder-acts">
                        <button type="button" className="rf-btn rf-btn-primary" disabled={!adderOk} onClick={addLink}>Add link</button>
                        <button type="button" className="rf-btn" onClick={() => setAdder(null)}>Cancel</button>
                      </span>
                    </div>
                  )}
                </div>
              </RefineList>
            )}

            {draft.kind === 'picture' && (
              <RefineList as="div" label="Email picture options">
                <div className="em-body">
                  <EmailPicture big label="Email picture" title="Drop the picture here, or paste it" picture={draft.picture} onError={setError} onChange={(picture) => editing({ picture })} />
                </div>
                <TargetFields withNothing target={draft.pictureLink} comps={comps} onChange={(next) => editing({ pictureLink: next })} />
              </RefineList>
            )}

            <RefineList as="div" label="Footer">
              <div className="rf-row em-foot-head">
                <span className="rf-grow rf-t1">Footer</span>
                {draft.footerText !== null && <button type="button" className="rf-btn" onClick={() => editing({ footerText: null })}>Use the usual one</button>}
              </div>
              <div className="em-body">
                <EmailPicture label="Footer picture" title="Add a picture to the footer" picture={draft.footerPicture} onError={setError} onChange={(footerPicture) => editing({ footerPicture })} />
                {draft.footerPicture && <button type="button" className="ops-danger-link em-rm" onClick={() => editing({ footerPicture: null })}>Remove the picture</button>}
                <textarea
                  className="em-foottext" aria-label="Footer text" maxLength={1000}
                  value={draft.footerText ?? defaultFooter(draft.audience)}
                  onChange={(event) => editing({ footerText: event.target.value === defaultFooter(draft.audience) ? null : event.target.value })}
                />
                {draft.audience === 0 && <span className="rf-t2">An unsubscribe link is always added for the news list.</span>}
              </div>
            </RefineList>
          </div>

          <div className="em-side">
            <span className="em-side-lbl">Preview</span>
            <EmailPreview draft={draft} to={toText} />
          </div>
        </div>

        {sending === null && (
          <>
            <div className="em-acts">
              <button type="button" className="rf-btn rf-btn-primary" disabled={!canSend} onClick={() => setConfirming(true)}>{sendLabel}</button>
              <button type="button" className="rf-btn" disabled={!canSend || test === 'sending'} onClick={() => void sendTest()}>{test === 'sent' ? 'Test sent to you' : 'Send me a test'}</button>
            </div>
            {reason && (draft.subject.trim() || draft.message.trim() || draft.picture) && <p className="rf-note">{reason}</p>}
          </>
        )}
        {sending !== null && (
          <div role="status" className="em-note">
            <span className="rf-t1">{sending.paused ? `Paused. ${sending.done} of ${sending.total}` : `Sending… ${sending.done} of ${sending.total}`}</span>
            <span className="em-bar" aria-hidden="true"><span style={{ width: `${sending.total > 0 ? Math.round((100 * sending.done) / sending.total) : 0}%` }} /></span>
            <span className="rf-t2">Keep this page open while it sends.</span>
            <span className="ops-acts">
              {sending.paused && <button type="button" className="rf-btn" onClick={() => void drive(sending.id, sending)}>Carry on</button>}
              <button type="button" className="ops-danger-link" onClick={() => void stopSending()}>Stop sending</button>
            </span>
          </div>
        )}

        <EntriesDigestCard />

        <RefineSection title="Sent" />
        <RefineList as="div" label="Sent">
          {sentList === null && <div className="rf-row"><span className="rf-t2" role="status">Loading…</span></div>}
          {sentList?.map((email) => (
            <div key={email.id} className="rf-row">
              <span className="rf-grow">
                <span className="rf-t1">{email.subject}</span>
                <span className="rf-t2">{[
                  shortDate(email.createdAt), audienceLabel(email.audience),
                  email.status === 0 ? `sending, ${email.total - email.remaining} of ${email.total}` : `${email.sent} sent`,
                  email.status === 2 ? 'stopped' : `${email.failed} didn’t go`,
                ].join(' · ')}</span>
              </span>
            </div>
          ))}
          {sentList?.length === 0 && <div className="rf-row"><span className="rf-t2">Nothing sent yet</span></div>}
        </RefineList>
      </div>

      {confirming && (
        <Sheet title="Send this email?" description={`To ${AUDIENCES.find((a) => a.audience === draft.audience)?.list}, ${people(recipients ?? 0)}. You can’t unsend it.`} onClose={() => setConfirming(false)}>
          {({ close }) => (
            <div className="em-confirm">
              <div className="em-confirm-prev"><EmailPreview draft={draft} to={toText} /></div>
              <div className="kit-acts">
                <button type="button" className="kit-pill kit-pill-fill" onClick={() => close(() => void send())}>{sendLabel}</button>
                <button type="button" className="kit-pill" onClick={() => close()}>Not yet</button>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </RefinePage>
  );
}
