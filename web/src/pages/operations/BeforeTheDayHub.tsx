import { Fragment, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, Boxes, CalendarDays, CircleCheck, ClipboardCheck, ClipboardList, Clock, Copy, FileUp, Flag,
  HandHelping, IdCard, ListChecks, PhoneCall, Printer, Share2, Trophy, Users,
  type LucideIcon,
} from 'lucide-react';
import { Notice } from '../../components/Notice';
import { TickerNumber } from '../../components/TickerNumber';
import { Chevron, RefineList, RefineSection } from '../refine/Refine';
import { competitionDateText } from '../../lib/competitionDates';
import type { CompetitionDetail } from '../../types';
import { equipmentLines } from './equipment';
import { useT } from '../../i18n/LanguageContext';
import type { Translate } from '../../i18n/translate';
import { clock, type IssueGroup } from './readiness';
import { sortRows, type SortRow } from './hubData';
import type { CompetitionReadiness } from './types';

interface Tile { key: string; title: string; icon: LucideIcon; to: string; status?: string; todo?: boolean }
interface TileGroup { key: string; title: string; tiles: Tile[] }
const isRaceSession = (session: { kind?: number | null; isBreak?: boolean }) => (session.kind ?? (session.isBreak ? 1 : 0)) === 0;

function buildGroups(t: Translate, competition: CompetitionDetail, readiness: CompetitionReadiness | null, groups: IssueGroup[], mayDuplicate: boolean): TileGroup[] {
  const base = `/competitions/${competition.id}`;
  const ops = `${base}/operations`;
  const sections = competition.sections ?? [];
  const sessions = competition.sessions ?? [];
  const when = competitionDateText(competition.startDate, competition.endDate);

  // Status lines come only from data already loaded: the competition itself and the readiness check.
  let sectionsStatus: Pick<Tile, 'status' | 'todo'> = sections.length > 0 ? { status: t('ops.hub.sections', { count: sections.length }) } : {};
  let timetableStatus: Pick<Tile, 'status' | 'todo'> = {};
  let equipmentStatus: Pick<Tile, 'status' | 'todo'> = {};
  let entriesStatus: Pick<Tile, 'status' | 'todo'> = {};
  if (readiness) {
    const unpaid = readiness.unpaidSignups.length;
    const missing = readiness.missingDeclarations.length;
    const short = readiness.incompleteTeams.length;
    const clashes = groups.find((group) => group.id === 'clashes')?.items.length ?? 0;
    const details = readiness.equipmentIssues.length;
    const acknowledged = new Set(readiness.equipmentChecklist.filter((item) => item.acknowledged).map((item) => item.key));
    const lines = equipmentLines(readiness.equipmentChecklist);
    const toCheck = lines.filter((line) => !line.keys.every((key) => acknowledged.has(key))).length;
    const toChoose = readiness.raceListsToChoose?.length ?? 0;
    if (toChoose > 0) sectionsStatus = { status: t('ops.hub.racesToChoose'), todo: true };
    const raceSessions = sessions.filter(isRaceSession);
    if (clashes > 0) timetableStatus = { status: t('ops.hub.clashes', { count: clashes }), todo: true };
    else if (details > 0) timetableStatus = { status: t('ops.hub.racesNoDetails', { count: details }), todo: true };
    else if (raceSessions.length > 0 && raceSessions.every((session) => (session.heats?.length ?? 0) === 0)) timetableStatus = { status: t('ops.hub.drawNotDone'), todo: true };
    if (toCheck > 0) equipmentStatus = { status: t('ops.draw.toCheck', { count: toCheck }), todo: true };
    else if (lines.length > 0) equipmentStatus = { status: t('ops.hub.allChecked') };
    const parts = [
      missing > 0 ? t('ops.hub.decMissing', { count: missing }) : '',
      unpaid > 0 ? t('ops.hub.notPaid', { count: unpaid }) : '',
      short > 0 ? t('ops.hub.teamsShort', { count: short }) : '',
    ].filter(Boolean);
    entriesStatus = parts.length > 0 ? { status: parts.join(' · '), todo: true } : { status: t('ops.hub.allInOrder') };
  }

  return [
    {
      key: 'setup', title: t('ops.hub.setUp'), tiles: [
        { key: 'details', title: t('ops.area.details'), icon: CalendarDays, to: `${base}/event-details`, status: when || undefined },
        { key: 'sections', title: t('ops.area.sections'), icon: ListChecks, to: `${base}/sections`, ...sectionsStatus },
        { key: 'timetable', title: t('ops.area.timetable'), icon: Clock, to: `${base}/timetable-and-draw`, ...timetableStatus },
        { key: 'equipment', title: t('ops.area.equipment'), icon: Boxes, to: `${base}/equipment`, ...equipmentStatus },
        { key: 'sponsors', title: t('ops.area.sponsors'), icon: Share2, to: `${base}/sponsors-and-sharing` },
        { key: 'rulebooks', title: t('ops.hub.rulebooks'), icon: BookOpen, to: `${base}/rulebooks` },
      ],
    },
    {
      key: 'people', title: t('ops.hub.people'), tiles: [
        { key: 'entries', title: t('ops.area.entries'), icon: ClipboardList, to: `${base}/entries`, ...entriesStatus },
        { key: 'import', title: t('ops.view.import'), icon: FileUp, to: `${ops}/import` },
        { key: 'volunteers', title: t('ops.view.volunteers'), icon: HandHelping, to: `${ops}/volunteers` },
        { key: 'scorers', title: t('ops.view.scorers'), icon: Users, to: `${ops}/scorers` },
        { key: 'safety', title: t('ops.view.safety'), icon: PhoneCall, to: `${ops}/safety` },
      ],
    },
    {
      key: 'day', title: t('ops.hub.onTheDay'), tiles: [
        { key: 'tack', title: t('ops.view.tack'), icon: ClipboardCheck, to: `${ops}/tack` },
        { key: 'passport', title: t('ops.view.passport'), icon: IdCard, to: `${ops}/passport` },
        { key: 'protests', title: t('ops.view.protests'), icon: Flag, to: `${ops}/protests` },
        { key: 'print', title: t('ops.view.print'), icon: Printer, to: `${ops}/print` },
        { key: 'results', title: t('ops.view.results'), icon: Trophy, to: `${ops}/results` },
      ],
    },
    ...(mayDuplicate ? [{ key: 'other', title: t('ops.hub.other'), tiles: [{ key: 'duplicate', title: t('ops.view.duplicate'), icon: Copy, to: `${ops}/duplicate` }] }] : []),
  ];
}

