import { useEffect, useState, type ReactNode } from 'react';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { Link } from 'react-router-dom';
import { ChevronRight, ClipboardList, QrCode as QrCodeIcon, Sparkles, Users } from 'lucide-react';
import { useCompetition } from './context';
import { EntryManagement } from './EntryManagement';
import { useEntrySettings } from './entrySettings';
import { competitionDateText } from '../../lib/competitionDates';
import { competitionCalendarUrl, competitionLink } from '../../lib/sharing';
import { QrCode } from '../../components/QrCode';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { CompetitionTeamCard } from './CompetitionTeamCard';
import { EmbedCard } from './EmbedCard';
import { ScorerLinksCard } from './ScorerLinksCard';
import { EventSponsorsSection } from './SponsorsCard';
import { usePageWidth } from '../../components/pageWidthState';
import type { CompetitionDetail, CompetitionSection, EquipmentLine, SectionSignup } from '../../types';
import { feesLine, sectionFull } from '../../lib/entryOptions';
import '../../components/sitePages.css';
import '../../components/eventPages.css';
import { usePageHeader } from '../../components/CompactPageBarContext';

/** A row in a flat list: the label and a chevron. Goes to a page, or to a file or address when `href` is used. */
function LinkRow({ to, href, label }: { to?: string; href?: string; label: string }) {
  const inner = (
    <>
      <span className="sp-grow"><span className="sp-t1 !font-medium">{label}</span></span>
      <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
    </>
  );
  return to ? <Link className="sp-row" to={to}>{inner}</Link> : <a className="sp-row" href={href}>{inner}</a>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="sp-fact"><dt>{label}</dt><dd className="break-words">{children}</dd></div>;
}

