import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, MapPin, MapPinned, Info, Layers, Users, Trophy,
  Hammer, Check, ChevronDown, ChevronUp, Lock, Unlock, Sparkles, Download,
  X, RotateCcw, Ban, CalendarPlus,
} from 'lucide-react';
import { useCompetition } from './context';
import { competitionDateText } from '../../lib/competitionDates';
import { competitionCalendarUrl } from '../../lib/sharing';
import { DemoEntryPayment } from '../commerce/DemoEntryPayment';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { CompetitionTeamCard } from './CompetitionTeamCard';
import { RiderPrivacyFields, type RiderPrivacy } from '../../components/RiderPrivacyFields';
import type { CompetitionSection, EquipmentLine, SectionSignup, SignupPaymentStatus } from '../../types';
import { downloadCsv, safeFilename, signupsToCsv } from '../../lib/csv';
import { Chevron, RefineList, RefineSection, RefineStatus, type StatusTone } from '../refine/Refine';

function priceLabel(minor?: number | null): string {
  if (!minor) return 'Free';
  return `£${(minor / 100).toFixed(2)}`;
}

const SIGNUP_STATUS: Record<SignupPaymentStatus, { label: string; tone: StatusTone; struck: boolean }> = {
  0: { label: 'Pending', tone: 'warn', struck: false },
  1: { label: 'Paid', tone: 'ok', struck: false },
  2: { label: 'Refunded', tone: 'mut', struck: true },
  3: { label: 'Cancelled', tone: 'bad', struck: true },
};

