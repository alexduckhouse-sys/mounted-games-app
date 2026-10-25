import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  CalendarDays, MapPin, MapPinned, Info, Layers, Users, Trophy,
  Hammer, Check, ChevronDown, ChevronUp, Sparkles,
  CalendarPlus, ClipboardList, Share2, QrCode as QrCodeIcon,
} from 'lucide-react';
import { useCompetition } from './context';
import { EntryManagement, type ExtendedSectionSignup } from './EntryManagement';
import { useEntrySettings } from './entrySettings';
import { competitionDateText } from '../../lib/competitionDates';
import { entryPhaseOnly } from '../../lib/competitionPhase';
import { competitionCalendarUrl, competitionLink } from '../../lib/sharing';
import { NumberField } from '../../components/NumberField';
import { QrCode } from '../../components/QrCode';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { CompetitionTeamCard } from './CompetitionTeamCard';
import { EmbedCard } from './EmbedCard';
import { ScorerLinksCard } from './ScorerLinksCard';
import { EventSponsorsSection } from './SponsorsCard';
import { usePageWidth } from '../../components/pageWidthState';
import { RiderPrivacyFields, type RiderPrivacy } from '../../components/RiderPrivacyFields';
import { CONSENT_VERSION } from '../../lib/termsTick';
import { EntryEmailFields, type EntryEmail } from '../../components/EntryEmailFields';
import { EMAIL_OPT_IN_VERSION, looksLikeEmail, newRequestId } from '../../lib/emailOptIn';
import type { CompetitionDetail, CompetitionSection, EquipmentLine, SectionSignup } from '../../types';
import { Chevron, RefineList, RefineSection } from '../refine/Refine';
import { usePageHeader } from '../../components/CompactPageBarContext';

function priceLabel(minor?: number | null): string {
  if (!minor) return 'Free';
  return `£${(minor / 100).toFixed(2)}`;
}

export function DetailsTab() {
  usePageWidth('wide');
  const { competition, reload } = useCompetition();
  const { canManage, canOrganise, hasRole, user } = useAuth();
  const [signupResult, setSignupResult] = useState<{ key: string; items: SectionSignup[] } | null>(null);
  const signupKey = `${competition.id}:${user?.id ?? ''}`;
  const mayOrganise = canOrganise(competition);
  const allSignups = mayOrganise && signupResult?.key === signupKey ? signupResult.items : [];
  const [descOpen, setDescOpen] = useState(false);

  usePageHeader({ title: 'Details', subtitle: `${competition.name}${competitionDateText(competition.startDate, competition.endDate) ? ` · ${competitionDateText(competition.startDate, competition.endDate)}` : ''}` });

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

  const infoRow = (icon: ReactNode, label: string, value: ReactNode) => (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-[rgb(var(--mg-heading))]" aria-hidden="true">{icon}</span>
      <div className="flex flex-col gap-0.5"><dt className="rf-t2 !font-bold uppercase tracking-[0.08em]">{label}</dt><dd className="m-0 break-words text-[15px]">{value}</dd></div>
    </div>
  );
  const linkRow = (to: string, label: string) => (
    <li key={label}><Link className="rf-row" to={to}><span className="rf-grow rf-t1">{label}</span><Chevron /></Link></li>
  );

  const longDescription = (competition.description?.length ?? 0) > 140;

  return (
    <div className="rf-page mx-auto flex w-full max-w-3xl flex-col gap-3 pb-4 pt-3 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start lg:gap-6">
      <h1 className="sr-only">Details &amp; entries</h1>

      <div className="flex min-w-0 flex-col gap-2.5">
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
          <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
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

        <EnterCompetition competition={competition} allSignups={allSignups} mayOrganise={mayOrganise} onChanged={() => { refreshSignups(); reload(); }} />

        <EventSponsorsSection />

        {user && <EquipmentBlock competitionId={competition.id} />}
      </div>

      <div className="flex min-w-0 flex-col gap-2.5">
        <RefineSection title="Event links" />
        <RefineList label="Event links">
          {linkRow('../teams', 'Teams')}
          {linkRow('../declarations', 'Dec forms')}
          {linkRow('../shop', 'Event shop')}
          {linkRow('../shop', 'Book stabling, hook-up & shavings')}
          {linkRow('../rulebooks', 'Rulebooks & game rules')}
          {linkRow('../arena', 'Arena setup & race diagrams')}
          <li>
            <a className="rf-row" href={competitionCalendarUrl(competition.id, window.location.origin)}>
              <span className="rf-grow rf-t1">Add to calendar</span>
              <CalendarPlus className="h-5 w-5 rf-chev" aria-hidden="true" />
            </a>
          </li>
          <EventShareRows competitionId={competition.id} competitionName={competition.name} />
          {linkRow(`/event-tools/${competition.id}/print/draw`, 'Print draw')}
          {linkRow(`/event-tools/${competition.id}/print/results`, 'Print results')}
          {mayOrganise && linkRow(`/event-tools/${competition.id}/print/poster`, 'Print venue poster')}
          {mayOrganise && linkRow('../shop/manage', 'Manage event shop')}
          {mayOrganise && linkRow('../operations', 'Operations, draw & tools')}
        </RefineList>

        {/* Entry controls (co-organisers and admins): jump to the format wizard and dec form setup. */}
        {mayOrganise && competition.sections.length > 0 && (
          <>
            <RefineSection title="Organiser tools" />
            <div className="rf-list flex flex-col gap-2 p-3">
              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/admin/competitions/${competition.id}/format`}
                  className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-[15px]"
                  title="Form teams and heats from paid entries"
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" /> Format competition
                </Link>
                <Link
                  to={`/admin/competitions/${competition.id}/format#fm-dec`}
                  className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-[15px]"
                  title="Choose what the dec form asks for, such as weight or your own questions"
                >
                  <ClipboardList className="h-4 w-4" aria-hidden="true" /> Dec form setup
                </Link>
                <a href="#scorer-links" className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-[15px]">
                  <QrCodeIcon className="h-4 w-4" aria-hidden="true" /> Scorer QR codes
                </a>
                <Link to="../broadcast" className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-[15px]">
                  Go live &amp; stream
                </Link>
              </div>
            </div>
          </>
        )}

        {/* The owner, competition admins and site admins see who runs the event and can change it. */}
        {user && (mayOrganise || hasRole('Admin')) && (
          <CompetitionTeamCard competitionId={competition.id} canWrite={canManage(competition)} />
        )}
        {user && (mayOrganise || hasRole('Admin')) && (
          <ScorerLinksCard competitionId={competition.id} canWrite={canManage(competition)} />
        )}

        {/* Owner, competition admins and site admins can put live results on their own website. */}
        {mayOrganise && <EmbedCard kind="competition" competitionId={competition.id} name={competition.name} sections={competition.sections} />}
      </div>
    </div>
  );
}