/** Where the venue is on a map: the organiser's own link, or a search for the pin when only its position is known. */
function mapsUrl(competition: CompetitionDetail): string | null {
  if (competition.appleMapsUrl) return competition.appleMapsUrl;
  if (competition.latitude != null && competition.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${competition.latitude},${competition.longitude}`;
  }
  return null;
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
  const entrySettings = useEntrySettings(competition);

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

  const longDescription = (competition.description?.length ?? 0) > 140;
  const dates = competitionDateText(competition.startDate, competition.endDate, true);
  const where = mapsUrl(competition);
  const w3w = competition.what3Words?.replace(/^\/\/\//, '');
  const enterLabel = !user ? 'Sign in to enter' : competition.sections.some((s) => s.format === 2) ? 'Enter a team' : 'Enter';
  const enterTo = `/competitions/${competition.id}/enter`;
  const closed = entrySettings.closed && !mayOrganise;

  return (
    <div className="ev-white rf-page mx-auto flex w-full max-w-xl flex-col pb-4 pt-3 lg:max-w-3xl">
      <h1 className="sr-only">Details &amp; entries</h1>

      <div className="flex flex-col gap-1 pb-3">
        <h2 className="ev-title">{competition.name}</h2>
        <span className="ev-sub">{[dates, competition.location].filter(Boolean).join(' · ')}</span>
      </div>
      {competition.description && (
        <div>
          <p className={`ev-body whitespace-pre-wrap ${longDescription && !descOpen ? 'line-clamp-2' : ''}`}>{competition.description}</p>
          {longDescription && (
            <button type="button" className="ev-text-btn" aria-expanded={descOpen} onClick={() => setDescOpen((open) => !open)}>
              {descOpen ? 'Less' : 'More'}
            </button>
          )}
        </div>
      )}

      <dl className="sp-facts ev-flat ev-facts mt-3" aria-label="Event facts">
        {competition.location && (
          <Fact label="Venue">{competition.location}{where && <> <a className="ev-link whitespace-nowrap" href={where} target="_blank" rel="noreferrer">Open in Maps</a></>}</Fact>
        )}
        {competition.postcode && <Fact label="Postcode">{competition.postcode}</Fact>}
        {w3w && (
          <Fact label="what3words">
            <a className="font-semibold text-[rgb(var(--mg-heading))] hover:underline" href={`https://what3words.com/${w3w}`} target="_blank" rel="noreferrer">{`///${w3w}`}</a>
          </Fact>
        )}
        {competition.competitionNumber && <Fact label="Comp no.">{competition.competitionNumber}</Fact>}
        {competition.contactEmail && (
          <Fact label="Email"><a className="font-semibold text-[rgb(var(--mg-heading))] hover:underline" href={`mailto:${competition.contactEmail}`}>{competition.contactEmail}</a></Fact>
        )}
      </dl>

      <h2 className="sp-sec">At the event</h2>
      <div className="ev-flat" role="list" aria-label="At the event">
        <LinkRow to="../teams" label="Teams" />
        <LinkRow to="../declarations" label="Dec forms" />
        <LinkRow to="../shop" label="Event shop" />
        <LinkRow to="../shop" label="Book stabling, hook-up and shavings" />
        <LinkRow to="../rulebooks" label="Rules" />
        <LinkRow to="../arena" label="Arena setup and race diagrams" />
        <LinkRow to="../weather" label="Weather" />
        <LinkRow to="../contact" label="Message the organisers" />
      </div>
      {user && <EquipmentBlock competitionId={competition.id} />}

      <h2 className="sp-sec">Share and print</h2>
      <div className="ev-flat" role="list" aria-label="Share and print">
        <LinkRow href={competitionCalendarUrl(competition.id, window.location.origin)} label="Add to calendar" />
        <EventShareRows competitionId={competition.id} competitionName={competition.name} />
        <LinkRow to={`/event-tools/${competition.id}/print/draw`} label="Print draw" />
        <LinkRow to={`/event-tools/${competition.id}/print/results`} label="Print results" />
        {mayOrganise && <LinkRow to={`/event-tools/${competition.id}/print/poster`} label="Print venue poster" />}
      </div>

      <EventSponsorsSection />

      {competition.sections.length > 0 && (
        <>
          <h2 className="sp-sec">Enter</h2>
          <div className="ev-flat" role="list" aria-label="Age groups and fees">
            {competition.sections.map((section) => (
              <div key={section.id} className="sp-row" role="listitem">
                <span className="sp-grow"><span className="sp-t1">{section.displayName}</span></span>
                <span className="sp-t2 !text-[15px] text-right">{feesLine(section, sectionFull(section))}</span>
              </div>
            ))}
          </div>
          {competition.sections.map((section) => <MatchmakingBoard key={section.id} competitionId={competition.id} section={section} />)}
          {closed ? (
            <Notice tone="info" className="mx-4 mt-3">Entries are closed for this competition.</Notice>
          ) : (
            <Link to={user ? enterTo : '/login'} state={user ? undefined : { from: enterTo }} className="ev-bar">{enterLabel}</Link>
          )}
        </>
      )}

      {mayOrganise && (
        <div className="mt-6 flex flex-col gap-3">
          <h2 className="sp-sec !mt-0">Organiser</h2>
          <div className="ev-flat" role="list" aria-label="Organiser pages">
            <LinkRow to={`/competitions/${competition.id}/operations`} label="Manage entries and equipment" />
            <LinkRow to="../shop/manage" label="Manage event shop" />
            <LinkRow to="../operations" label="Operations, draw and tools" />
          </div>
          {competition.sections.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Link to={`/admin/competitions/${competition.id}/format`} className="sp-pill" title="Form teams and heats from paid entries">
                <Sparkles className="h-4 w-4" aria-hidden="true" /> Format competition
              </Link>
              <Link to={`/admin/competitions/${competition.id}/format#fm-dec`} className="sp-pill" title="Choose what the dec form asks for, such as weight or your own questions">
                <ClipboardList className="h-4 w-4" aria-hidden="true" /> Dec form setup
              </Link>
              <a href="#scorer-links" className="sp-pill"><QrCodeIcon className="h-4 w-4" aria-hidden="true" /> Scorer QR codes</a>
              <Link to="../broadcast" className="sp-pill">Go live &amp; stream</Link>
            </div>
          )}
          {competition.sections.length > 0 && (
            <EntryManagement key={competition.id} competition={competition} signups={allSignups} entriesCloseAt={entrySettings.entriesCloseAt} onChanged={() => { void refreshSignups(); reload(); }} />
          )}
        </div>
      )}

      {/* The owner, competition admins and site admins see who runs the event and can change it. */}
      {user && (mayOrganise || hasRole('Admin')) && (
        <div className="mt-4 flex flex-col gap-3">
          <CompetitionTeamCard competitionId={competition.id} competitionName={competition.name} canWrite={canManage(competition)} />
          <ScorerLinksCard competitionId={competition.id} canWrite={canManage(competition)} />
        </div>
      )}

      {/* Owner, competition admins and site admins can put live results on their own website. */}
      {mayOrganise && <div className="mt-4"><EmbedCard kind="competition" competitionId={competition.id} name={competition.name} sections={competition.sections} /></div>}
    </div>
  );
}