export function DetailsTab() {
  const { competition, reload } = useCompetition();
  const { canEdit, canManage, canOrganise, hasRole, user } = useAuth();
  const [signupResult, setSignupResult] = useState<{ key: string; items: SectionSignup[] } | null>(null);
  const signupKey = `${competition.id}:${user?.id ?? ''}`;
  const mayOrganise = canOrganise(competition);
  const allSignups = mayOrganise && signupResult?.key === signupKey ? signupResult.items : [];
  const [lockBusy, setLockBusy] = useState(false);

  async function refreshSignups() {
    if (!mayOrganise) return;
    try {
      const r = await api.get<SectionSignup[]>(`/competitions/${competition.id}/signups`);
      setSignupResult({ key: signupKey, items: r.data });
    } catch { setSignupResult({ key: signupKey, items: [] }); }
  }

  useEffect(() => {
    let cancelled = false;
    if (mayOrganise) {
      api.get<SectionSignup[]>(`/competitions/${competition.id}/signups`)
        .then(({ data }) => { if (!cancelled) setSignupResult({ key: signupKey, items: data }); })
        .catch(() => { if (!cancelled) setSignupResult({ key: signupKey, items: [] }); });
    }
    return () => { cancelled = true; };
  }, [competition.id, mayOrganise, signupKey]);

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

  const infoRow = (icon: ReactNode, label: string, value: ReactNode) => (
    <div className="rf-row">
      <span className="text-[rgb(var(--mg-heading))]" aria-hidden="true">{icon}</span>
      <div className="rf-grow"><dt className="rf-t2 !font-bold uppercase tracking-[0.08em]">{label}</dt><dd className="m-0 break-words text-[15px]">{value}</dd></div>
    </div>
  );
  const linkRow = (to: string, label: string) => (
    <li key={label}><Link className="rf-row" to={to}><span className="rf-grow rf-t1">{label}</span><Chevron /></Link></li>
  );

  return (
    <div className="rf-page mx-auto flex w-full max-w-3xl flex-col pb-4">
      <div className="mg-band py-3">
        <h1 className="mg-h1 mg-h1-sm">Details &amp; entries</h1>
      </div>

      <RefineSection title={competition.name} />
      <div className="rf-list">
        {(competition.organiserName || competition.description) && (
          <div className="px-4 py-3">
            {competition.organiserName && (
              <p className="mg-meta">Organised by <span className="font-semibold">{competition.organiserName}</span></p>
            )}
            {competition.description && (
              <p className="mg-lede mt-1 whitespace-pre-wrap">{competition.description}</p>
            )}
          </div>
        )}
        <dl className="m-0">
          {infoRow(<CalendarDays className="h-5 w-5" />, 'Dates', competitionDateText(competition.startDate, competition.endDate, true))}
          {competition.location && infoRow(<MapPin className="h-5 w-5" />, 'Location', competition.location)}
          {competition.what3Words && infoRow(<Info className="h-5 w-5" />, 'what3words', (
            <a
              href={`https://what3words.com/${competition.what3Words.replace(/^\/\/\//, '')}`}
              target="_blank" rel="noreferrer"
              className="font-mono font-semibold text-[rgb(var(--mg-heading))] hover:underline"
            >
              {competition.what3Words.startsWith('///') ? competition.what3Words : `///${competition.what3Words}`}
            </a>
          ))}
          {competition.appleMapsUrl && infoRow(<MapPinned className="h-5 w-5" />, 'Map pin', (
            <a href={competition.appleMapsUrl} target="_blank" rel="noreferrer" className="font-semibold text-[rgb(var(--mg-heading))] hover:underline">
              Open in Apple Maps
            </a>
          ))}
          {infoRow(<Layers className="h-5 w-5" />, 'Age groups', competition.sections.length || '—')}
          {infoRow(<Users className="h-5 w-5" />, 'Teams', competition.teams.length)}
        </dl>
      </div>

      <RefineSection title="Event links" />
      <RefineList label="Event links">
        {linkRow('../shop', 'Event shop')}
        {linkRow('../rulebooks', 'Rulebooks')}
        <li>
          <a className="rf-row" href={competitionCalendarUrl(competition.id, window.location.origin)}>
            <span className="rf-grow rf-t1">Add to calendar</span>
            <CalendarPlus className="h-5 w-5 rf-chev" aria-hidden="true" />
          </a>
        </li>
        {linkRow(`/event-tools/${competition.id}/print/draw`, 'Print draw')}
        {linkRow(`/event-tools/${competition.id}/print/results`, 'Print results')}
        {mayOrganise && linkRow(`/event-tools/${competition.id}/print/poster`, 'Print venue poster')}
        {mayOrganise && linkRow(`/event-tools/${competition.id}`, hasRole('Admin') || hasRole('Trainer') ? 'Import, duplicate & print' : 'Import & print')}
        {mayOrganise && linkRow('../shop/manage', 'Manage event shop')}
        {mayOrganise && linkRow('../operations', 'Readiness & draw')}
      </RefineList>

      {/* Entry controls (co-organisers and admins): lock signups, jump to the format wizard, CSV export. */}
      {mayOrganise && competition.sections.length > 0 && (
        <>
          <RefineSection title="Organiser tools" />
          <div className="rf-list flex flex-col gap-2 p-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={toggleLock}
                disabled={lockBusy}
                className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-[15px]"
                title={competition.signupsLocked
                  ? 'Signups are closed. Re-open to accept more entries.'
                  : 'Signups are open. Close once your entry window ends.'}
              >
                {competition.signupsLocked ? <Lock className="h-4 w-4" aria-hidden="true" /> : <Unlock className="h-4 w-4" aria-hidden="true" />}
                {competition.signupsLocked ? 'Re-open signups' : 'Close signups'}
              </button>
              <Link
                to={`/admin/competitions/${competition.id}/format`}
                className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-[15px]"
                title="Form teams + generate sessions/heats from paid signups"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" /> Format competition
              </Link>
              <button
                type="button"
                onClick={exportAllSignupsCsv}
                disabled={allSignups.length === 0}
                className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-[15px]"
              >
                <Download className="h-4 w-4" aria-hidden="true" /> Signups CSV
              </button>
            </div>
            {competition.signupsLocked && (
              <p className="mg-notice">
                Signups are <span className="font-semibold">closed</span>. The public form is hidden and new
                entries are rejected. Refund / cancel actions still work below.
              </p>
            )}
          </div>
        </>
      )}

      {/* The owner, competition admins and site admins see who runs the event and can change it (site admins in Edit mode). */}
      {user && (mayOrganise || hasRole('Admin')) && (
        <CompetitionTeamCard competitionId={competition.id} canWrite={canManage(competition)} />
      )}

      {/* Signup by section: signed-in users only; the public can't enter. */}
      {user && competition.sections.length > 0 && (
        <>
          <RefineSection title="Enter the competition" />
          {competition.paymentDestination && (
            <p className="rf-note !pt-0">
              Pay to: <span className="font-mono">{competition.paymentDestination}</span>
            </p>
          )}
          <ul className="rf-list">
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
                canManage={canEdit() || mayOrganise}
                hideJoin={hasRole('Admin')}
              />
            ))}
          </ul>
        </>
      )}

      {user && <EquipmentBlock competitionId={competition.id} />}
    </div>
  );
}

