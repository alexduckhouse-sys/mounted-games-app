import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CalendarDays, MapPin, MapPinned, Info, Layers, Users, Trophy,
  Hammer, Check, ChevronDown, ChevronUp, Lock, Unlock, Sparkles, Download,
  X, RotateCcw, Ban, CalendarPlus,
} from 'lucide-react';
import { useCompetition } from './context';
import { competitionDateText } from '../../lib/competitionDates';
import { competitionCalendarUrl } from '../../lib/sharing';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { CompetitionTeamCard } from './CompetitionTeamCard';
import { EmbedCard } from './EmbedCard';
import { ScorerLinksCard } from './ScorerLinksCard';
import { SponsorsCard } from './SponsorsCard';
import { SponsorStrip } from '../../components/SponsorStrip';
import { hasPlacement } from '../../lib/sponsors';
import { RiderPrivacyFields, type RiderPrivacy } from '../../components/RiderPrivacyFields';
import { TermsTickBox } from '../../components/TermsTickBox';
import { CONSENT_VERSION } from '../../lib/termsTick';
import { EntryEmailFields, type EntryEmail } from '../../components/EntryEmailFields';
import { EMAIL_OPT_IN_VERSION, confirmationEmailLabel, looksLikeEmail, newRequestId } from '../../lib/emailOptIn';
import type { CompetitionSection, EquipmentLine, SectionSignup, SignupPaymentStatus } from '../../types';
import { downloadCsv, safeFilename, signupsToCsv } from '../../lib/csv';
import { Chevron, RefineList, RefineSection, RefineStatus, type StatusTone } from '../refine/Refine';
import { usePageHeader } from '../../components/CompactPageBarContext';

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
  const { competition, reload, sponsors } = useCompetition();
  const { canEdit, canManage, canOrganise, hasRole, user } = useAuth();
  const [signupResult, setSignupResult] = useState<{ key: string; items: SectionSignup[] } | null>(null);
  const signupKey = `${competition.id}:${user?.id ?? ''}`;
  const mayOrganise = canOrganise(competition);
  const allSignups = mayOrganise && signupResult?.key === signupKey ? signupResult.items : [];
  const [lockBusy, setLockBusy] = useState(false);
  const [descOpen, setDescOpen] = useState(false);

  usePageHeader({ title: 'Details', subtitle: `${competition.name}${competitionDateText(competition.startDate, competition.endDate) ? ` · ${competitionDateText(competition.startDate, competition.endDate)}` : ''}`, onRefresh: reload, refreshLabel: 'Refresh details' });

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
    const csv = signupsToCsv(allSignups, { test: !!competition.isDemo });
    downloadCsv(`${safeFilename(competition.name)}_signups.csv`, csv);
  }

  const infoRow = (icon: ReactNode, label: string, value: ReactNode) => (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-[rgb(var(--mg-heading))]" aria-hidden="true">{icon}</span>
      <div className="flex flex-col gap-0.5"><dt className="rf-t2 !font-bold uppercase tracking-[0.08em]">{label}</dt><dd className="m-0 break-words text-[15px]">{value}</dd></div>
    </div>
  );
  const linkRow = (to: string, label: string) => (
    <li key={label}><Link className="rf-row" to={to}><span className="rf-grow rf-t1">{label}</span><Chevron /></Link></li>
  );

  const hasSponsorPage = (sponsors ?? []).some((sponsor) => hasPlacement(sponsor.showOn, 'SponsorPage'));
  const longDescription = (competition.description?.length ?? 0) > 140;

  return (
    <div className="rf-page mx-auto flex w-full max-w-3xl flex-col gap-2.5 pb-4 pt-3">
      <h1 className="sr-only">Details &amp; entries</h1>

      <div className="mg-card flex flex-col gap-4 p-4">
        <div>
          <h2 className="mg-display text-2xl font-bold leading-[1.1] text-[rgb(var(--mg-heading))]">{competition.name}</h2>
          {competition.organiserName && (
            <p className="mg-meta mt-1">Organised by <span className="font-semibold">{competition.organiserName}</span></p>
          )}
          {competition.description && (
            <>
              <p className={`mg-lede mt-2 whitespace-pre-wrap ${longDescription && !descOpen ? 'line-clamp-2' : ''}`}>{competition.description}</p>
              {longDescription && (
                <button type="button" className="mg-text-link !min-h-11 !justify-start" aria-expanded={descOpen} onClick={() => setDescOpen((open) => !open)}>
                  {descOpen ? 'Less' : 'More'}
                </button>
              )}
            </>
          )}
        </div>
        <dl className="m-0 grid grid-cols-1 gap-3">
          {infoRow(<CalendarDays className="h-4 w-4" />, 'Dates', competitionDateText(competition.startDate, competition.endDate, true))}
          {competition.location && infoRow(<MapPin className="h-4 w-4" />, 'Location', competition.location)}
          {competition.what3Words && infoRow(<Info className="h-4 w-4" />, 'what3words', (
            <a
              href={`https://what3words.com/${competition.what3Words.replace(/^\/\/\//, '')}`}
              target="_blank" rel="noreferrer"
              className="font-mono font-semibold text-[rgb(var(--mg-heading))] hover:underline"
            >
              {competition.what3Words.startsWith('///') ? competition.what3Words : `///${competition.what3Words}`}
            </a>
          ))}
          {competition.appleMapsUrl && infoRow(<MapPinned className="h-4 w-4" />, 'Map pin', (
            <a href={competition.appleMapsUrl} target="_blank" rel="noreferrer" className="font-semibold text-[rgb(var(--mg-heading))] hover:underline">
              Open in Apple Maps
            </a>
          ))}
          {infoRow(<Layers className="h-4 w-4" />, 'Age groups', competition.sections.length || '—')}
          {infoRow(<Users className="h-4 w-4" />, 'Teams', competition.teams.length)}
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
        {(hasSponsorPage || mayOrganise) && linkRow('../sponsors', 'Sponsors')}
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
      {user && (mayOrganise || hasRole('Admin')) && (
        <ScorerLinksCard competitionId={competition.id} canWrite={canManage(competition)} />
      )}

      {mayOrganise && <SponsorsCard competitionId={competition.id} />}
      {/* Owner, competition admins and site admins can put live results on their own website. */}
      {mayOrganise && <EmbedCard kind="competition" competitionId={competition.id} name={competition.name} sections={competition.sections} />}

      <SponsorStrip placement="Details" />

      {/* Signup by section: signed-in users only; the public can't enter. */}
      {user && competition.sections.length > 0 && (
        <>
          <RefineSection title="Enter the competition" meta={competition.paymentDestination ? <>Pay to <span className="font-mono">{competition.paymentDestination}</span></> : undefined} />
          <div className="grid grid-cols-2 gap-2">
            {competition.sections.map((sec) => (
              <SectionSignupCard
                key={sec.id}
                competitionId={competition.id}
                section={sec}
                allSignups={allSignups}
                signupsLocked={!!competition.signupsLocked}
                isDemo={!!competition.isDemo}
                paymentDestination={competition.paymentDestination ?? null}
                termsText={competition.termsText ?? null}
                competitionName={competition.name}
                onChanged={() => { refreshSignups(); reload(); }}
                canManage={canEdit() || mayOrganise}
                hideJoin={hasRole('Admin')}
                countsKnown={mayOrganise}
              />
            ))}
          </div>
        </>
      )}

      {user && <EquipmentBlock competitionId={competition.id} />}
    </div>
  );
}