/**
 * Share event link (native share sheet or clipboard) and inline QR code toggle, used on both DetailsTab and EntryPage.
 */
export function EventShareRows({ competitionId, competitionName }: { competitionId: number; competitionName: string }) {
  const toast = useToast();
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
      toast.show('Link copied');
    } catch {
      setShareError(true);
    }
  }

  return (
    <>
      <div>
        <button type="button" className="sp-row" onClick={() => { void shareEvent(); }}>
          <span className="sp-grow"><span className="sp-t1 !font-medium">Share event link</span></span>
          <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
        </button>
        {shareError && (
          <Notice className="mx-4 my-2">
            Couldn’t copy the link. Press and hold <a className="ev-link" href={shareUrl}>the event link</a> to copy it, or show the QR code.
          </Notice>
        )}
        {toast.node}
      </div>
      <div>
        <button type="button" className="sp-row" aria-expanded={showQr} onClick={() => setShowQr((open) => !open)}>
          <span className="sp-grow"><span className="sp-t1 !font-medium">Show event QR code</span></span>
          <ChevronRight aria-hidden="true" className={`sp-chev h-4 w-4 transition-transform ${showQr ? 'rotate-90' : ''}`} strokeWidth={2.5} />
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
      </div>
    </>
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
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
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
    setBusy(true); setFailed(false);
    try { await api.post(`/my/signups/${own.id}/pair-request`, { targetSignupId }); toast.show('Pair-up request sent'); }
    catch { setFailed(true); }
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
      {failed && <Notice>Couldn’t send the pair-up request. Check your signal and try again.</Notice>}
      {toast.node}
    </div>
  ) : null;
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
    <div className="ev-flat border-t border-[rgb(var(--mg-rule-soft))]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="sp-row">
        <span className="sp-grow"><span className="sp-t1 !font-medium">Equipment required</span></span>
        <ChevronRight aria-hidden="true" className={`sp-chev h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} strokeWidth={2.5} />
      </button>
      {open && (
        loadError ? (
          <Notice className="mx-4 my-2" actionLabel="Try again" onAction={() => setLoadError(false)}>Couldn’t load the equipment. Check your signal and try again.</Notice>
        ) : data == null ? (
          <p className="sp-note !mx-4">Loading…</p>
        ) : data.lines.length === 0 ? (
          <p className="sp-note !mx-4 italic">No races set up yet, so nothing to count.</p>
        ) : (
          <div className="flex flex-col gap-3 px-4 py-3">
            <p className="sp-note !m-0">
              Sized for the biggest heat. {data.sessions} session{data.sessions === 1 ? '' : 's'} · {data.racesCounted} unique race{data.racesCounted === 1 ? '' : 's'} counted
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
  );
}
