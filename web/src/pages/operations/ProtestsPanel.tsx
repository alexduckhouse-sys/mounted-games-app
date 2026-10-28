import { useT } from '../../i18n/LanguageContext';
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../api';
import { activeLocale } from '../../i18n/translate';
import { Notice } from '../../components/Notice';
import { PROTESTS_CHANGED_EVENT, PROTEST_STATUS_LABELS, protestTone, protestWhere, protestsBlocking } from '../../lib/protests';
import { ProtestStatus, type Heat, type Protest, type Race } from '../../types';
import { Chip } from '../clubShop/ui';
import { RefineList, RefineNote, RefineSection } from '../refine/Refine';
import { ProtestDecisionSheet } from './ProtestDecisionSheet';
import { ProtestSheet } from './ProtestSheet';
import { apiMessage } from './types';
import './operations.css';

interface ProtestsPanelProps {
  competitionId: number;
  /** Only this race's protests, including the ones against its whole heat. */
  raceId?: number;
  /** Only this heat's protests. */
  heatId?: number;
  /** Only open protests. */
  openOnly?: boolean;
  /** With a heat (and the race on screen), the panel offers "Log a protest". */
  heat?: Heat;
  race?: Race | null;
  title?: string;
  empty?: string;
}

/**
 * The protest log for the competition's staff: open protests first with a Decide pill, then the decided ones with
 * their decision. On a race it also says why the race can't be signed off. Reloads when a protest changes on
 * this phone or another (the `mg:protests` window event, fired by the live hub nudge and on reconnect).
 */
export function ProtestsPanel({ competitionId, raceId, heatId, openOnly = false, heat, race = null, title: titleProp, empty: emptyProp }: ProtestsPanelProps) {
  const t = useT();
  const title = titleProp ?? t('ops2.protests.title');
  const empty = emptyProp ?? t('ops2.protests.none');
  const [protests, setProtests] = useState<Protest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [deciding, setDeciding] = useState<Protest | null>(null);

  const load = useCallback(async () => {
    const params: Record<string, string | number | boolean> = {};
    if (raceId != null) params.raceId = raceId;
    if (heatId != null) params.heatId = heatId;
    if (openOnly) params.open = true;
    try {
      const response = await api.get<Protest[]>(`/competitions/${competitionId}/protests`, { params });
      setProtests(Array.isArray(response.data) ? response.data : []);
      setError(null);
    } catch (loadError) {
      setError(apiMessage(loadError, t('ops2.protests.loadError')));
    }
  }, [competitionId, raceId, heatId, openOnly, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const reload = () => void load();
    window.addEventListener(PROTESTS_CHANGED_EVENT, reload);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(PROTESTS_CHANGED_EVENT, reload);
    };
  }, [load]);

  // With the race on screen, say which open protests are holding up its sign-off.
  const blocking = race && protests ? protestsBlocking(protests, race.id, race.heatId) : [];

  return (
    <section aria-label={title}>
      <RefineSection title={title} />
      {error && <Notice actionLabel={t('common.tryAgain')} onAction={() => void load()}>{error}</Notice>}
      {blocking.length > 0 && (
        <RefineNote>
          {blocking.length === 1 ? t('ops2.protests.blockingOne') : t('ops2.protests.blockingMany', { count: blocking.length })}
        </RefineNote>
      )}
      {protests === null && !error && <p role="status" className="rf-note">{t('ops2.protests.loading')}</p>}
      {protests !== null && protests.length === 0 && <RefineNote>{empty}</RefineNote>}
      {protests !== null && protests.length > 0 && (
        <RefineList label={title}>
          {protests.map((protest) => <ProtestRow key={protest.id} protest={protest} onDecide={() => setDeciding(protest)} />)}
        </RefineList>
      )}
      {heat && (
        <button type="button" className="ops-addbar" onClick={() => setLogging(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />{t('ops2.protests.log')}
        </button>
      )}
      {logging && heat && (
        <ProtestSheet competitionId={competitionId} heat={heat} race={race} onClose={() => setLogging(false)} />
      )}
      {deciding && <ProtestDecisionSheet protest={deciding} onClose={() => setDeciding(null)} />}
    </section>
  );
}

function ProtestRow({ protest, onDecide }: { protest: Protest; onDecide: () => void }) {
  const t = useT();
  const open = protest.status === ProtestStatus.Open;
  const raisedBy = [protest.raisedByTeam?.teamName, protest.raisedByName].filter(Boolean).join(', ');
  const when = new Date(protest.createdAt).toLocaleTimeString(activeLocale(), { hour: '2-digit', minute: '2-digit' });
  return (
    <li className="rf-row ops-history" data-testid={`protest-${protest.id}`}>
      <span className="rf-grow">
        <span className="rf-t1">{protestWhere(protest)} <Chip tone={protestTone(protest.status)}>{PROTEST_STATUS_LABELS[protest.status]}</Chip></span>
        <span className="rf-t2">{protest.sessionName} · {when}{raisedBy ? t('ops2.protests.raisedBy', { name: raisedBy }) : ''}</span>
        <span className="ops-reason">{protest.reason}</span>
        {protest.concerns.length > 0 && <span className="rf-t2">{t('ops2.protests.about', { teams: protest.concerns.map((team) => team.teamName).join(', ') })}</span>}
        {protest.decision && <span className="ops-reason"><strong>{open ? '' : `${PROTEST_STATUS_LABELS[protest.status]}: `}</strong>{protest.decision}</span>}
        {open && protest.raceSignedOff && <span className="rf-t2 ops-warn">{t('ops2.protests.afterSignOff')}</span>}
      </span>
      {open && <button type="button" className="kit-pill" onClick={onDecide} aria-label={t('ops2.protests.decideAria', { where: protestWhere(protest) })}>{t('ops2.protests.decide')}</button>}
    </li>
  );
}