function SectionSignupCard({
  competitionId, section, allSignups, signupsLocked,
  competitionName,
  onChanged, canManage, hideJoin,
}: {
  competitionId: number;
  section: CompetitionSection;
  allSignups: SectionSignup[];
  signupsLocked: boolean;
  paymentDestination: string | null;
  competitionName: string;
  onChanged: () => void;
  canManage: boolean;
  /** True when the viewer is an admin — hide the Join CTA + form, keep manage list. */
  hideJoin: boolean;
}) {
  const { user } = useAuth();
  const [createdSignup, setCreatedSignup] = useState<SectionSignup | null>(null);
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [ponyClub, setPonyClub] = useState('');
  const [contact, setContact] = useState('');
  const [teamCode, setTeamCode] = useState('');
  const [privacy, setPrivacy] = useState<RiderPrivacy>({ useInitialOnly: false, noFilming: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const signups = allSignups.filter((s) => s.competitionSectionId === section.id);
  const paidCount = signups.filter((s) => s.status === 1).length;
  const max = section.maxParticipants;
  const seatsLeft = max ? Math.max(0, max - paidCount) : null;
  const full = seatsLeft != null && seatsLeft === 0;

  async function submit() {
    if (!fullName.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const { data: signup } = await api.post<SectionSignup>(`/competitions/${competitionId}/sections/${section.id}/signups`, {
        fullName: fullName.trim(),
        ponyClubName: ponyClub.trim() || null,
        contactInfo: contact.trim() || null,
        teamCode: teamCode.trim() || null,
        ...privacy,
      });
      setFullName(''); setPonyClub(''); setContact(''); setTeamCode('');
      setPrivacy({ useInitialOnly: false, noFilming: false });
      setCreatedSignup(signup);
      setDone(signup.status === 1 ? 'Your entry is confirmed.' : 'Your entry is saved. Payment is still due.');
      onChanged();
      setOpen(false);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setErr(typeof msg === 'string' ? msg : msg?.message ?? 'Could not sign up.');
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (signups.length === 0) return;
    downloadCsv(
      `${safeFilename(competitionName)}_${safeFilename(section.displayName)}_signups.csv`,
      signupsToCsv(signups),
    );
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rf-t1 flex-1">{section.displayName}</span>
        <span className="rf-price text-[rgb(var(--mg-heading))]">{priceLabel(section.priceMinor)}</span>
      </div>
      <div className="rf-t2">
        {paidCount} in
        {max ? ` · ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left` : ` · ${signups.length} signup${signups.length === 1 ? '' : 's'}`}
      </div>
      {hideJoin ? (
        <p className="rf-note !p-0 italic">Admin view — entrants only.</p>
      ) : signupsLocked ? (
        <p className="rf-note !p-0 italic">Entries closed.</p>
      ) : full ? (
        <p className="rf-note !p-0 italic">Section is full.</p>
      ) : !user ? (
        <Link to="/login" className="mg-btn mg-btn-primary w-full !min-h-11">Sign in to enter</Link>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="mg-btn mg-btn-primary w-full !min-h-11">
          <Trophy className="h-4 w-4" aria-hidden="true" /> Join {section.priceMinor ? `(${priceLabel(section.priceMinor)})` : ''}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="rf-fld">Your full name<input placeholder="Your full name" value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
          <label className="rf-fld">Pony Club<input placeholder="Pony Club (optional)" value={ponyClub} onChange={(e) => setPonyClub(e.target.value)} /></label>
          <label className="rf-fld">Phone or email<input placeholder="Phone / email (optional)" value={contact} onChange={(e) => setContact(e.target.value)} /></label>
          <label className="rf-fld">Team code
            <input
              className="font-mono uppercase"
              placeholder="Team code (optional) — e.g. STOCKPORT-A"
              value={teamCode}
              onChange={(e) => setTeamCode(e.target.value)}
            />
          </label>
          <RiderPrivacyFields value={privacy} onChange={(patch) => setPrivacy((cur) => ({ ...cur, ...patch }))} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !fullName.trim()}
              className="mg-btn mg-btn-primary flex-1 !min-h-11"
            >
              <Check className="h-4 w-4" aria-hidden="true" /> {busy ? 'Joining…' : 'Confirm'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="mg-btn mg-btn-secondary !min-h-11">Cancel</button>
          </div>
          <p className="rf-note !p-0">
            Paid entries stay pending until the organiser confirms payment. Demo events offer a test checkout after entry.
          </p>
        </div>
      )}
      {err && <p role="alert" className="m-0 text-sm font-semibold text-[rgb(var(--mg-elim))]">{err}</p>}
      {done && (
        <p role="status" className="m-0 flex items-center gap-1 text-sm font-semibold text-[rgb(var(--mg-ok))]">
          <Check className="h-4 w-4" aria-hidden="true" /> {done}
        </p>
      )}
      {createdSignup && (
        <DemoEntryPayment
          key={createdSignup.id}
          signupId={createdSignup.id}
          amountMinor={createdSignup.amountMinor}
          signupStatus={createdSignup.status}
          onChanged={onChanged}
        />
      )}
      {canManage && signups.length > 0 && (
        <details className="text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-[rgb(var(--mg-muted))]">
            <span className="flex-1 font-semibold">Manage ({signups.length})</span>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); exportCsv(); }}
              className="mg-icon-btn"
              title="Download these signups as CSV"
              aria-label="Download these signups as CSV"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </button>
          </summary>
          <ul className="m-0 flex list-none flex-col p-0">
            {signups.map((s) => (
              <SignupRow key={s.id} signup={s} onChanged={onChanged} />
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function SignupRow({ signup, onChanged }: { signup: SectionSignup; onChanged: () => void }) {
  const status = SIGNUP_STATUS[signup.status];
  async function setStatus(next: SignupPaymentStatus) {
    await api.put(`/signups/${signup.id}/status`, { status: next });
    onChanged();
  }
  async function remove() {
    if (!confirm(`Delete signup for ${signup.fullName}? This can't be undone.`)) return;
    await api.delete(`/signups/${signup.id}`);
    onChanged();
  }
  return (
    <li className="flex flex-wrap items-center gap-1 border-t border-[rgb(var(--mg-rule-soft))] py-1">
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-semibold ${status.struck ? 'line-through' : ''}`}>{signup.fullName}</span>
        {signup.ponyClubName && <span className="rf-t2 truncate">{signup.ponyClubName}</span>}
      </span>
      <RefineStatus tone={status.tone}>{status.label}</RefineStatus>
      {signup.status !== 1 && signup.status !== 3 && (
        <button type="button" onClick={() => setStatus(1)} className="mg-icon-btn" title="Mark paid" aria-label={`Mark ${signup.fullName} paid`}>
          <Check className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {signup.status === 1 && (
        <button type="button" onClick={() => setStatus(2)} className="mg-icon-btn" title="Mark refunded" aria-label={`Mark ${signup.fullName} refunded`}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {signup.status !== 3 && (
        <button type="button" onClick={() => setStatus(3)} className="mg-icon-btn" title="Cancel signup (keeps the record)" aria-label={`Cancel signup for ${signup.fullName}`}>
          <Ban className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      <button type="button" onClick={remove} className="mg-icon-btn" title="Delete signup permanently" aria-label={`Delete signup for ${signup.fullName}`}>
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
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
    <>
      <RefineSection title="Equipment" />
      <div className="rf-list">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rf-row"
        >
          <Hammer className="h-5 w-5 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
          <span className="rf-grow">
            <span className="rf-t1">Equipment required</span>
            <span className="rf-t2">Deduped across sessions, sized for the biggest heat</span>
          </span>
          {open ? <ChevronUp className="h-4 w-4 rf-chev" aria-hidden="true" /> : <ChevronDown className="h-4 w-4 rf-chev" aria-hidden="true" />}
        </button>
        {open && (
          data == null ? (
            <p className="rf-note px-4">Computing…</p>
          ) : data.lines.length === 0 ? (
            <p className="rf-note px-4 italic">No races set up yet, so nothing to count.</p>
          ) : (
            <div className="flex flex-col gap-3 px-4 py-3">
              <p className="rf-note !p-0">
                {data.sessions} session{data.sessions === 1 ? '' : 's'} · {data.racesCounted} unique race{data.racesCounted === 1 ? '' : 's'} counted
              </p>
              {bucketOrder.filter((b) => byBucket.has(b)).map((b) => (
                <div key={b}>
                  <h4 className="m-0 mb-1 text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">{b}</h4>
                  <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-1 p-0 text-sm sm:grid-cols-3">
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
    </>
  );
}
