import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { competitionDateText } from '../../lib/competitionDates';
import { STAGE_LABEL, stageCounts, stageOf } from '../../lib/adminStage';
import type { CompetitionSummary, RaceTemplate, TrainerRequest } from '../../types';
import { Chevron, RefineHeader, RefineList, RefinePage, RefineStatus } from '../refine/Refine';
import { STAGE_TONE } from './adminShared';
import '../operations/operations.css';

/** How many things came back, or null while loading and when the request failed. */
const lengthOf = (data: unknown): number | null => (Array.isArray(data) ? data.length : null);

/** Site admin home: what needs the admin, the upcoming competitions, and the places to manage the site. */
export function SiteAdminDashboard() {
  const [comps, setComps] = useState<CompetitionSummary[] | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [races, setRaces] = useState<number | null>(null);
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    let cancelled = false;
    api.get<CompetitionSummary[]>('/competitions', { params: { includeArchived: true } })
      .then(({ data }) => { if (!cancelled) setComps(Array.isArray(data) ? data : []); }).catch(() => { if (!cancelled) setComps([]); });
    api.get<TrainerRequest[]>('/admin/trainer-requests')
      .then(({ data }) => { if (!cancelled) setWaiting(lengthOf(data)); }).catch(() => undefined);
    api.get<RaceTemplate[]>('/race-templates')
      .then(({ data }) => { if (!cancelled) setRaces(lengthOf(data)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => (comps ?? []).map((c) => ({ c, stage: stageOf(c, now) })), [comps, now]);
  const upcoming = rows.filter((row) => row.stage !== 'finished');
  const toApprove = waiting ?? 0;

  return (
    <RefinePage>
      <RefineHeader context="Mounted Games" title="Site admin" />
      <div className="ops-cards ops-tt ops-admin">
        {toApprove > 0 && (
          <>
            <h2 className="rf-sec ops-tt-head"><span>Needs you</span></h2>
            <RefineList as="div" label="Needs you">
              <Link to="/admin/trainer-requests" className="rf-row">
                <span className="rf-num ops-count">{toApprove}</span>
                <span className="rf-grow rf-t1">{toApprove === 1 ? 'Trainer request to approve' : 'Trainer requests to approve'}</span>
                <Chevron />
              </Link>
            </RefineList>
          </>
        )}

        <h2 className="rf-sec ops-tt-head"><span>Competitions</span></h2>
        <RefineList as="div" label="Competitions">
          {comps === null && <div className="rf-row"><span className="rf-t2" role="status">Loading…</span></div>}
          {comps !== null && upcoming.length === 0 && <div className="rf-row"><span className="rf-t2">No competitions coming up</span></div>}
          {upcoming.slice(0, 6).map(({ c, stage }) => (
            <Link key={c.id} to={`/competitions/${c.id}/operations`} className="rf-row">
              <span className="rf-grow"><span className="rf-t1">{c.name}</span><span className="rf-t2">{competitionDateText(c.startDate, c.endDate)}</span></span>
              <RefineStatus tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</RefineStatus>
              <Chevron />
            </Link>
          ))}
        </RefineList>

        <h2 className="rf-sec ops-tt-head"><span>Manage the site</span></h2>
        <RefineList as="div" label="Manage the site">
          <Link to="/admin/competitions" className="rf-row">
            <span className="rf-grow"><span className="rf-t1">Competitions</span><span className="rf-t2">{comps ? stageCounts(rows.map((row) => row.stage)) : ' '}</span></span>
            <Chevron />
          </Link>
          <Link to="/admin/trainer-requests" className="rf-row">
            <span className="rf-grow"><span className="rf-t1">Trainer requests</span><span className="rf-t2">{waiting === null ? ' ' : waiting > 0 ? `${waiting} waiting` : 'No one waiting'}</span></span>
            {toApprove > 0 && <span className="ops-badge" aria-hidden="true">{toApprove}</span>}
            <Chevron />
          </Link>
          <Link to="/admin/users" className="rf-row">
            <span className="rf-grow rf-t1">Users</span>
            <Chevron />
          </Link>
          <Link to="/admin/rules" className="rf-row">
            <span className="rf-grow"><span className="rf-t1">Rules library</span><span className="rf-t2">{races === null ? ' ' : `${races} ${races === 1 ? 'race' : 'races'}`}</span></span>
            <Chevron />
          </Link>
        </RefineList>
      </div>
    </RefinePage>
  );
}