/**
 * Share event link (native share sheet or clipboard) and inline QR code toggle, used on both DetailsTab and EntryPage.
 */
export function EventShareRows({ competitionId, competitionName }: { competitionId: number; competitionName: string }) {
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const shareUrl = competitionLink(competitionId, window.location.origin);

  async function shareEvent() {
    setShareError(false);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: competitionName, url: shareUrl });
        return;
      } catch (error) {
        if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return;
        // A failed share can still be copied on browsers with clipboard access.
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareError(true);
    }
  }

  return (
    <>
      <li>
        <button type="button" className="rf-row" onClick={() => { void shareEvent(); }}>
          <span className="rf-grow rf-t1">{copied ? 'Link copied' : 'Share event link'}</span>
          {copied
            ? <Check className="h-5 w-5 text-[rgb(var(--mg-ok))]" aria-hidden="true" />
            : <Share2 className="h-5 w-5 rf-chev" aria-hidden="true" />}
        </button>
        {shareError && (
          <p className="rf-note" role="alert">
            Couldn’t copy the link. Press and hold <a href={shareUrl}>the event link</a> to copy it, or show the QR code below.
          </p>
        )}
      </li>
      <li>
        <button
          type="button"
          className="rf-row"
          aria-expanded={showQr}
          onClick={() => setShowQr((open) => !open)}
        >
          <span className="rf-grow rf-t1">Show event QR code</span>
          <QrCodeIcon className="h-5 w-5 rf-chev" aria-hidden="true" />
        </button>
        {showQr && (
          <div className="flex items-center gap-3 border-t border-[rgb(var(--mg-rule-soft))] px-4 py-3">
            <QrCode
              value={shareUrl}
              label={`QR code for ${competitionName}`}
              className="w-36 rounded-lg border border-[rgb(var(--mg-rule))] bg-white p-2"
            />
            <p className="m-0 text-xs text-[rgb(var(--mg-muted))]">
              Point another phone’s camera here to open {competitionName}.
            </p>
          </div>
        )}
      </li>
    </>
  );
}

