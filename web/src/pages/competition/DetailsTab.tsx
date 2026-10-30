import { useEffect, useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, ClipboardList, ExternalLink, QrCode as QrCodeIcon, Sparkles } from 'lucide-react';
import { useStillMotion } from '../../lite/useStillMotion';
import { activeLocale } from '../../i18n/translate';
import { eventDetailRows, type DetailRow } from './eventDetailRows';
import { useCompetition } from './context';
import { EntryManagement } from './EntryManagement';
import { useEntrySettings } from './entrySettings';
import { competitionDateText, hasEnded } from '../../lib/competitionDates';
import { competitionCalendarUrl, competitionLink } from '../../lib/sharing';
import { QrCode } from '../../components/QrCode';
import { Sheet } from '../../components/Sheet';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { CompetitionTeamCard } from './CompetitionTeamCard';
import { EmbedCard } from './EmbedCard';
import { HorseboxEntranceCard } from './HorseboxEntranceCard';
import { horseboxEntrance } from '../operations/lorryEntrance';
import { ScorerLinksCard } from './ScorerLinksCard';
import { useStoryImage } from './StoryImage';
import { EventSponsorsSection } from './SponsorsCard';
import { usePageWidth } from '../../components/pageWidthState';
import type { CompetitionDetail, CompetitionSection, EquipmentLine, SectionSignup } from '../../types';
import { entryPhaseOnly } from '../../lib/competitionPhase';
import { feesLine, sectionFull } from '../../lib/entryOptions';
import { placesLeftText } from '../../lib/placesLeft';
import '../../components/sitePages.css';
import '../../components/eventPages.css';
import './details.css';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { useT } from '../../i18n/LanguageContext';

/** A row in a flat list: the label and a chevron. Goes to a page, or to a file or address when `href` is used. */
function LinkRow({ to, href, label }: { to?: string; href?: string; label: string }) {
  const inner = (
    <>
      <span className="sp-grow"><span className="sp-t1">{label}</span></span>
      <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
    </>
  );
  return to ? <Link className="sp-row" to={to}>{inner}</Link> : <a className="sp-row" href={href}>{inner}</a>;
}

