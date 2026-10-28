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
import { clock, plural, type IssueGroup } from './readiness';
import { sortRows, type SortRow } from './hubData';
import type { CompetitionReadiness } from './types';

interface Tile { key: string; title: string; icon: LucideIcon; to: string; status?: string; todo?: boolean }
interface TileGroup { key: string; title: string; tiles: Tile[] }
const isRaceSession = (session: { kind?: number | null; isBreak?: boolean }) => (session.kind ?? (session.isBreak ? 1 : 0)) === 0;

function buildGroups(competition: CompetitionDetail, readiness: CompetitionReadiness | null, groups: IssueGroup[], mayDuplicate: boolean): TileGroup[] {
  const base = `/competitions/${competition.id}`;
  const ops = `${base}/operations`;
  const sections = competition.sections ?? [];
  const sessions = competition.sessions ?? [];
  const when = competitionDateText(competition.startDate, competition.endDate);

  // Status lines come only from data already loaded: the competition itself and the readiness check.
  let sectionsStatus: Pick<Tile, 'status' | 'todo'> = sections.length > 0 ? { status: plural(sections.length, 'section') } : {};
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
    if (toChoose > 0) sectionsStatus = { status: 'Races to choose', todo: true };
    const raceSessions = sessions.filter(isRaceSession);
    if (clashes > 0) timetableStatus = { status: plural(clashes, 'arena clash', 'arena clashes'), todo: true };
    else if (details > 0) timetableStatus = { status: plural(details, 'race') + ' missing details', todo: true };
    else if (raceSessions.length > 0 && raceSessions.every((session) => (session.heats?.length ?? 0) === 0)) timetableStatus = { status: 'Draw not done', todo: true };
    if (toCheck > 0) equipmentStatus = { status: `${toCheck} to check`, todo: true };
    else if (lines.length > 0) equipmentStatus = { status: 'All checked' };
    const parts = [
      missing > 0 ? `${plural(missing, 'dec form')} missing` : '',
      unpaid > 0 ? `${unpaid} not paid` : '',
      short > 0 ? `${plural(short, 'team')} short` : '',
    ].filter(Boolean);
    entriesStatus = parts.length > 0 ? { status: parts.join(' · '), todo: true } : { status: 'All in order' };
  }

  return [
    {
      key: 'setup', title: 'Set up', tiles: [
        { key: 'details', title: 'Event details', icon: CalendarDays, to: `${base}/event-details`, status: when || undefined },
        { key: 'sections', title: 'Sections and races', icon: ListChecks, to: `${base}/sections`, ...sectionsStatus },
        { key: 'timetable', title: 'Timetable and draw', icon: Clock, to: `${base}/timetable-and-draw`, ...timetableStatus },
        { key: 'equipment', title: 'Equipment', icon: Boxes, to: `${base}/equipment`, ...equipmentStatus },
        { key: 'sponsors', title: 'Sponsors and sharing', icon: Share2, to: `${base}/sponsors-and-sharing` },
        { key: 'rulebooks', title: 'Rulebooks', icon: BookOpen, to: `${base}/rulebooks` },
      ],
    },
    {
      key: 'people', title: 'People', tiles: [
        { key: 'entries', title: 'Entries and dec forms', icon: ClipboardList, to: `${base}/entries`, ...entriesStatus },
        { key: 'import', title: 'Import teams', icon: FileUp, to: `${ops}/import` },
        { key: 'volunteers', title: 'Volunteers', icon: HandHelping, to: `${ops}/volunteers` },
        { key: 'scorers', title: 'Scorers and team', icon: Users, to: `${ops}/scorers` },
        { key: 'safety', title: 'Emergency contacts', icon: PhoneCall, to: `${ops}/safety` },
      ],
    },
    {
      key: 'day', title: 'On the day', tiles: [
        { key: 'tack', title: 'Tack check', icon: ClipboardCheck, to: `${ops}/tack` },
        { key: 'passport', title: 'Passport check', icon: IdCard, to: `${ops}/passport` },
        { key: 'protests', title: 'Protests', icon: Flag, to: `${ops}/protests` },
        { key: 'print', title: 'Print sheets', icon: Printer, to: `${ops}/print` },
        { key: 'results', title: 'Results book', icon: Trophy, to: `${ops}/results` },
      ],
    },
    ...(mayDuplicate ? [{ key: 'other', title: 'Other', tiles: [{ key: 'duplicate', title: 'Duplicate event', icon: Copy, to: `${ops}/duplicate` }] }] : []),
  ];
}

function summaryText(rows: SortRow[], clashCount: number): string {
  const parts = [
    ...(clashCount > 0 ? [`${plural(clashCount, 'arena clash', 'arena clashes')}`] : []),
    ...rows.map((row) => row.summary),
  ];
  const shown = parts.slice(0, 3).join(' · ');
  return parts.length > 3 ? `${shown} · ${parts.length - 3} more` : shown;
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
  const base = `/competitions/${competition.id}`;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { rows, clashes } = readiness ? sortRows(readiness, groups, base) : { rows: [], clashes: [] };
  const total = rows.reduce((sum, row) => sum + row.count, 0) + clashes.length;
  const tileGroups = buildGroups(competition, readiness, groups, mayDuplicate);
  const row = (to: string, children: ReactNode, key?: string) => <Link key={key} to={to} className="rf-row">{children}</Link>;

  return (
    <div className="ops-hub">
      {refreshFailed && (
        <Notice actionLabel="Try again" onAction={onRetry} actionDisabled={retrying} role="status">
          Couldn’t refresh{checkedAt ? ` · last known ${clock(checkedAt)}` : ''}. Check your signal and try again.
        </Notice>
      )}

      {readiness && total > 0 && (
        <>
          <button type="button" className="ops-sort" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)}>
            <span className="ops-sort-n"><TickerNumber value={total} format={String} /></span>
            <span className="rf-grow">
              <span className="rf-t1">{total === 1 ? 'thing to sort' : 'things to sort'}</span>
              <span className="ops-sort-why">{summaryText(rows, clashes.length)}</span>
            </span>
            <Chevron down={open} />
          </button>
          <div id={listId} hidden={!open} className="ops-sort-list">
            {clashes.length > 0 && <>
              <RefineSection title="Blocking publish" />
              <RefineList as="div">
                {clashes.map((item) => row(item.to, <>
                  <span className="rf-grow"><span className="rf-t1">{item.title}</span><span className="rf-t2">{item.detail}</span></span>
                  <Chevron />
                </>, item.key))}
              </RefineList>
            </>}
            {rows.length > 0 && <>
              <RefineSection title="To sort" />
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
        <p className="ops-clear" role="status"><CircleCheck className="h-5 w-5" aria-hidden="true" />Nothing to sort</p>
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
