import { useT } from '../../../i18n/LanguageContext';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import type { DeclarationForm } from '../../../types';
import { Sheet } from '../../../components/Sheet';
import { Notice } from '../../../components/Notice';

interface SubstitutionRequest {
  id: number; declarationFormId: number; teamId: number; teamName: string;
  outRiderEntryId: number; inRiderEntryId: number; outRiderName: string; inRiderName: string | null;
  replacementRiderName: string | null; replacementHorseName: string | null; reason: string;
  status: 'pending' | 'approved' | 'declined'; requestedAt: string; decidedAt: string | null;
}
function message(error: unknown, fallback: string) {
  const text = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof text === 'string' ? text : fallback;
}
export function SubstitutionRequests({ competitionId, canDecide = false, onChanged, compact = false }: { competitionId: number; canDecide?: boolean; onChanged?: () => void; compact?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { user, token } = useAuth();
  const userId = user?.id;
  const roles = user?.roles.join(',') ?? '';
  // The opaque identity changes with the event, account, permissions or sign-in session.
  // It contains no token or private request data and never leaves this component.
  const scope = useMemo(() => ({ competitionId, roles, canDecide, signedIn: Boolean(token && userId) }),
    [competitionId, userId, roles, token, canDecide]);
  const [snapshot, setSnapshot] = useState<{ scope: object; requests: SubstitutionRequest[] }>({ scope, requests: [] });
  const [problem, setProblem] = useState<{ scope: object; text: string }>({ scope, text: '' });
  const [decision, setDecision] = useState<{ scope: object; id: number } | null>(null);
  const generation = useRef(0);
  const lifecycle = useRef(0);
  const invalidate = useCallback(() => { generation.current++; lifecycle.current++; }, []);
  const requests = snapshot.scope === scope && scope.signedIn ? snapshot.requests : [];
  const error = problem.scope === scope && scope.signedIn ? problem.text : '';
  const busy = decision?.scope === scope ? decision.id : null;
  const reload = useCallback(async () => {
    if (!scope.signedIn) return;
    const sequence = ++generation.current;
    try {
      const result = await api.get<SubstitutionRequest[]>(`/competitions/${competitionId}/substitution-requests`);
      if (sequence !== generation.current) return;
      if (!Array.isArray(result.data)) throw new Error('Invalid substitution requests');
      setSnapshot({ scope, requests: result.data }); setProblem({ scope, text: '' });
    } catch {
      if (sequence !== generation.current) return;
      setSnapshot({ scope, requests: [] });
      setProblem({ scope, text: t('reliability.requestLoadError') });
    }
  }, [competitionId, scope, t]);
  useEffect(() => {
    if (!scope.signedIn) return invalidate;
    let timer: number | undefined;
    const update = () => { if (document.visibilityState !== 'hidden') void reload(); };
    const visibility = () => {
      clearTimeout(first); clearInterval(timer); timer = undefined;
      if (document.visibilityState !== 'hidden') {
        void reload();
        timer = window.setInterval(update, 15000);
      }
    };
    const first = window.setTimeout(visibility, 0);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('mg:substitutions', update);
    return () => { invalidate(); clearTimeout(first); clearInterval(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('mg:substitutions', update); };
  }, [reload, invalidate, scope.signedIn]);
  async function decide(id: number, approve: boolean) {
    if (!scope.signedIn || !canDecide || !requests.some(request => request.id === id && request.status === 'pending')) return;
    const epoch = lifecycle.current;
    setDecision({ scope, id }); setProblem({ scope, text: '' });
    try {
      await api.post(`/competitions/${competitionId}/substitution-requests/${id}/decision`, { approve });
      if (epoch !== lifecycle.current) return;
      await reload();
      if (epoch === lifecycle.current) onChanged?.();
    } catch (e) {
      if (epoch === lifecycle.current) setProblem({ scope, text: message(e, t('reliability.decisionError')) });
    } finally { if (epoch === lifecycle.current) setDecision(null); }
  }
  const visible = canDecide ? requests.filter(r => r.status === 'pending') : requests;
  // The compact pill only shows when there is something to decide; a failed check alone doesn't earn space above the lanes.
  if (!visible.length && (!error || compact)) return null;
  const panel = <section className="sp-card" aria-label={t('reliability.requests')}>
    <h2 className="sp-t1 px-4 pt-3">{canDecide ? t('reliability.pending') : t('reliability.yourRequests')}</h2>
    {error && <Notice actionLabel={t('reliability.tryAgain')} onAction={() => void reload()}>{error}</Notice>}
    {visible.map(request => <div key={request.id} className="p-4 border-t border-[rgb(var(--mg-rule-soft))] space-y-2">
      <p className="m-0 font-medium">{request.teamName}</p>
      <p className="m-0">{request.outRiderName} → {request.inRiderName || request.replacementRiderName || t('reliability.sameRider')}{request.replacementHorseName ? ` · ${t('reliability.pony', { name: request.replacementHorseName })}` : ''}</p>
      <p className="sp-note">{request.reason}</p>
      {canDecide ? <div className="kit-acts"><button type="button" className="kit-pill kit-pill-fill" disabled={busy !== null} onClick={() => void decide(request.id, true)}>{t('reliability.approve')}</button><button type="button" className="kit-pill" disabled={busy !== null} onClick={() => void decide(request.id, false)}>{t('reliability.decline')}</button></div> : <p role="status" className="sp-note">{request.status === 'pending' ? t('reliability.waiting') : request.status === 'approved' ? t('reliability.approved') : t('reliability.declined')}</p>}
    </div>)}
  </section>;
  return compact ? <><button type="button" className="kit-pill" onClick={() => setOpen(true)}>{t('reliability.pending')} · {visible.length}</button>{open && <Sheet title={t('reliability.requests')} onClose={() => setOpen(false)}>{panel}</Sheet>}</> : panel;
}
export function RequestSubstitution({ competitionId, form, onChanged }: { competitionId: number; form: DeclarationForm; onChanged?: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return <><button type="button" className="sc-link" onClick={() => setOpen(true)}>{t('reliability.request')} · {form.teamName}</button>
    {open && <SubstitutionForm competitionId={competitionId} form={form} onClose={() => setOpen(false)} onChanged={onChanged} />}</>;
}
function SubstitutionForm({ competitionId, form, onClose, onChanged }: { competitionId: number; form: DeclarationForm; onClose: () => void; onChanged?: () => void }) {
  const t = useT();
  const [outId, setOutId] = useState(form.riders.find(r => !r.isReserve)?.id ?? 0);
  const [inId, setInId] = useState(form.riders.find(r => r.isReserve)?.id ?? 0);
  const [rider, setRider] = useState('');
  const [pony, setPony] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send() {
    setBusy(true); setError('');
    try {
      await api.post(`/competitions/${competitionId}/substitution-requests/declarations/${form.id}`, { outRiderEntryId: outId, inRiderEntryId: inId,
        replacementRiderName: rider.trim() || null, replacementHorseName: pony.trim() || null, reason: reason.trim() });
      window.dispatchEvent(new Event('mg:substitutions')); onChanged?.(); onClose();
    } catch (e) { setError(message(e, t('reliability.requestError'))); }
    finally { setBusy(false); }
  }
  return <Sheet title={t('reliability.requestTitle')} description={t('reliability.requestHelp')} onClose={onClose}>
    <label className="kit-sheet-field">{t('reliability.outRider')}<select value={outId} onChange={e => setOutId(Number(e.target.value))}>{form.riders.filter(r => !r.isReserve).map(r => <option key={r.id} value={r.id}>{r.fullName}{r.horseName ? ` · ${r.horseName}` : ''}</option>)}</select></label>
    <label className="kit-sheet-field">{t('reliability.replacement')}<select value={inId} onChange={e => setInId(Number(e.target.value))}>{form.riders.filter(r => r.isReserve).map(r => <option key={r.id} value={r.id}>{r.fullName}</option>)}<option value={0}>{t('reliability.another')}</option></select></label>
    {inId === 0 && <><label className="kit-sheet-field">{t('reliability.replacementRider')}<input maxLength={200} value={rider} onChange={e => setRider(e.target.value)} /></label><label className="kit-sheet-field">{t('reliability.replacementPony')}<input maxLength={200} value={pony} onChange={e => setPony(e.target.value)} /></label></>}
    <label className="kit-sheet-field">{t('reliability.reason')}<textarea maxLength={500} rows={3} value={reason} onChange={e => setReason(e.target.value)} /></label>
    {error && <Notice>{error}</Notice>}
    <div className="kit-acts"><button type="button" className="kit-pill kit-pill-fill" disabled={busy || !outId || !reason.trim() || (inId === 0 && !rider.trim() && !pony.trim())} onClick={() => void send()}>{busy ? t('reliability.sending') : t('reliability.sendRequest')}</button></div>
  </Sheet>;
}