/** One fact the organiser has set: its name above, the value under it. Links open the map, what3words or an email. */
function DetailLine({ row }: { row: DetailRow }) {
  const inner = (
    <>
      <span className="fl-grow">
        <span className="fl-sub">{row.label}</span>
        <span className={`fl-title ${row.href ? 'dt-fact-link' : ''}`}>{row.value}</span>
      </span>
      {row.href && <ExternalLink aria-hidden="true" className="fl-chev h-4 w-4" />}
    </>
  );
  return <li>
    {row.href
      ? <a className="fl-row" href={row.href} {...(row.href.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noreferrer' })}>{inner}</a>
      : <div className="fl-row">{inner}</div>}
  </li>;
}

/**
 * Under the event's intro, always there: one control that opens, in place, the whole description, how to get there
 * (the venue, postcode, what3words, then the horsebox gate as `children`) and every other fact the organiser has set.
 * With nothing more to show it says so rather than vanishing.
 */
function FullDetails({ open, onToggle, rows, summary, panelId, children }: { open: boolean; onToggle: () => void; rows: DetailRow[]; summary: string; panelId: string; children?: ReactNode }) {
  const t = useT();
  const still = useStillMotion();
  return (
    <div className="fl-list dt-facts">
      <button type="button" className="fl-row" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span className="fl-grow">
          <span className="fl-title dt-fact-link">{open ? t('competition.details.hideDetails') : t('competition.details.seeDetails')}</span>
          {!open && summary && <span className="fl-sub">{summary}</span>}
        </span>
        <ChevronDown aria-hidden="true" className={`fl-chev h-5 w-5 transition-transform duration-200 motion-reduce:transition-none [html[data-lite=true]_&]:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="details"
            id={panelId}
            initial={still ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={still ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {rows.length > 0 && <ul className="m-0 list-none p-0">{rows.map((row) => <DetailLine key={row.key} row={row} />)}</ul>}
            {children}
            {rows.length === 0 && !children && <p className="dt-nothing">{t('competition.details.nothingMore')}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DetailsTab() {
  usePageWidth('wide');
  const t = useT();
  const { competition, reload } = useCompetition();
  const { canManage, canOrganise, hasRole, user } = useAuth();
  const [signupResult, setSignupResult] = useState<{ key: string; items: SectionSignup[] } | null>(null);
  const signupKey = `${competition.id}:${user?.id ?? ''}`;
  const mayOrganise = canOrganise(competition);
  const allSignups = mayOrganise && signupResult?.key === signupKey ? signupResult.items : [];
  const [fullOpen, setFullOpen] = useState(false);
  const fullId = useId();
  const entrySettings = useEntrySettings(competition);

  usePageHeader({ title: t('competition.details.title'), subtitle: `${competition.name}${competitionDateText(competition.startDate, competition.endDate) ? ` · ${competitionDateText(competition.startDate, competition.endDate)}` : ''}` });

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
  const lower = (key: Parameters<typeof t>[0]) => t(key).toLocaleLowerCase(activeLocale());
  const detailRows = eventDetailRows(competition, {
    venue: t('competition.details.venue'), postcode: t('competition.details.postcode'), openMaps: t('competition.details.openMaps'),
    organiser: t('competition.details.organiser'), email: t('competition.details.email'), competitionNo: t('competition.details.compNo'),
    summary: {
      venue: lower('competition.details.venue'), postcode: lower('competition.details.postcode'), what3words: 'what3words',
      organiser: lower('competition.details.organiser'), email: lower('competition.details.email'), competitionNo: t('competition.details.compNoWords'),
    },
  });
  // Everything folds away under Show full details, how to get there first; the horsebox gate closes the panel.
  const hasHorsebox = horseboxEntrance(competition) !== null;
  // Times only when the organiser gave one: a date-only start or finish is already the date line above.
  const hasTime = (iso?: string | null): iso is string => !!iso && iso.includes('T') && !/T00:00(?::00(?:\.0+)?)?Z?$/i.test(iso) && !Number.isNaN(new Date(iso).getTime());
  const at = (iso: string) => new Date(iso).toLocaleString(activeLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const left = (count: number) => (count > 0 ? t('competition.details.left', { count }) : t('competition.details.noneLeft'));
  const fact = (key: DetailRow['key'], label: string, summaryName: string, value: string): DetailRow => ({ key, group: 'more', label, summaryName, value });
  const fullRows: DetailRow[] = [
    ...detailRows.filter((row) => row.group === 'arrival'),
    ...(hasTime(competition.startDate) ? [fact('starts', t('competition.details.starts'), t('competition.details.timesWords'), at(competition.startDate))] : []),
    ...(hasTime(competition.endDate) ? [fact('finishes', t('competition.details.finishes'), t('competition.details.timesWords'), at(competition.endDate))] : []),
    ...(!entrySettings.closed && hasTime(entrySettings.entriesCloseAt) ? [fact('entriesClose', t('competition.details.entriesClose'), t('competition.details.entriesCloseWords'), at(entrySettings.entriesCloseAt))] : []),
    ...(entrySettings.stablesRemaining != null ? [fact('stables', t('competition.details.stables'), t('competition.details.stablesWords'), left(entrySettings.stablesRemaining))] : []),
    ...(entrySettings.hookupsRemaining != null ? [fact('hookups', t('competition.details.hookups'), t('competition.details.hookupsWords'), left(entrySettings.hookupsRemaining))] : []),
    ...detailRows.filter((row) => row.group === 'more'),
  ];
  const fullSummary = (() => {
    const names = [...new Set([
      ...(longDescription ? [t('competition.details.descriptionWords')] : []),
      ...fullRows.map((row) => row.summaryName),
      ...(hasHorsebox ? [lower('competition.horsebox.heading')] : []),
    ])];
    if (names.length === 0) return '';
    const text = new Intl.ListFormat(activeLocale(), { style: 'long', type: 'conjunction' }).format(names);
    return text.charAt(0).toLocaleUpperCase(activeLocale()) + text.slice(1);
  })();
  // Dec forms are for the people who fill them in or run the event, not the public.
  const showDecForms = !!user && (mayOrganise || hasRole('Trainer') || hasRole('Admin'));
  const enterLabel = !user ? t('competition.details.signInToEnter') : competition.sections.some((s) => s.format === 2) ? t('competition.details.enterTeam') : t('competition.details.enter');
  const enterTo = `/competitions/${competition.id}/enter`;
  const closed = entrySettings.closed && !mayOrganise;
  const ended = !mayOrganise && hasEnded(competition.startDate, competition.endDate, new Date());
  // While entries are the only thing to do, the timetable, toplists and live scores aren't there yet; say so here, not on the entry steps.
  const awaitingDraw = Array.isArray(competition.sessions) && entryPhaseOnly(competition, mayOrganise);

  return (
    <div className="rf-page mg-flat dt mx-auto flex w-full max-w-xl flex-col pb-4 pt-3 lg:max-w-3xl">
      <h1 className="sr-only">{t('competition.details.heading')}</h1>

      {/* The event's name leads the page; one Show full details control opens the whole description and the rest. */}
      <section className="dt-intro" aria-label={t('competition.details.about')}>
        <h2 className="dt-name">{competition.name}</h2>
        {/* The venue is under Show full details, with its map, so it isn't repeated here. */}
        {dates && <p className="dt-meta">{dates}</p>}
        {competition.description && (
          <div className="dt-about">
            <p className={`dt-body whitespace-pre-wrap ${longDescription && !fullOpen ? 'line-clamp-3' : ''}`}>{competition.description}</p>
          </div>
        )}
        <FullDetails open={fullOpen} onToggle={() => setFullOpen((open) => !open)} rows={fullRows} summary={fullSummary} panelId={fullId}>
          {hasHorsebox && <HorseboxEntranceCard competition={competition} />}
        </FullDetails>
      </section>

      <h2 className="sp-sec fl-ruled">{t('competition.details.atEvent')}</h2>
      <div className="sp-card" role="list" aria-label={t('competition.details.atEvent')}>
        <LinkRow to="../teams" label={t('competition.details.teams')} />
        {showDecForms && <LinkRow to="../declarations" label={t('competition.details.decForms')} />}
        <LinkRow to="../shop" label={t('competition.details.shop')} />
        <LinkRow to="../rulebooks" label={t('competition.details.rules')} />
        <LinkRow to="../arena" label={t('competition.details.arena')} />
        {user && <LinkRow to="../volunteers" label={t('competition.details.volunteers')} />}
        {showDecForms && <LinkRow to="../arena-crew" label={t('competition.details.arenaCrew')} />}
        <LinkRow to="../weather" label={t('competition.details.weather')} />
        <LinkRow to="../contact" label={t('competition.details.contact')} />
        {user && <EquipmentBlock competitionId={competition.id} />}
      </div>

      <h2 className="sp-sec fl-ruled">{t('competition.details.sharePrint')}</h2>
      <div className="sp-card" role="list" aria-label={t('competition.details.sharePrint')}>
        <LinkRow href={competitionCalendarUrl(competition.id, window.location.origin)} label={t('competition.details.calendar')} />
        <EventShareRows competition={competition} />
        <LinkRow to={`/event-tools/${competition.id}/print/draw`} label={t('competition.details.printDraw')} />
        <LinkRow to={`/event-tools/${competition.id}/print/results`} label={t('competition.details.printResults')} />
        {mayOrganise && <LinkRow to={`/event-tools/${competition.id}/print/poster`} label="Print venue poster" />}
      </div>

      <EventSponsorsSection />

      {competition.sections.length > 0 && (
        <>
          <h2 className="sp-sec fl-ruled">{t('competition.details.enterHeading')}</h2>
          <div className="sp-card" role="list" aria-label={t('competition.details.ageGroups')}>
            {competition.sections.map((section) => (
              <div key={section.id} className="sp-row" role="listitem">
                <span className="sp-grow">
                  <span className="sp-t1">{section.displayName}</span>
                  <span className="sp-t2">{[!closed && placesLeftText(section), feesLine(section, sectionFull(section))].filter(Boolean).join(' · ')}</span>
                </span>
              </div>
            ))}
          </div>
          {awaitingDraw && <p className="sp-note">{t('entries.page.afterDraw')}</p>}
          {competition.sections.map((section) => <MatchmakingBoard key={section.id} competitionId={competition.id} section={section} />)}
          {ended ? (
            <Notice tone="info" className="mt-4">{t('competition.details.ended')}</Notice>
          ) : closed ? (
            <Notice tone="info" className="mt-4">{t('competition.details.entriesClosed')}</Notice>
          ) : (
            <Link to={user ? enterTo : '/login'} state={user ? undefined : { from: enterTo }} className="fl-cta mt-4">{enterLabel}</Link>
          )}
        </>
      )}

      {mayOrganise && (
        <div className="mt-6 flex flex-col gap-3">
          <h2 className="sp-sec !mt-0">Organiser</h2>
          <div className="sp-card" role="list" aria-label="Organiser pages">
            <LinkRow to={`/competitions/${competition.id}/operations`} label="Before the day" />
            <LinkRow to="../shop/manage" label="Manage event shop" />
          </div>
          {competition.sections.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Link to={`/competitions/${competition.id}/timetable-and-draw`} className="sp-pill" title={t('shell.menu.timetableHint')}>
                <Sparkles className="h-4 w-4" aria-hidden="true" /> {t('ops.tt.title')}
              </Link>
              <Link to={`/competitions/${competition.id}/entries#dec-form`} className="sp-pill" title="Choose what the dec form asks for, such as weight or your own questions">
                <ClipboardList className="h-4 w-4" aria-hidden="true" /> {t('shell.menu.decQuestions')}
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
 * Share event (native share sheet or clipboard) and inline QR code toggle. Once an age group has results the row
 * opens a Share event sheet instead, offering the link or a results picture.
 */
export function EventShareRows({ competition }: { competition: CompetitionDetail }) {
  const t = useT();
  const toast = useToast();
  const story = useStoryImage(competition);
  const [shareError, setShareError] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const { id: competitionId, name: competitionName } = competition;
  const shareUrl = competitionLink(competitionId, window.location.origin);
  // The sentence has a link in the middle, so it is split at {link} and the pieces go around the <a>.
  const [copyBefore, copyAfter = ''] = t('competition.details.copyFailed').split('{link}');

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
      toast.show(t('competition.details.linkCopied'));
    } catch {
      setShareError(true);
    }
  }

  return (
    <>
      <div>
        {story.available ? (
          <button type="button" className="sp-row" onClick={() => setChoosing(true)} disabled={story.busy} aria-busy={story.busy}>
            <span className="sp-grow">
              <span className="sp-t1">{t('competition.details.share')}</span>
              {story.busy && <span className="sp-t2">{t('competition.details.storyMaking')}</span>}
            </span>
            <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
          </button>
        ) : (
          <button type="button" className="sp-row" onClick={() => { void shareEvent(); }}>
            <span className="sp-grow"><span className="sp-t1">{t('competition.details.shareLink')}</span></span>
            <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
        {shareError && (
          <Notice className="my-2">
            {copyBefore}<a className="ev-link" href={shareUrl}>{t('competition.details.copyFailedLink')}</a>{copyAfter}
          </Notice>
        )}
        {toast.node}
        {story.node}
        {choosing && (
          <Sheet title={t('competition.details.share')} onClose={() => setChoosing(false)}>
            {({ close }) => (
              <div className="cs-opts">
                {/* The link is shared in the tap itself, since phones refuse a share that waits for the sheet to close. */}
                <button type="button" className="cs-opt" onClick={() => { void shareEvent(); close(); }}>
                  {t('competition.details.shareSendLink')}
                </button>
                <button type="button" className="cs-opt" onClick={() => close(() => { setChoosing(false); story.start(); })}>
                  <span className="flex flex-col py-2">
                    <span>{t('competition.details.storyImage')}</span>
                    <span className="text-sm font-normal text-[rgb(var(--mg-muted))]">{t('competition.details.storyHint')}</span>
                  </span>
                </button>
              </div>
            )}
          </Sheet>
        )}
      </div>
      <div>
        <button type="button" className="sp-row" aria-expanded={showQr} onClick={() => setShowQr((open) => !open)}>
          <span className="sp-grow"><span className="sp-t1">{t('competition.details.showQr')}</span></span>
          <ChevronRight aria-hidden="true" className={`sp-chev h-4 w-4 transition-transform ${showQr ? 'rotate-90' : ''}`} strokeWidth={2.5} />
        </button>
        {showQr && (
          <div className="dt-qr">
            <QrCode
              value={shareUrl}
              label={t('competition.details.qrFor', { name: competitionName })}
              className="w-36 flex-none rounded-lg border border-[rgb(var(--mg-rule))] bg-white p-2"
            />
            <p className="fl-sub m-0">
              {t('competition.details.qrHint', { name: competitionName })}
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
  const t = useT();
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
    try { await api.post(`/my/signups/${own.id}/pair-request`, { targetSignupId }); toast.show(t('competition.match.sent')); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  }
  const pairs = seekers.filter((e) => e.lookingForPair && !e.teamId);
  const guestSpots = seekers.filter((e) => e.lookingForGuestRiders);
  const guestWanted = seekers.filter((e) => e.waitingForGuestSpot && !e.teamId);
  return seekers.length > 0 ? (
    <section className="dt-match" aria-label={`${t('competition.match.title')}: ${section.displayName}`}>
      <h3 className="dt-sub-heading">{t('competition.match.title')}<small>{section.displayName}</small></h3>
      <div className="fl-list">
        {pairs.map((e) => (
          <div key={e.signupId} className="fl-row dt-match-row">
            <span className="fl-grow">
              <span className="fl-title">{e.fullName}{e.ponyClubName ? ` · ${e.ponyClubName}` : ''}</span>
              <span className="fl-sub">{t('competition.match.lookingPair')}</span>
            </span>
            {own && own.id !== e.signupId && (
              <button type="button" className="sp-pill dt-match-ask" disabled={busy} onClick={() => void requestPair(e.signupId)}>
                {t('competition.match.request', { name: e.fullName })}
              </button>
            )}
          </div>
        ))}
        {guestSpots.map((e) => (
          <div key={e.signupId} className="fl-row">
            <span className="fl-grow">
              <span className="fl-title">{e.teamName || e.fullName}{e.ponyClubName ? ` · ${e.ponyClubName}` : ''}</span>
              <span className="fl-sub">{t('competition.match.guestAvailable')}</span>
            </span>
          </div>
        ))}
        {guestWanted.map((e) => (
          <div key={e.signupId} className="fl-row">
            <span className="fl-grow">
              <span className="fl-title">{e.fullName}{e.ponyClubName ? ` · ${e.ponyClubName}` : ''}</span>
              <span className="fl-sub">{t('competition.match.guestWanted')}</span>
            </span>
          </div>
        ))}
      </div>
      {failed && <Notice className="mt-2">{t('competition.match.failed')}</Notice>}
      {toast.node}
    </section>
  ) : null;
}

function EquipmentBlock({ competitionId }: { competitionId: number }) {
  const t = useT();
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
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="sp-row">
        <span className="sp-grow"><span className="sp-t1">{t('competition.equipment.title')}</span></span>
        <ChevronRight aria-hidden="true" className={`sp-chev h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} strokeWidth={2.5} />
      </button>
      {open && (
        loadError ? (
          <Notice className="my-2" actionLabel={t('common.tryAgain')} onAction={() => setLoadError(false)}>{t('competition.equipment.failed')}</Notice>
        ) : data == null ? (
          <p className="sp-note">{t('common.loading')}</p>
        ) : data.lines.length === 0 ? (
          <p className="sp-note">{t('competition.equipment.empty')}</p>
        ) : (
          <div className="flex flex-col gap-3 pb-3 pr-1">
            <p className="sp-note !m-0">
              {t('competition.equipment.sizing', { sessions: t('competition.equipment.sessions', { count: data.sessions }), races: t('competition.equipment.races', { count: data.racesCounted }) })}
            </p>
            {bucketOrder.filter((b) => byBucket.has(b)).map((b) => (
              <div key={b}>
                <h4 className="dt-kit-heading">{b}</h4>
                <ul className="dt-kit-list">
                  {byBucket.get(b)!.sort((a, b2) => a.kind.localeCompare(b2.kind)).map((l) => (
                    <li key={`${b}-${l.kind}`}>
                      <span className="min-w-0 break-words">{l.kind}</span>
                      <span className="dt-kit-count">×{l.count}</span>
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