/**
 * The per-section entry cards: Join, Sign in to enter, Full or Entries closed. Shown on the Details tab and as the
 * main content of the entry page. Anyone can see it; signing in is asked for only when they press the button.
 */
export function EnterCompetition({ competition, allSignups = [], mayOrganise, onChanged }: {
  competition: CompetitionDetail;
  allSignups?: SectionSignup[];
  mayOrganise: boolean;
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const entrySettings = useEntrySettings(competition);
  if (competition.sections.length === 0) return null;
  return (
    <>
      <RefineSection title="Enter the competition" meta={user && competition.paymentDestination ? <>Pay to <span className="font-mono">{competition.paymentDestination}</span></> : undefined} />
      {mayOrganise && (
        <RefineList label="Organiser entry tools">
          <li>
            <Link className="rf-row" to={`/competitions/${competition.id}/operations`}>
              <span className="rf-grow rf-t1">Manage entries &amp; equipment in Operations</span>
              <Chevron />
            </Link>
          </li>
        </RefineList>
      )}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {competition.sections.map((sec) => (
          <SectionSignupCard
            key={sec.id}
            competitionId={competition.id}
            section={sec}
            allSignups={allSignups}
            signupsLocked={entrySettings.closed && !mayOrganise}
            countsKnown={mayOrganise}
          />
        ))}
      </div>
      {mayOrganise && <EntryManagement key={competition.id} competition={competition} signups={allSignups} entriesCloseAt={entrySettings.entriesCloseAt} onChanged={onChanged} />}
    </>
  );
}

function SectionSignupCard({
  competitionId, section, allSignups, signupsLocked, countsKnown,
}: {
  competitionId: number;
  section: CompetitionSection;
  allSignups: SectionSignup[];
  signupsLocked: boolean;
  /** Only organisers receive the signup list, so places taken is only known to them. */
  countsKnown: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const signups = allSignups.filter((s) => s.competitionSectionId === section.id);
  // Paid and pending entries both take a seat (the API counts them the same way). Only organisers load the
  // signup list, so everyone else reads the count the API sends with the section.
  const takenSeats = allSignups.length > 0
    ? (signups as ExtendedSectionSignup[]).filter((s) => s.status < 2 && !s.waitingForGuestSpot && !s.isWaitlist && !s.isWithdrawn).reduce((sum, s) => sum + (s.teamsCount ?? 1), 0)
    : section.activeSignupsCount ?? 0;
  const known = countsKnown || section.activeSignupsCount != null;
  const max = section.maxParticipants;
  const seatsLeft = max ? Math.max(0, max - takenSeats) : null;
  const full = seatsLeft != null && seatsLeft === 0;

  const places = max ? Math.round((takenSeats / max) * 100) : 30;
  const scarce = seatsLeft != null && seatsLeft > 0 && seatsLeft <= 4;
  return (
    <div className="mg-card flex flex-col gap-1.5 p-3">
      <div className="flex items-baseline gap-1.5">
        <span className="mg-display flex-1 text-base font-bold uppercase leading-none tracking-[0.03em] text-[rgb(var(--mg-heading))]">{section.displayName}</span>
        <span className="mg-display text-base font-bold leading-none">{priceLabel(section.priceMinor)}</span>
      </div>
      {known && (
        <div className="h-1 overflow-hidden rounded-sm bg-[rgb(var(--mg-tint))]" aria-hidden="true">
          <div className={`h-full transition-[width] duration-200 ${full ? 'bg-[rgb(var(--mg-dash))]' : scarce ? 'bg-[rgb(var(--mg-late-time))]' : 'bg-[rgb(var(--mg-heading))]'}`} style={{ width: `${places}%` }} />
        </div>
      )}
      <span className={`text-xs font-medium ${scarce ? 'text-[rgb(var(--mg-late-ink))]' : 'text-[rgb(var(--mg-muted))]'}`}>
        {!known ? (max ? `Up to ${max} places` : 'No limit')
          : full ? 'Full' : max ? `${seatsLeft} of ${max} places left` : `${takenSeats} entered · no limit`}
        {known && <span className="sr-only">. {takenSeats} in{max ? `, ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left` : `, ${signups.length} signup${signups.length === 1 ? '' : 's'}`}</span>}
      </span>
      {section.format === 1 && (section.priceMinor ?? 0) > 0 && (
        <span className="text-xs font-semibold text-[rgb(var(--mg-heading))]">
          Solo rider? Enter Looking for a Pair Partner ({priceLabel(Math.floor((section.priceMinor ?? 0) / 2))} · 50% share)
        </span>
      )}
      {signupsLocked ? (
        <p className="rf-note !p-0 italic">Entries closed.</p>
      ) : full ? (
        <Link className="mg-btn mg-btn-secondary !min-h-11" to={`/competitions/${competitionId}/enter/${section.id}?waitlist=1`} state={{ from: location.pathname, isWaitlist: true }}>Join waiting list (Free)</Link>
      ) : !user ? (
        <Link to="/login" state={{ from: `/competitions/${competitionId}/enter` }} className="mg-btn mg-btn-primary w-full !min-h-11">Sign in to enter</Link>
      ) : (
        <button
          type="button"
          onClick={() => navigate(`/competitions/${competitionId}/enter/${section.id}`, { state: { from: location.pathname } })}
          className="mg-btn mg-btn-primary w-full !min-h-11"
        >
          <Trophy className="h-4 w-4" aria-hidden="true" /> Join {section.priceMinor ? `(${priceLabel(section.priceMinor)})` : ''}
        </button>
      )}
      {full && !signupsLocked && section.format === 2 && <Link className="mg-btn mg-btn-secondary !min-h-11" to={`/competitions/${competitionId}/enter/${section.id}`} state={{ from: location.pathname, waitingForGuestSpot: true }}>Wait for a Guest Ride Spot (Free)</Link>}
      <MatchmakingBoard competitionId={competitionId} section={section} />
    </div>
  );
}

interface MatchingEntry {
  signupId: number; competitionSectionId: number; fullName: string; ponyClubName?: string | null;
  teamName?: string | null; lookingForPair: boolean; lookingForGuestRiders: boolean;
  waitingForGuestSpot: boolean; teamId?: number | null;
}
interface MatchingSignup { id: number; competitionSectionId: number; teamId?: number | null; lookingForPair?: boolean; status: number }

function MatchmakingBoard({ competitionId, section }: { competitionId: number; section: CompetitionSection }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [entries, setEntries] = useState<MatchingEntry[]>([]);
  const [mine, setMine] = useState<MatchingSignup[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.get<MatchingEntry[]>(`/competitions/${competitionId}/matchmaking`).then(({ data }) => { if (!cancelled) setEntries(Array.isArray(data) ? data : []); }).catch(() => { if (!cancelled) setEntries([]); });
    if (userId) api.get<MatchingSignup[]>('/me/signups').then(({ data }) => { if (!cancelled) setMine(Array.isArray(data) ? data : []); }).catch(() => { if (!cancelled) setMine([]); });
    return () => { cancelled = true; };
  }, [competitionId, userId]);
  const seekers = entries.filter((e) => e.competitionSectionId === section.id);
  const own = user ? mine.find((e) => e.competitionSectionId === section.id && e.lookingForPair && !e.teamId && (e.status === 0 || e.status === 1)) : undefined;
  async function requestPair(targetSignupId: number) {
    if (!own || busy) return;
    setBusy(true); setNotice(null);
    try { await api.post(`/my/signups/${own.id}/pair-request`, { targetSignupId }); setNotice('Pair-up request sent.'); }
    catch { setNotice('Could not send the pair-up request. Check your entries and try again.'); }
    finally { setBusy(false); }
  }
  return seekers.length > 0 ? (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] p-2.5 text-sm">
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[rgb(var(--mg-heading))]">
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Pair Partner &amp; Guest Rider Matchmaker</span>
      </div>
      {seekers.filter((e) => e.lookingForPair && !e.teamId).map((e) => (
        <div key={e.signupId} className="flex flex-col gap-1.5 rounded border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-surface))] p-2">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="inline-flex items-center rounded bg-[rgb(var(--mg-tint))] px-2 py-0.5 text-[11px] font-bold text-[rgb(var(--mg-heading))]">
              Looking for a Pair Partner (50% share)
            </span>
            <span className="font-semibold text-[rgb(var(--mg-ink))]">
              {e.fullName}{e.ponyClubName ? ` · ${e.ponyClubName}` : ''}
            </span>
          </div>
          {own && own.id !== e.signupId && (
            <button type="button" className="mg-btn mg-btn-secondary !min-h-11" disabled={busy} onClick={() => void requestPair(e.signupId)}>
              Request pair-up with {e.fullName}
            </button>
          )}
        </div>
      ))}
      {seekers.filter((e) => e.lookingForGuestRiders).map((e) => (
        <div key={e.signupId} className="flex flex-wrap items-center justify-between gap-1.5 rounded border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-surface))] p-2">
          <span className="inline-flex items-center rounded bg-[rgb(var(--mg-tint))] px-2 py-0.5 text-[11px] font-bold text-[rgb(var(--mg-heading))]">
            Guest rider spot available
          </span>
          <span className="font-semibold text-[rgb(var(--mg-ink))]">
            {e.teamName || e.fullName}{e.ponyClubName ? ` · ${e.ponyClubName}` : ''}
          </span>
        </div>
      ))}
      {seekers.filter((e) => e.waitingForGuestSpot && !e.teamId).map((e) => (
        <div key={e.signupId} className="flex flex-wrap items-center justify-between gap-1.5 rounded border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-surface))] p-2">
          <span className="inline-flex items-center rounded bg-[rgb(var(--mg-tint))] px-2 py-0.5 text-[11px] font-bold text-[rgb(var(--mg-heading))]">
            Guest rider spot wanted
          </span>
          <span className="font-semibold text-[rgb(var(--mg-ink))]">
            {e.fullName}{e.ponyClubName ? ` · ${e.ponyClubName}` : ''}
          </span>
        </div>
      ))}
      {notice && <p role="status" className="m-0 text-xs font-semibold text-[rgb(var(--mg-ok))]">{notice}</p>}
    </div>
  ) : null;
}

