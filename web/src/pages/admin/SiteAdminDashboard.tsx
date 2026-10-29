import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { competitionDateText } from '../../lib/competitionDates';
import { stageOf } from '../../lib/adminStage';
import { useT } from '../../i18n/LanguageContext';
import type { CompetitionSummary, RaceTemplate, TrainerRequest } from '../../types';
import { Chevron, RefineHeader, RefineList, RefinePage, RefineStatus } from '../refine/Refine';
import { STAGE_TONE, stageCountsText, stageLabel } from './adminShared';
import '../operations/operations.css';

/** How many things came back, or null while loading and when the request failed. */
const lengthOf = (data: unknown): number | null => (Array.isArray(data) ? data.length : null);

/** Site admin home: what needs the admin, the upcoming competitions, and the places to manage the site. */
export function SiteAdminDashboard() {
  const t = useT();
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
      <RefineHeader context={t('common.mountedGames')} title={t('admin.accounts.siteAdmin')} />
      <div className="ops-cards ops-tt ops-admin">
        {/* The space for "Needs you" is held until we know whether anyone is waiting, then it either fills or folds away. */}
        <div className="ops-reserve" data-open={waiting === null || toApprove > 0}>
          <div>
            {toApprove > 0 ? (
              <>
                <h2 className="rf-sec ops-tt-head"><span>{t('admin.accounts.dash.needsYou')}</span></h2>
                <RefineList as="div" label={t('admin.accounts.dash.needsYou')}>
                  <Link to="/admin/trainer-requests" className="rf-row">
                    <span className="rf-num ops-count">{toApprove}</span>
                    <span className="rf-grow rf-t1">{t('admin.accounts.dash.requestsToApprove', { count: toApprove })}</span>
                    <Chevron />
                  </Link>
                </RefineList>
              </>
            ) : (
              <div aria-hidden="true">
                <h2 className="rf-sec ops-tt-head"><span className="mg-skel" style={{ width: 96, height: 22 }} /></h2>
                <RefineList as="div"><div className="rf-row"><span className="mg-skel" style={{ width: '60%', height: 16 }} /></div></RefineList>
              </div>
            )}
          </div>
        </div>

        <h2 className="rf-sec ops-tt-head"><span>{t('admin.accounts.competitions')}</span></h2>
        <RefineList as="div" label={t('admin.accounts.competitions')}>
          {comps === null && <div className="rf-row"><span className="rf-t2" role="status">{t('common.loading')}</span></div>}
          {comps !== null && upcoming.length === 0 && <div className="rf-row"><span className="rf-t2">{t('admin.accounts.dash.noneComingUp')}</span></div>}
          {upcoming.slice(0, 6).map(({ c, stage }) => (
            <Link key={c.id} to={`/competitions/${c.id}/operations`} className="rf-row">
              <span className="rf-grow"><span className="rf-t1">{c.name}</span><span className="rf-t2">{competitionDateText(c.startDate, c.endDate)}</span></span>
              <RefineStatus tone={STAGE_TONE[stage]}>{stageLabel(stage)}</RefineStatus>
              <Chevron />
            </Link>
          ))}
        </RefineList>

        <h2 className="rf-sec ops-tt-head"><span>{t('admin.accounts.dash.manage')}</span></h2>
        <RefineList as="div" label={t('admin.accounts.dash.manage')}>
          <Link to="/admin/competitions" className="rf-row">
            <span className="rf-grow"><span className="rf-t1">{t('admin.accounts.competitions')}</span><span className="rf-t2">{comps ? stageCountsText(rows.map((row) => row.stage)) : ' '}</span></span>
            <Chevron />
          </Link>
          <Link to="/admin/trainer-requests" className="rf-row">
            <span className="rf-grow"><span className="rf-t1">{t('admin.accounts.dash.trainerRequests')}</span><span className="rf-t2">{waiting === null ? ' ' : waiting > 0 ? t('admin.accounts.dash.waiting', { count: waiting }) : t('admin.accounts.dash.noneWaiting')}</span></span>
            {toApprove > 0 && <span className="ops-badge" aria-hidden="true">{toApprove}</span>}
            <Chevron />
          </Link>
          <Link to="/admin/users" className="rf-row">
            <span className="rf-grow rf-t1">{t('admin.accounts.dash.users')}</span>
            <Chevron />
          </Link>
          <Link to="/admin/blocked" className="rf-row">
            <span className="rf-grow rf-t1">{t('admin.accounts.dash.blocked')}</span>
            <Chevron />
          </Link>
          <Link to="/admin/email" className="rf-row">
            <span className="rf-grow rf-t1">{t('admin.accounts.dash.email')}</span>
            <Chevron />
          </Link>
          <Link to="/admin/rules" className="rf-row">
            <span className="rf-grow"><span className="rf-t1">{t('admin.accounts.dash.rules')}</span><span className="rf-t2">{races === null ? ' ' : t('admin.accounts.dash.races', { count: races })}</span></span>
            <Chevron />
          </Link>
        </RefineList>
      </div>
    </RefinePage>
  );
}