function summaryText(t: Translate, rows: SortRow[], clashCount: number): string {
  const parts = [
    ...(clashCount > 0 ? [t('ops.hub.clashes', { count: clashCount })] : []),
    ...rows.map((row) => row.summary),
  ];
  const shown = parts.slice(0, 3).join(' · ');
  return parts.length > 3 ? `${shown} · ${t('ops.hub.more', { count: parts.length - 3 })}` : shown;
}

/** "Before the day": what is left to sort (tap to open the list in place), then every tool as a tile. */
export function BeforeTheDayHub({ competition, readiness, groups, mayDuplicate, refreshFailed, checkedAt, retrying, onRetry }: {
  competition: CompetitionDetail;
  readiness: CompetitionReadiness | null;
  groups: IssueGroup[];
  mayDuplicate: boolean;
  refreshFailed: boolean;
  checkedAt: Date | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  const base = `/competitions/${competition.id}`;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { rows, clashes } = readiness ? sortRows(readiness, groups, base, t) : { rows: [], clashes: [] };
  const total = rows.reduce((sum, row) => sum + row.count, 0) + clashes.length;
  const tileGroups = buildGroups(t, competition, readiness, groups, mayDuplicate);
  const row = (to: string, children: ReactNode, key?: string) => <Link key={key} to={to} className="rf-row">{children}</Link>;

  return (
    <div className="ops-hub">
      {refreshFailed && (
        <Notice actionLabel={t('common.tryAgain')} onAction={onRetry} actionDisabled={retrying} role="status">
          {t('ops.prep.refreshFailed', { known: checkedAt ? t('ops.prep.lastKnown', { time: clock(checkedAt) }) : '' })}
        </Notice>
      )}

      {readiness && total > 0 && (
        <>
          <button type="button" className="ops-sort" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)}>
            <span className="ops-sort-n"><TickerNumber value={total} format={String} /></span>
            <span className="rf-grow">
              <span className="rf-t1">{t('ops.hub.thingsToSort', { count: total })}</span>
              <span className="ops-sort-why">{summaryText(t, rows, clashes.length)}</span>
            </span>
            <Chevron down={open} />
          </button>
          <div id={listId} hidden={!open} className="ops-sort-list">
            {clashes.length > 0 && <>
              <RefineSection title={t('ops.prep.blocking')} />
              <RefineList as="div">
                {clashes.map((item) => row(item.to, <>
                  <span className="rf-grow"><span className="rf-t1">{item.title}</span><span className="rf-t2">{item.detail}</span></span>
                  <Chevron />
                </>, item.key))}
              </RefineList>
            </>}
            {rows.length > 0 && <>
              <RefineSection title={t('ops.prep.toSort')} />
              <RefineList as="div">
                {rows.map((item) => <Fragment key={item.key}>{row(item.to, <>
                  <span className="rf-num ops-count"><TickerNumber value={item.count} format={String} /></span>
                  <span className="rf-grow rf-t1">{item.title}</span>
                  <Chevron />
                </>)}</Fragment>)}
              </RefineList>
            </>}
          </div>
        </>
      )}
      {readiness && total === 0 && (
        <p className="ops-clear" role="status"><CircleCheck className="h-5 w-5" aria-hidden="true" />{t('ops.hub.nothing')}</p>
      )}

      {tileGroups.map((group) => (
        <section key={group.key} aria-label={group.title}>
          <RefineSection title={group.title} />
          <ul className="ops-tiles">
            {group.tiles.map((tile) => (
              <li key={tile.key}>
                <Link to={tile.to} className="ops-tile">
                  <span className="ops-tile-i"><tile.icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
                  <span className="rf-t1">{tile.title}</span>
                  {tile.status && <span className={tile.todo ? 'ops-tile-todo' : 'rf-t2'}>{tile.status}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