/**
 * Dedicated page for filling in a competition section entry (`/competitions/:id/enter/:sectionId`).
 */
export function SectionEntryPage() {
  usePageWidth('wide');
  const { sectionId } = useParams<{ sectionId: string }>();
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  const location = useLocation();

  const section = competition.sections.find((s) => s.id === Number(sectionId)) ?? null;
  const fromState = (location.state as { from?: string } | null)?.from;
  const backTarget = fromState && fromState.startsWith('/competitions/')
    ? fromState
    : Array.isArray(competition.sessions) && entryPhaseOnly(competition, canOrganise(competition))
      ? `/competitions/${competition.id}`
      : `/competitions/${competition.id}/details`;

  usePageHeader({
    title: section ? `Enter ${section.displayName}` : 'Enter competition',
    subtitle: competition.name,
    plain: true,
    backTo: backTarget,
    backLabel: 'Back to competition',
  });

  if (!section) {
    return (
      <div className="rf-page mx-auto flex w-full max-w-2xl flex-col gap-3 pb-6 pt-3">
        <p role="alert" className="mg-notice">Section not found.</p>
      </div>
    );
  }

  return <SectionEntryForm key={`${competition.id}:${section.id}`} section={section} backTarget={backTarget} />;
}

function SectionEntryForm({ section, backTarget }: { section: CompetitionSection; backTarget: string }) {
  const { competition, reload } = useCompetition();
  const { user, hasRole, canOrganise } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [fullName, setFullName] = useState('');
  const [ponyClub, setPonyClub] = useState('');
  const [contact, setContact] = useState('');
  const [entryEmail, setEntryEmail] = useState<EntryEmail>({ email: '', optIn: false });
  // One id per attempt: if the connection drops and the form is sent again, the server returns the first entry.
  const requestId = useRef<string | null>(null);
  const [teamCode, setTeamCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [wholeTeam, setWholeTeam] = useState(false);
  const [teamsCount, setTeamsCount] = useState<number | ''>(1);
  const isWaitlist = new URLSearchParams(location.search).get('waitlist') === '1' || !!(location.state as { isWaitlist?: boolean } | null)?.isWaitlist;
  const [stablesCount, setStablesCount] = useState(0);
  const [stablingClubOrTeam, setStablingClubOrTeam] = useState('');
  const entrySettings = useEntrySettings(competition);
  const [lookingForPair, setLookingForPair] = useState(false);
  const [lookingForGuestRiders, setLookingForGuestRiders] = useState(false);
  const [waitingForGuestSpot, setWaitingForGuestSpot] = useState(section.format === 2 && !!(location.state as { waitingForGuestSpot?: boolean } | null)?.waitingForGuestSpot);
  const [privacy, setPrivacy] = useState<RiderPrivacy>({ useInitialOnly: false, noFilming: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canEnterWholeTeam = section.format === 2 && (hasRole('Manager') || hasRole('Trainer') || hasRole('Admin') || canOrganise(competition));
  const enteringWholeTeam = wholeTeam && canEnterWholeTeam;
  const guestWaiting = !isWaitlist && section.format === 2 && !enteringWholeTeam && waitingForGuestSpot;
  const pairSeeking = section.format === 1 && lookingForPair;
  const effectiveTeamsCount = enteringWholeTeam && teamsCount !== '' ? teamsCount : 1;
  const effectivePriceMinor = guestWaiting || isWaitlist ? 0 : pairSeeking ? Math.floor((section.priceMinor ?? 0) / 2) : (section.priceMinor ?? 0) * effectiveTeamsCount;
  const isDemo = !!competition.isDemo;
  const max = section.maxParticipants;
  const takenSeats = section.activeSignupsCount ?? 0;
  const seatsLeft = max != null && section.activeSignupsCount != null ? Math.max(0, max - takenSeats) : null;
  const full = seatsLeft === 0;

  async function submit() {
    if (!fullName.trim() || !privacy.agreed) return;
    const emailText = entryEmail.email.trim();
    if (emailText && !looksLikeEmail(emailText)) { setErr("That email address doesn't look right."); return; }
    requestId.current ??= newRequestId();
    setBusy(true);
    setErr(null);
    try {
      const { data: signup } = await api.post<SectionSignup>(`/competitions/${competition.id}/sections/${section.id}/signups`, {
        fullName: fullName.trim(),
        ponyClubName: ponyClub.trim() || null,
        contactInfo: contact.trim() || null,
        contactEmail: emailText || null,
        emailOptIn: !!emailText && entryEmail.optIn,
        emailOptInVersion: emailText && entryEmail.optIn ? EMAIL_OPT_IN_VERSION : null,
        requestId: requestId.current,
        teamCode: section.format === 3 || guestWaiting ? null : teamCode.trim() || null,
        teamName: section.format === 3 || guestWaiting ? null : teamName.trim() || (enteringWholeTeam && effectiveTeamsCount > 1 ? ponyClub.trim() : null) || null,
        lookingForPair: pairSeeking,
        lookingForGuestRiders: enteringWholeTeam && lookingForGuestRiders,
        waitingForGuestSpot: guestWaiting,
        wholeTeam: enteringWholeTeam,
        teamsCount: effectiveTeamsCount,
        isWaitlist,
        stablesCount: guestWaiting || isWaitlist ? 0 : stablesCount,
        stablingClubOrTeam: guestWaiting || isWaitlist ? null : stablingClubOrTeam.trim() || ponyClub.trim() || teamName.trim() || null,
        paymentMethod: effectivePriceMinor > 0 ? (competition.isDemo ? 'card' : 'bacs') : null,
        useInitialOnly: privacy.useInitialOnly,
        noFilming: privacy.noFilming,
        acceptTerms: privacy.agreed,
        consentVersion: CONSENT_VERSION,
      });
      setFullName(''); setPonyClub(''); setContact(''); setTeamCode(''); setTeamName(''); setWholeTeam(false); setLookingForPair(false); setLookingForGuestRiders(false); setWaitingForGuestSpot(false);
      setEntryEmail({ email: '', optIn: false });
      requestId.current = null;
      setPrivacy({ useInitialOnly: false, noFilming: false });
      setDone((isWaitlist ? 'You are on the waiting list. The organiser will contact you if a space opens up.' : signup.status === 1 ? 'Your entry is confirmed.' : 'Your entry is saved. Payment is still due.')
        + (signup.confirmationEmailStatus === 1 ? ' We have emailed you a confirmation.'
          : signup.confirmationEmailStatus === 2 ? " We couldn't send the confirmation email, but your entry is saved." : ''));
      reload();
      // Demo events only: straight on to the clearly labelled test payment page.
      if (isDemo && signup.status === 0 && signup.amountMinor > 0) navigate(`/me/signups/${signup.id}/test-payment`);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setErr(typeof msg === 'string' ? msg : msg?.message ?? 'Could not sign up.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rf-page mx-auto flex w-full max-w-2xl flex-col gap-3 pb-6 pt-3">
      <div className="mg-card flex flex-col gap-2.5 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="mg-meta m-0 font-semibold uppercase tracking-[0.06em]">{competition.name}</p>
            <h1 className="mg-display mt-1 text-2xl font-bold leading-[1.1] text-[rgb(var(--mg-heading))]">
              Enter {section.displayName}
            </h1>
          </div>
          <span className="mg-display text-xl font-bold text-[rgb(var(--mg-heading))]">{priceLabel(effectivePriceMinor)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-[rgb(var(--mg-muted))]">
          <span>
            {seatsLeft != null ? `${seatsLeft} of ${max} places left` : max ? `Up to ${max} places` : 'No limit'}
          </span>
          {user && competition.paymentDestination && !isDemo && (section.priceMinor ?? 0) > 0 && (
            <span>Pay to <span className="font-mono font-semibold text-[rgb(var(--mg-ink))]">{competition.paymentDestination}</span></span>
          )}
        </div>
      </div>

      {entrySettings.closed && !canOrganise(competition) && !done ? (
        <p role="status" className="mg-notice">Entries are closed for this competition.</p>
      ) : full && !guestWaiting && !isWaitlist && !done ? (
        <p role="status" className="mg-notice">This section is full.</p>
      ) : !user ? (
        <div className="mg-card flex flex-col gap-3 p-4 sm:p-5">
          <p className="m-0 text-sm text-[rgb(var(--mg-body))]">Sign in to enter this section.</p>
          <Link to="/login" state={{ from: `/competitions/${competition.id}/enter/${section.id}${location.search}` }} className="mg-btn mg-btn-primary w-full !min-h-11">
            Sign in to enter
          </Link>
        </div>
      ) : (
        <div className="mg-card flex flex-col gap-3.5 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="rf-fld">Your full name<input placeholder="Your full name" value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
            <label className="rf-fld">Pony Club<input placeholder="Pony Club (optional)" value={ponyClub} onChange={(e) => setPonyClub(e.target.value)} /></label>
          </div>
          <label className="rf-fld">Phone<input type="tel" autoComplete="tel" placeholder="Phone (optional)" value={contact} onChange={(e) => setContact(e.target.value)} /></label>
          <EntryEmailFields value={entryEmail} onChange={setEntryEmail} />
          {section.format === 1 && (
            <div className="flex flex-col gap-2 rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] p-3">
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={lookingForPair} onChange={(e) => setLookingForPair(e.target.checked)} />
                Looking for a Pair Partner (50% share — pay 50% deposit)
              </label>
              {pairSeeking && (
                <div className="flex flex-col gap-1 rounded border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] p-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center rounded bg-[rgb(var(--mg-tint))] px-2 py-0.5 font-bold text-[rgb(var(--mg-heading))]">
                      Looking for a Pair Partner (50% share)
                    </span>
                    <span className="font-bold text-[rgb(var(--mg-heading))]">
                      Your 50% individual share: {priceLabel(effectivePriceMinor)} <span className="font-normal text-[rgb(var(--mg-muted))]">(Full pair fee: {priceLabel(section.priceMinor ?? 0)})</span>
                    </span>
                  </div>
                  <p className="m-0 text-[rgb(var(--mg-body))]">
                    Enter solo at 50% of the pair fee. Your entry is listed on the Pair Partner Matchmaker so another solo rider can pair up with you.
                  </p>
                </div>
              )}
            </div>
          )}
          {section.format === 2 && !enteringWholeTeam && !isWaitlist && (
            <div className="flex flex-col gap-1.5">
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={waitingForGuestSpot} onChange={(e) => setWaitingForGuestSpot(e.target.checked)} />
                Wait for a Guest Ride Spot (Free)
              </label>
              {guestWaiting && (
                <p className="m-0 rounded border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] px-2.5 py-1.5 text-xs text-[rgb(var(--mg-body))]">
                  <strong className="text-[rgb(var(--mg-heading))]">Guest rider spot wanted:</strong> Free waiting list entry so teams looking for guest riders can invite you.
                </p>
              )}
            </div>
          )}
          {enteringWholeTeam && (
            <div className="flex flex-col gap-1.5">
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={lookingForGuestRiders} onChange={(e) => setLookingForGuestRiders(e.target.checked)} />
                Looking for Guest Riders
              </label>
              {lookingForGuestRiders && (
                <p className="m-0 rounded border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] px-2.5 py-1.5 text-xs text-[rgb(var(--mg-body))]">
                  <strong className="text-[rgb(var(--mg-heading))]">Guest rider spot available:</strong> Lists your team on the Matchmaker so solo riders waiting for a guest spot can join.
                </p>
              )}
            </div>
          )}
          {canEnterWholeTeam && (
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={wholeTeam} onChange={(e) => setWholeTeam(e.target.checked)} />
              Enter a whole team
            </label>
          )}
          {enteringWholeTeam && <label className="rf-fld">Number of teams<NumberField min={1} max={20} value={teamsCount} onChange={(e) => setTeamsCount(e.target.value === '' ? '' : Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>}
          {section.format !== 3 && !guestWaiting && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="rf-fld">{enteringWholeTeam ? 'Team name' : 'Team name (optional)'}
              <input placeholder={enteringWholeTeam ? 'e.g. Welsh Dragons' : 'Riders with the same team name are put together'} value={teamName} onChange={(e) => setTeamName(e.target.value)} />
            </label>
            <label className="rf-fld">Team code
              <input
                className="font-mono uppercase"
                placeholder="Team code (optional), e.g. STOCKPORT-A"
                value={teamCode}
                onChange={(e) => setTeamCode(e.target.value)}
              />
            </label>
          </div>}
          {section.format !== 3 && !guestWaiting && <p className="-mt-1 text-xs text-[rgb(var(--mg-muted))]">The team name carries through to your team’s dec form, so organisers can match the two up.</p>}
          {!guestWaiting && !isWaitlist && <fieldset className="flex flex-col gap-2"><legend className="font-semibold">Stabling (optional)</legend>
            <label className="rf-fld">Number of stables<NumberField min={0} max={100} value={stablesCount} onChange={(e) => setStablesCount(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} /></label>
            {stablesCount > 0 && <label className="rf-fld">Stabling club or team<input value={stablingClubOrTeam} maxLength={200} onChange={(e) => setStablingClubOrTeam(e.target.value)} placeholder="Use your club or team name" /></label>}
            <p className="m-0 text-xs text-[rgb(var(--mg-muted))]">
              Need electric hook-up, shavings or haylage bales? <Link to={`/competitions/${competition.id}/shop`} className="font-semibold text-[rgb(var(--mg-heading))] hover:underline">Book in the Event Shop →</Link>
            </p>
          </fieldset>}
          {effectivePriceMinor > 0 && !isDemo && <div className="mg-notice"><strong>Pay by Bank Transfer (BACS)</strong><p>Transfer {priceLabel(effectivePriceMinor)} {competition.paymentDestination ? `to ${competition.paymentDestination}` : 'using the organiser’s payment details'}. Use your name or team name as the reference. The organiser confirms when payment arrives.</p></div>}
          <RiderPrivacyFields termsText={competition.termsText} value={privacy} onChange={(patch) => setPrivacy((cur) => ({ ...cur, ...patch }))} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !fullName.trim() || !privacy.agreed || (enteringWholeTeam && !teamName.trim() && (effectiveTeamsCount === 1 || !ponyClub.trim()))}
              className="mg-btn mg-btn-primary flex-1 !min-h-11"
            >
              <Check className="h-4 w-4" aria-hidden="true" /> {busy ? 'Joining…' : 'Confirm'}
            </button>
            <button type="button" onClick={() => navigate(backTarget)} className="mg-btn mg-btn-secondary !min-h-11">Cancel</button>
          </div>
          <p className="rf-note !p-0">
            {isDemo
              ? 'This is a demo event. After you confirm, you will see a test payment page. No money is taken.'
              : 'Paid entries stay pending until the organiser confirms payment.'}
          </p>
          {err && <p role="alert" className="m-0 text-sm font-semibold text-[rgb(var(--mg-elim))]">{err}</p>}
          {done && (
            <p role="status" className="m-0 flex items-center gap-1 text-sm font-semibold text-[rgb(var(--mg-ok))]">
              <Check className="h-4 w-4" aria-hidden="true" /> {done}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EquipmentBlock({ competitionId }: { competitionId: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ lines: EquipmentLine[]; sessions: number; racesCounted: number } | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!open || data || loadError) return;
    api.get<{ lines: EquipmentLine[]; sessions: number; racesCounted: number }>(`/competitions/${competitionId}/equipment`)
      .then((r) => setData(r.data))
      .catch(() => setLoadError(true));
  }, [open, competitionId, data, loadError]);

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
            <span className="rf-t2">Sized for the biggest heat across all sessions</span>
          </span>
          {open ? <ChevronUp className="h-4 w-4 rf-chev" aria-hidden="true" /> : <ChevronDown className="h-4 w-4 rf-chev" aria-hidden="true" />}
        </button>
        {open && (
          loadError ? (
            <p role="alert" className="rf-note px-4">Could not load equipment.</p>
          ) : data == null ? (
            <p className="rf-note px-4">Loading…</p>
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
                  <ul className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-1 p-0 text-sm sm:grid-cols-2 md:grid-cols-3">
                    {byBucket.get(b)!.sort((a, b2) => a.kind.localeCompare(b2.kind)).map((l) => (
                      <li key={`${b}-${l.kind}`} className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate">{l.kind}</span>
                        <span className="shrink-0 font-mono font-bold tabular-nums">×{l.count}</span>
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
