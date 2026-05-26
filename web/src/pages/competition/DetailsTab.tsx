import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, MapPin, MapPinned, Info, Layers, Users, Banknote, Trophy,
  Hammer, Check, ChevronDown, ChevronUp, Lock, Unlock, Sparkles, Download,
  X, CreditCard, RotateCcw, Ban,
} from 'lucide-react';
import { useCompetition } from './context';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { CompetitionSection, EquipmentLine, SectionSignup, SignupPaymentStatus } from '../../types';
import { downloadCsv, safeFilename, signupsToCsv } from '../../lib/csv';

function priceLabel(minor?: number | null): string {
  if (!minor) return 'Free';
  return `£${(minor / 100).toFixed(2)}`;
}

const STATUS_PILL: Record<SignupPaymentStatus, { label: string; cls: string }> = {
  0: { label: 'pending', cls: 'text-amber-600' },
  1: { label: 'paid', cls: 'text-emerald-600' },
  2: { label: 'refunded', cls: 'text-slate-500 line-through' },
  3: { label: 'cancelled', cls: 'text-rose-500 line-through' },
};

export function DetailsTab() {
  const { competition, reload } = useCompetition();
  const { canEdit, canOrganise, hasRole } = useAuth();
  const [allSignups, setAllSignups] = useState<SectionSignup[]>([]);
  const [lockBusy, setLockBusy] = useState(false);

  async function refreshSignups() {
    try {
      const r = await api.get<SectionSignup[]>(`/competitions/${competition.id}/signups`);
      setAllSignups(r.data);
    } catch { /* noop */ }
  }

  useEffect(() => { refreshSignups(); }, [competition.id]);

  async function toggleLock() {
    if (lockBusy) return;
    setLockBusy(true);
    try {
      await api.post(`/competitions/${competition.id}/signups-locked`, { locked: !competition.signupsLocked });
      reload();
    } finally {
      setLockBusy(false);
    }
  }

  function exportAllSignupsCsv() {
    if (allSignups.length === 0) return;
    const csv = signupsToCsv(allSignups);
    downloadCsv(`${safeFilename(competition.name)}_signups.csv`, csv);
  }

  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold">{competition.name}</h2>
          {competition.organiserName && (
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              Organised by <span className="font-semibold">{competition.organiserName}</span>
            </p>
          )}
          {competition.description && (
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">
              {competition.description}
            </p>
          )}
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs sm:text-sm">
          <div className="flex items-start gap-2">
            <CalendarDays className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Dates</dt>
              <dd>
                {new Date(competition.startDate).toLocaleDateString()}
                {competition.endDate && ` → ${new Date(competition.endDate).toLocaleDateString()}`}
              </dd>
            </div>
          </div>

          {competition.location && (
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Location</dt>
                <dd className="break-words">{competition.location}</dd>
              </div>
            </div>
          )}

          {competition.what3Words && (
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">what3words</dt>
                <dd>
                  <a
                    href={`https://what3words.com/${competition.what3Words.replace(/^\/\/\//, '')}`}
                    target="_blank" rel="noreferrer"
                    className="font-mono text-rose-600 dark:text-rose-300 hover:underline"
                  >
                    {competition.what3Words.startsWith('///') ? competition.what3Words : `///${competition.what3Words}`}
                  </a>
                </dd>
              </div>
            </div>
          )}

          {competition.appleMapsUrl && (
            <div className="flex items-start gap-2">
              <MapPinned className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Map pin</dt>
                <dd>
                  <a
                    href={competition.appleMapsUrl}
                    target="_blank" rel="noreferrer"
                    className="text-brand-700 dark:text-brand-300 hover:underline"
                  >
                    Open in Apple Maps
                  </a>
                </dd>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2">
            <Layers className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Sections</dt>
              <dd>{competition.sections.length || '—'}</dd>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Users className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Teams</dt>
              <dd>{competition.teams.length}</dd>
            </div>
          </div>
        </dl>
      </div>

      {/* Organiser controls — lock signups, jump to format wizard, CSV export. */}
      {(canOrganise() || hasRole('Admin')) && competition.sections.length > 0 && (
        <div className="card p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide font-bold text-slate-500">Organiser tools</span>
            <button
              onClick={toggleLock}
              disabled={lockBusy}
              className={`btn-ghost !py-1 !px-2 text-[11px] ${
                competition.signupsLocked
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
              }`}
              title={competition.signupsLocked
                ? 'Signups are closed. Re-open to accept more entries.'
                : 'Signups are open. Close once your entry window ends.'}
            >
              {competition.signupsLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              {competition.signupsLocked ? 'Re-open signups' : 'Close signups'}
            </button>
            <Link
              to={`/admin/competitions/${competition.id}/format`}
              className="btn-ghost !py-1 !px-2 text-[11px] bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200"
              title="Form teams + generate sessions/heats from paid signups"
            >
              <Sparkles className="w-3 h-3" /> Format competition
            </Link>
            <button
              onClick={exportAllSignupsCsv}
              disabled={allSignups.length === 0}
              className="btn-ghost !py-1 !px-2 text-[11px]"
            >
              <Download className="w-3 h-3" /> Signups CSV
            </button>
          </div>
          {competition.signupsLocked && (
            <p className="text-[11px] text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded">
              Signups are <span className="font-semibold">closed</span>. The public form is hidden and new
              entries are rejected. Refund / cancel actions still work below.
            </p>
          )}
        </div>
      )}

      {/* Signup-by-section */}
      {competition.sections.length > 0 && (
        <div className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Banknote className="w-4 h-4 text-brand-600" /> Enter the competition
          </h3>
          {competition.paymentDestination && (
            <p className="text-[11px] text-slate-500 dark:text-slate-300">
              Pay to: <span className="font-mono">{competition.paymentDestination}</span>
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {competition.sections.map((sec) => (
              <SectionSignupCard
                key={sec.id}
                competitionId={competition.id}
                section={sec}
                allSignups={allSignups}
                signupsLocked={!!competition.signupsLocked}
                paymentDestination={competition.paymentDestination ?? null}
                competitionName={competition.name}
                onChanged={() => { refreshSignups(); reload(); }}
                canManage={canEdit() || canOrganise()}
              />
            ))}
          </div>
        </div>
      )}

      <EquipmentBlock competitionId={competition.id} />
    </div>
  );
}

function SectionSignupCard({
  competitionId, section, allSignups, signupsLocked,
  paymentDestination, competitionName,
  onChanged, canManage,
}: {
  competitionId: number;
  section: CompetitionSection;
  allSignups: SectionSignup[];
  signupsLocked: boolean;
  paymentDestination: string | null;
  competitionName: string;
  onChanged: () => void;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [ponyClub, setPonyClub] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [showPay, setShowPay] = useState(false);

  const signups = allSignups.filter((s) => s.competitionSectionId === section.id);
  const paidCount = signups.filter((s) => s.status === 1).length;
  const pendingCount = signups.filter((s) => s.status === 0).length;

  async function submit() {
    if (!fullName.trim()) return;
    setBusy(true);
    try {
      await api.post(`/competitions/${competitionId}/sections/${section.id}/signups`, {
        fullName: fullName.trim(),
        ponyClubName: ponyClub.trim() || null,
        contactInfo: contact.trim() || null,
      });
      setFullName(''); setPonyClub(''); setContact('');
      setDone(section.priceMinor
        ? `Signed up. Pay ${priceLabel(section.priceMinor)} to the organiser; you'll be marked paid once they confirm.`
        : 'Signed up.');
      setTimeout(() => setDone(null), 6000);
      onChanged();
      setOpen(false);
      setShowPay(false);
    } finally {
      setBusy(false);
    }
  }

  function openPayFlow() {
    // Free sections skip the modal entirely.
    if (!section.priceMinor) { submit(); return; }
    setShowPay(true);
  }

  function exportCsv() {
    if (signups.length === 0) return;
    downloadCsv(
      `${safeFilename(competitionName)}_${safeFilename(section.displayName)}_signups.csv`,
      signupsToCsv(signups),
    );
  }

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2.5 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm flex-1 truncate">{section.displayName}</span>
        <span className="text-sm font-bold text-brand-700 dark:text-brand-200">{priceLabel(section.priceMinor)}</span>
      </div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">
        {signups.length} signup{signups.length === 1 ? '' : 's'}
        {section.priceMinor ? ` · ${paidCount} paid` : ''}
        {pendingCount > 0 && section.priceMinor ? ` · ${pendingCount} pending` : ''}
      </div>
      {signupsLocked ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-200 italic">
          Entries closed for this competition.
        </p>
      ) : !open ? (
        <button onClick={() => setOpen(true)} className="btn-ghost !py-1 !px-2 text-[11px] w-full">
          <Trophy className="w-3 h-3" /> Sign up
        </button>
      ) : (
        <div className="space-y-1.5">
          <input className="input !py-1 text-xs" placeholder="Your full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <input className="input !py-1 text-xs" placeholder="Pony Club (optional)" value={ponyClub} onChange={(e) => setPonyClub(e.target.value)} />
          <input className="input !py-1 text-xs" placeholder="Phone / email (optional)" value={contact} onChange={(e) => setContact(e.target.value)} />
          <div className="flex gap-1">
            <button
              onClick={openPayFlow}
              disabled={busy || !fullName.trim()}
              className="btn-primary !py-1 !px-2 text-xs flex-1"
            >
              {section.priceMinor
                ? <><CreditCard className="w-3 h-3" /> Pay {priceLabel(section.priceMinor)}</>
                : (busy ? '…' : 'Sign up')}
            </button>
            <button onClick={() => setOpen(false)} className="btn-ghost !py-1 !px-2 text-xs">Cancel</button>
          </div>
        </div>
      )}
      {done && (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
          <Check className="w-3 h-3" /> {done}
        </p>
      )}
      {canManage && signups.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-slate-500 flex items-center gap-2">
            <span className="flex-1">Manage ({signups.length})</span>
            <span
              role="button"
              onClick={(e) => { e.preventDefault(); exportCsv(); }}
              className="text-slate-600 hover:text-brand-700 dark:hover:text-brand-200"
              title="Download these signups as CSV"
            >
              <Download className="w-3 h-3 inline" />
            </span>
          </summary>
          <ul className="mt-1 space-y-1">
            {signups.map((s) => (
              <SignupRow key={s.id} signup={s} onChanged={onChanged} />
            ))}
          </ul>
        </details>
      )}

      {showPay && (
        <PaymentPlaceholderModal
          amount={priceLabel(section.priceMinor)}
          section={section.displayName}
          paymentDestination={paymentDestination}
          busy={busy}
          onConfirm={submit}
          onClose={() => setShowPay(false)}
        />
      )}
    </div>
  );
}

function SignupRow({ signup, onChanged }: { signup: SectionSignup; onChanged: () => void }) {
  const pill = STATUS_PILL[signup.status];
  async function setStatus(status: SignupPaymentStatus) {
    await api.put(`/signups/${signup.id}/status`, { status });
    onChanged();
  }
  async function remove() {
    if (!confirm(`Delete signup for ${signup.fullName}? This can't be undone.`)) return;
    await api.delete(`/signups/${signup.id}`);
    onChanged();
  }
  return (
    <li className="flex items-center gap-1 flex-wrap">
      <span className="flex-1 truncate">
        <span className={pill.cls.includes('line-through') ? pill.cls : ''}>{signup.fullName}</span>
        {signup.ponyClubName && <span className="text-slate-500"> · {signup.ponyClubName}</span>}
      </span>
      <span className={`text-[9px] uppercase font-bold ${pill.cls.split(' ')[0]}`}>{pill.label}</span>
      {signup.status !== 1 && signup.status !== 3 && (
        <button
          onClick={() => setStatus(1)}
          className="btn-ghost !py-0.5 !px-1 text-[10px] text-emerald-600"
          title="Mark paid"
        >
          <Check className="w-3 h-3" />
        </button>
      )}
      {signup.status === 1 && (
        <button
          onClick={() => setStatus(2)}
          className="btn-ghost !py-0.5 !px-1 text-[10px] text-slate-500"
          title="Mark refunded"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}
      {signup.status !== 3 && (
        <button
          onClick={() => setStatus(3)}
          className="btn-ghost !py-0.5 !px-1 text-[10px] text-rose-500"
          title="Cancel signup (keeps the record)"
        >
          <Ban className="w-3 h-3" />
        </button>
      )}
      <button
        onClick={remove}
        className="btn-ghost !py-0.5 !px-1 text-[10px] text-rose-700"
        title="Delete signup permanently"
      >
        <X className="w-3 h-3" />
      </button>
    </li>
  );
}

function PaymentPlaceholderModal({
  amount, section, paymentDestination, busy, onConfirm, onClose,
}: {
  amount: string;
  section: string;
  paymentDestination: string | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="card p-4 max-w-sm w-full space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-brand-600" />
          <h3 className="font-bold text-base">Pay {amount}</h3>
          <button onClick={onClose} className="ml-auto btn-ghost !py-1 !px-1.5 text-xs"><X className="w-3 h-3" /></button>
        </div>
        <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-900/20 p-2 text-[11px] text-amber-800 dark:text-amber-200">
          <strong>Online payment coming soon.</strong> For now please pay the organiser directly
          using the details below. Click <em>Confirm signup</em> and the organiser will mark
          you paid once the funds land.
        </div>
        <dl className="text-xs space-y-1">
          <div className="flex gap-2">
            <dt className="font-semibold w-24 shrink-0 text-slate-500">Section</dt>
            <dd>{section}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold w-24 shrink-0 text-slate-500">Amount</dt>
            <dd className="font-bold text-brand-700 dark:text-brand-200">{amount}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold w-24 shrink-0 text-slate-500">Pay to</dt>
            <dd className="font-mono break-all">{paymentDestination || 'Ask the organiser'}</dd>
          </div>
        </dl>
        <div className="flex gap-2">
          <button onClick={onConfirm} disabled={busy} className="btn-primary !py-1.5 !px-3 text-sm flex-1">
            <Check className="w-4 h-4" /> {busy ? 'Submitting…' : 'Confirm signup'}
          </button>
          <button onClick={onClose} className="btn-ghost !py-1.5 !px-3 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function EquipmentBlock({ competitionId }: { competitionId: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ lines: EquipmentLine[]; sessions: number; racesCounted: number } | null>(null);

  useEffect(() => {
    if (!open || data) return;
    api.get<{ lines: EquipmentLine[]; sessions: number; racesCounted: number }>(`/competitions/${competitionId}/equipment`)
      .then((r) => setData(r.data))
      .catch(() => {});
  }, [open, competitionId, data]);

  const byBucket = new Map<string, EquipmentLine[]>();
  for (const l of data?.lines ?? []) {
    if (!byBucket.has(l.bucket)) byBucket.set(l.bucket, []);
    byBucket.get(l.bucket)!.push(l);
  }
  const bucketOrder = ['Lane', 'Start', 'Mid', 'Top', 'Side', 'Other'];

  return (
    <div className="card p-4 space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-sm font-semibold"
      >
        <Hammer className="w-4 h-4 text-brand-600" />
        Equipment required
        <span className="text-[11px] text-slate-500 font-normal ml-1">
          (deduped across sessions, sized for the biggest heat)
        </span>
        <span className="ml-auto">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
      </button>
      {open && (
        data == null ? (
          <p className="text-xs text-slate-500">Computing…</p>
        ) : data.lines.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No races set up yet, so nothing to count.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {data.sessions} session{data.sessions === 1 ? '' : 's'} · {data.racesCounted} unique race{data.racesCounted === 1 ? '' : 's'} counted
            </p>
            {bucketOrder.filter((b) => byBucket.has(b)).map((b) => (
              <div key={b}>
                <h4 className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold mb-0.5">
                  {b}
                </h4>
                <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 text-xs">
                  {byBucket.get(b)!.sort((a, b2) => a.kind.localeCompare(b2.kind)).map((l) => (
                    <li key={`${b}-${l.kind}`} className="flex justify-between">
                      <span>{l.kind}</span>
                      <span className="font-mono font-bold tabular-nums">×{l.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