function SectionSignupCard({
  competitionId, section, allSignups, signupsLocked,
  competitionName, isDemo, termsText,
  onChanged, canManage, hideJoin, countsKnown,
}: {
  competitionId: number;
  section: CompetitionSection;
  allSignups: SectionSignup[];
  signupsLocked: boolean;
  /** A demo event: a paid entry goes on to the test payment page. */
  isDemo: boolean;
  paymentDestination: string | null;
  termsText: string | null;
  competitionName: string;
  onChanged: () => void;
  canManage: boolean;
  /** True when the viewer is an admin — hide the Join CTA + form, keep manage list. */
  hideJoin: boolean;
  /** Only organisers receive the signup list, so places taken is only known to them. */
  countsKnown: boolean;
}) {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [ponyClub, setPonyClub] = useState('');
  const [contact, setContact] = useState('');
  const [entryEmail, setEntryEmail] = useState<EntryEmail>({ email: '', optIn: false });
  // One id per attempt: if the connection drops and the form is sent again, the server returns the first entry.
  const requestId = useRef<string | null>(null);
  const [teamCode, setTeamCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [wholeTeam, setWholeTeam] = useState(false);
  const [privacy, setPrivacy] = useState<RiderPrivacy>({ useInitialOnly: false, noFilming: false });
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const signups = allSignups.filter((s) => s.competitionSectionId === section.id);
  // Paid and pending entries both take a seat (the API counts them the same way). Only organisers load the
  // signup list, so everyone else reads the count the API sends with the section.
  const takenSeats = allSignups.length > 0
    ? signups.filter((s) => s.status === 0 || s.status === 1).length
    : section.activeSignupsCount ?? 0;
  const known = countsKnown || section.activeSignupsCount != null;
  const canEnterWholeTeam = section.format === 2 && (hasRole('Manager') || hasRole('Trainer'));
  const max = section.maxParticipants;
  const seatsLeft = max ? Math.max(0, max - takenSeats) : null;
  const full = seatsLeft != null && seatsLeft === 0;

  async function submit() {
    if (!fullName.trim() || !accepted) return;
    const emailText = entryEmail.email.trim();
    if (emailText && !looksLikeEmail(emailText)) { setErr("That email address doesn't look right."); return; }
    requestId.current ??= newRequestId();
    setBusy(true);
    setErr(null);
    try {
      const { data: signup } = await api.post<SectionSignup>(`/competitions/${competitionId}/sections/${section.id}/signups`, {
        fullName: fullName.trim(),
        ponyClubName: ponyClub.trim() || null,
        contactInfo: contact.trim() || null,
        contactEmail: emailText || null,
        emailOptIn: !!emailText && entryEmail.optIn,
        emailOptInVersion: emailText && entryEmail.optIn ? EMAIL_OPT_IN_VERSION : null,
        requestId: requestId.current,
        teamCode: teamCode.trim() || null,
        teamName: teamName.trim() || null,
        wholeTeam: wholeTeam && canEnterWholeTeam,
        ...privacy,
        acceptTerms: accepted,
        consentVersion: CONSENT_VERSION,
      });
      setFullName(''); setPonyClub(''); setContact(''); setTeamCode(''); setTeamName(''); setWholeTeam(false);
      setEntryEmail({ email: '', optIn: false });
      requestId.current = null;
      setPrivacy({ useInitialOnly: false, noFilming: false });
      setAccepted(false);
      setDone((signup.status === 1 ? 'Your entry is confirmed.' : 'Your entry is saved. Payment is still due.')
        + (signup.confirmationEmailStatus === 1 ? ' We have emailed you a confirmation.'
          : signup.confirmationEmailStatus === 2 ? " We couldn't send the confirmation email, but your entry is saved." : ''));
      onChanged();
      setOpen(false);
      // Demo events only: straight on to the clearly labelled test payment page.
      if (isDemo && signup.status === 0 && signup.amountMinor > 0) navigate(`/me/signups/${signup.id}/test-payment`);
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
      signupsToCsv(signups, { test: isDemo }),
    );
  }

  const places = max ? Math.round((takenSeats / max) * 100) : 30;
  const scarce = seatsLeft != null && seatsLeft > 0 && seatsLeft <= 4;
  const wide = open || (canManage && signups.length > 0);
  return (
    <div className={`mg-card flex flex-col gap-1.5 p-2.5 ${wide ? 'col-span-2 border-[rgb(var(--mg-heading))]' : ''}`}>
      <div className="flex items-baseline gap-1.5">
        <span className="mg-display flex-1 text-base font-bold uppercase leading-none tracking-[0.03em] text-[rgb(var(--mg-heading))]">{section.displayName}</span>
        <span className="mg-display text-base font-bold leading-none">{priceLabel(section.priceMinor)}</span>
      </div>
      {known && (
        <div className="h-1 overflow-hidden rounded-sm bg-[rgb(var(--mg-tint))]" aria-hidden="true">
          <div className={`h-full ${full ? 'bg-[rgb(var(--mg-dash))]' : scarce ? 'bg-[rgb(var(--mg-late-time))]' : 'bg-[rgb(var(--mg-heading))]'}`} style={{ width: `${places}%` }} />
        </div>
      )}
      <span className={`text-xs font-medium ${scarce ? 'text-[rgb(var(--mg-late-ink))]' : 'text-[rgb(var(--mg-muted))]'}`}>
        {!known ? (max ? `Up to ${max} places` : 'No limit')
          : full ? 'Full' : max ? `${seatsLeft} of ${max} places left` : `${takenSeats} entered · no limit`}
        {known && <span className="sr-only">. {takenSeats} in{max ? `, ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left` : `, ${signups.length} signup${signups.length === 1 ? '' : 's'}`}</span>}
      </span>
      {hideJoin ? (
        <p className="rf-note !p-0 italic">Admin view — entrants only.</p>
      ) : signupsLocked ? (
        <p className="rf-note !p-0 italic">Entries closed.</p>
      ) : full ? (
        <span className="flex min-h-9 items-center justify-center rounded-lg bg-[rgb(var(--mg-subtle))] text-[13px] font-semibold text-[rgb(var(--mg-muted))]">Full</span>
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
          <label className="rf-fld">Phone<input type="tel" autoComplete="tel" placeholder="Phone (optional)" value={contact} onChange={(e) => setContact(e.target.value)} /></label>
          <EntryEmailFields value={entryEmail} onChange={setEntryEmail} />
          {canEnterWholeTeam && (
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={wholeTeam} onChange={(e) => setWholeTeam(e.target.checked)} />
              Enter a whole team
            </label>
          )}
          <label className="rf-fld">{wholeTeam ? 'Team name' : 'Team name (optional)'}
            <input placeholder={wholeTeam ? 'e.g. Welsh Dragons' : 'Riders with the same team name are put together'} value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          </label>
          <label className="rf-fld">Team code
            <input
              className="font-mono uppercase"
              placeholder="Team code (optional) — e.g. STOCKPORT-A"
              value={teamCode}
              onChange={(e) => setTeamCode(e.target.value)}
            />
          </label>
          <RiderPrivacyFields value={privacy} onChange={(patch) => setPrivacy((cur) => ({ ...cur, ...patch }))} />
          <TermsTickBox termsText={termsText} checked={accepted} onChange={setAccepted} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !fullName.trim() || !accepted || (wholeTeam && !teamName.trim())}
              className="mg-btn mg-btn-primary flex-1 !min-h-11"
            >
              <Check className="h-4 w-4" aria-hidden="true" /> {busy ? 'Joining…' : 'Confirm'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="mg-btn mg-btn-secondary !min-h-11">Cancel</button>
          </div>
          <p className="rf-note !p-0">
            {isDemo
              ? 'This is a demo event. After you confirm, you will see a test payment page. No money is taken.'
              : 'Paid entries stay pending until the organiser confirms payment.'}
          </p>
        </div>
      )}
      {err && <p role="alert" className="m-0 text-sm font-semibold text-[rgb(var(--mg-elim))]">{err}</p>}
      {done && (
        <p role="status" className="m-0 flex items-center gap-1 text-sm font-semibold text-[rgb(var(--mg-ok))]">
          <Check className="h-4 w-4" aria-hidden="true" /> {done}
        </p>
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
              <SignupRow key={s.id} signup={s} isDemo={isDemo} onChanged={onChanged} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SignupRow({ signup, isDemo, onChanged }: { signup: SectionSignup; isDemo: boolean; onChanged: () => void }) {
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
        <span className="rf-t2 truncate">
          {signup.contactEmail ? `${signup.contactEmail} · ` : ''}{confirmationEmailLabel(signup.confirmationEmailStatus, !!signup.contactEmail)}
        </span>
      </span>
      <RefineStatus tone={status.tone}>{isDemo && signup.amountMinor > 0 && signup.status !== 0 ? `${status.label} (test)` : status.label}</RefineStatus>
      {/* Demo entries are paid through the test payment page only; the server refuses manual changes. */}
      {!isDemo && signup.status !== 1 && signup.status !== 3 && (
        <button type="button" onClick={() => setStatus(1)} className="mg-icon-btn" title="Mark paid" aria-label={`Mark ${signup.fullName} paid`}>
          <Check className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {!isDemo && signup.status === 1 && (
        <button type="button" onClick={() => setStatus(2)} className="mg-icon-btn" title="Mark refunded" aria-label={`Mark ${signup.fullName} refunded`}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {!isDemo && signup.status !== 3 && (
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
