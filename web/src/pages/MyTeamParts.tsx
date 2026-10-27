import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, ChevronDown, CircleAlert, RefreshCw, X } from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n/LanguageContext';
import { joinKeyFromSearch } from '../lib/sharing';
import type { Team, TeamSupporter } from '../types';
import { JoinQr, TeamCalendarFeed } from './TeamSharing';
import { SelectField } from '../components/SelectField';
import { confirmDialog } from '../components/ConfirmDialog';
import { Notice } from '../components/Notice';
import { useToast } from '../components/Toast';

const messageOf = (e: unknown, fallback: string) => {
  const data = (e as { response?: { data?: { message?: string } | string } }).response?.data;
  return typeof data === 'string' ? data : data?.message ?? fallback;
};

/** "Join a team with a code": a supporter or parent types the code a trainer gave them. */
export function JoinTeamCard({ onJoined }: { onJoined: () => void }) {
  const t = useT();
  // A scanned team QR code opens this page with the key in the address (/teams?join=KEY).
  const { search } = useLocation();
  const [key, setKey] = useState(() => joinKeyFromSearch(search));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await api.post<TeamSupporter>('/teams/join', { key: key.trim() });
      setKey('');
      setResult(data.status === 1 ? t('account.join.supporting', { team: data.teamName }) : t('account.join.requested', { team: data.teamName }));
      onJoined();
    } catch (e) {
      setError(messageOf(e, t('account.join.failed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mg-card space-y-2 p-3">
      <h2 className="mg-display text-lg font-bold text-[rgb(var(--mg-heading))]">{t('account.join.title')}</h2>
      <p className="mg-meta">{t('account.join.help')}</p>
      <div className="flex gap-2">
        <input
          className="input min-h-11 flex-1 font-mono text-sm uppercase tracking-widest"
          aria-label={t('account.join.keyAria')}
          placeholder="ABCD1234"
          maxLength={16}
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') join(); }}
        />
        <button onClick={join} disabled={busy || !key.trim()} className="mg-btn mg-btn-primary !min-h-11 !px-4">{busy ? '…' : t('account.join.button')}</button>
      </div>
      {result && <Notice tone="info">{result}</Notice>}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}

/** The parent join code: shown with Copy and Change. Change opens a small editor for a custom, random or switched-off code. */
export function CodeRow({ team, onTeamUpdated }: { team: Team; onTeamUpdated: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function copyKey() {
    if (!team.supporterJoinKey) return;
    navigator.clipboard?.writeText(team.supporterJoinKey)
      .then(() => toast.show(t('account.code.copied')))
      .catch(() => {});
  }
  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setCodeErr(null);
    setCodeProblem(null);
    try {
      await action();
      onTeamUpdated();
      after?.();
    } catch (e) {
      setCodeProblem(messageOf(e, t('account.code.failed')));
    } finally {
      setBusy(false);
    }
  }
  const saveCustom = () => {
    const code = codeInput.trim().toUpperCase();
    if (code.length < 3) { setCodeErr(t('account.code.tooShort')); return; }
    return run(() => api.put(`/teams/${team.id}/team-code`, { code }), () => { setEditing(false); setCodeInput(''); });
  };
  const random = () => run(() => api.post(`/teams/${team.id}/supporter-key`), () => setEditing(false));
  const revoke = async () => {
    if (!(await confirmDialog({ title: t('account.code.offTitle'), message: t('account.code.offMessage'), confirmLabel: t('account.code.off'), destructive: true }))) return;
    return run(() => api.delete(`/teams/${team.id}/supporter-key`), () => setEditing(false));
  };

  return (
    <div className="border-t border-[rgb(var(--mg-rule-soft))]">
      <div className="flex min-h-[52px] items-center gap-2 py-1.5 pl-3.5 pr-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-[rgb(var(--mg-muted))]">{t('account.code.label')}</span>
          <span className="mg-display truncate text-lg font-bold leading-none tracking-[0.08em]">{team.supporterJoinKey ?? t('account.code.notSet')}</span>
        </span>
        {team.supporterJoinKey && <button type="button" onClick={copyKey} className="mg-small-btn" aria-label={t('account.code.copyAria', { team: team.displayName })}>{t('account.code.copy')}</button>}
        <button type="button" onClick={() => { setEditing(!editing); setCodeInput(team.supporterJoinKey ?? ''); setCodeErr(null); setCodeProblem(null); }} aria-expanded={editing} className="inline-flex min-h-11 items-center px-2.5 text-[13px] font-semibold text-[rgb(var(--mg-heading))]">{team.supporterJoinKey ? t('account.code.change') : t('account.code.set')}<span className="sr-only">{t('account.code.forTeam', { team: team.displayName })}</span></button>
      </div>
      {editing && (
        <div className="space-y-2 bg-[rgb(var(--mg-subtle))] px-3.5 py-3">
          <div className="flex items-center gap-2">
            <input className="input min-h-11 flex-1 font-mono text-sm uppercase" aria-label={t('account.code.newAria')} placeholder="STOCKPORT-A" maxLength={32} value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} autoFocus />
            <button type="button" onClick={saveCustom} disabled={busy} className="mg-btn mg-btn-primary !min-h-11 !px-3"><Check className="h-4 w-4" aria-hidden="true" /> {t('common.save')}</button>
            <button type="button" onClick={() => { setEditing(false); setCodeErr(null); setCodeProblem(null); }} className="mg-icon-btn" aria-label={t('common.cancel')}><X className="h-4 w-4" /></button>
          </div>
          <p className="mg-meta">{t('account.code.rules')}</p>
          {codeErr && <p role="alert" className="mg-field-msg text-sm font-medium text-[rgb(var(--mg-elim))]"><CircleAlert aria-hidden="true" />{codeErr}</p>}
          {codeProblem && <Notice>{codeProblem}</Notice>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={random} disabled={busy} className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-sm"><RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('account.code.random')}</button>
            {team.supporterJoinKey && <button type="button" onClick={revoke} disabled={busy} className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-sm !text-[rgb(var(--mg-elim))]">{t('account.code.off')}</button>}
          </div>
        </div>
      )}
      {toast.node}
    </div>
  );
}

/** A supporter list for the trainer: who has joined, who is waiting, plus the team's QR code and calendar feed. */
export function SupportersBlock({ team }: { team: Team }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [supporters, setSupporters] = useState<TeamSupporter[]>([]);

  const fetchSupporters = useCallback(
    () => api.get<TeamSupporter[]>(`/teams/${team.id}/supporters`).then((r) => r.data).catch(() => [] as TeamSupporter[]),
    [team.id],
  );
  async function load() { setSupporters(await fetchSupporters()); }
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchSupporters().then((list) => { if (!cancelled) setSupporters(list); });
    return () => { cancelled = true; };
  }, [open, fetchSupporters]);

  async function accept(s: TeamSupporter) {
    await api.put(`/team-supporters/${s.id}/accept`);
    load();
  }
  async function kick(s: TeamSupporter) {
    if (!(await confirmDialog({ title: t('account.supporters.removeTitle', { name: s.userName }), message: t('account.supporters.removeMessage'), confirmLabel: t('account.supporters.removeConfirm'), destructive: true }))) return;
    await api.delete(`/team-supporters/${s.id}`);
    load();
  }

  const pendingCount = supporters.filter((s) => s.status === 0).length;
  const acceptedCount = supporters.filter((s) => s.status === 1).length;

  return (
    <div className="border-t border-[rgb(var(--mg-rule-soft))]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[13px] font-semibold text-[rgb(var(--mg-heading))]">
        {t('account.supporters.title')}
        {acceptedCount > 0 && <span className="font-medium text-[rgb(var(--mg-muted))]">· {acceptedCount}</span>}
        {pendingCount > 0 && <span className="mg-tag mg-tag-late">{t('account.supporters.pending', { count: pendingCount })}</span>}
        <ChevronDown className={`ml-auto h-4 w-4 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-2 px-3.5 pb-3">
          <p className="mg-meta">{t('account.supporters.helpBefore')}<em>{t('account.supporters.helpPage')}</em>{t('account.supporters.helpAfter')}</p>
          <JoinQr team={team} />
          <TeamCalendarFeed team={team} />
          {supporters.length > 0 && (
            <ul className="divide-y divide-[rgb(var(--mg-rule-soft))] text-sm">
              {supporters.map((s) => (
                <li key={s.id} className="flex min-h-11 items-center gap-2 py-1">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold">{s.userName}</span>
                    {s.userEmail && <span className="text-[rgb(var(--mg-muted))]"> · {s.userEmail}</span>}
                  </span>
                  {s.status === 0
                    ? <button onClick={() => accept(s)} className="mg-btn mg-btn-primary !min-h-11 !px-3 !text-sm"><Check className="h-4 w-4" aria-hidden="true" /> {t('account.signups.accept')}</button>
                    : <span className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--mg-ok))]">{t('account.supporters.active')}</span>}
                  <button onClick={() => kick(s)} className="mg-icon-btn" aria-label={t('account.supporters.removeAria', { name: s.userName })}><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** For a club's Team Manager: who trains the team, and what its bibs look like. */
export function ManageTeamBlock({ team, onSaved }: { team: Team; onSaved: () => void }) {
  const t = useT();
  const [trainers, setTrainers] = useState<{ userId: string; fullName: string }[]>([]);
  const [trainerId, setTrainerId] = useState(team.trainerUserId ?? '');
  const [bibs, setBibs] = useState(team.bibDescription ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.get<{ userId: string; fullName: string }[]>(`/clubs/${team.clubId}/trainers`)
      .then((r) => setTrainers(r.data))
      .catch(() => setTrainers([]));
  }, [team.clubId]);

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      await api.put(`/teams/${team.id}/trainer`, { trainerUserId: trainerId, bibDescription: bibs });
      toast.show(t('account.manage.saved'));
      onSaved();
    } catch {
      setProblem(t('account.manage.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-[rgb(var(--mg-rule-soft))] px-3.5 py-3">
      <label className="block text-xs">
        <span className="text-[rgb(var(--mg-muted))]">{t('account.manage.trainer')}</span>
        <SelectField className="input mt-1 min-h-11 text-sm" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
          <option value="">{t('account.manage.noTrainer')}</option>
          {trainers.map((trainer) => <option key={trainer.userId} value={trainer.userId}>{trainer.fullName}</option>)}
        </SelectField>
      </label>
      <label className="block text-xs">
        <span className="text-[rgb(var(--mg-muted))]">{t('account.manage.bibs')}</span>
        <input className="input mt-1 min-h-11 text-sm" maxLength={200} placeholder={t('account.manage.bibsPlaceholder')} value={bibs} onChange={(e) => setBibs(e.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <button type="button" className="mg-btn mg-btn-primary !min-h-11 !px-3 !text-sm" disabled={busy} onClick={save}>{t('account.manage.save')}</button>
      </div>
      {problem && <Notice actionLabel={t('common.tryAgain')} onAction={save} actionDisabled={busy}>{problem}</Notice>}
      {toast.node}
    </div>
  );
}
