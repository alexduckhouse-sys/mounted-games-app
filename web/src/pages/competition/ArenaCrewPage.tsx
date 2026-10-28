import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useT } from '../../i18n/LanguageContext';
import type { MessageKey } from '../../i18n/en/index.ts';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { usePageWidth } from '../../components/pageWidthState';
import { loadRaceTemplates, sessionFormat } from '../../lib/raceTemplates';
import {
  buildOfflineArenaCrewPropSheet,
  filterRaceCardZones,
  type ArenaCrewZoneFilter,
} from '../../lib/arenaCrewSheet';
import type { ArenaCrewPropSheet, ArenaCrewRaceCard, RaceTemplate } from '../../types';
import { PickRow } from '../clubShop/ui';
import { useCompetition } from './context';
import { defaultChoice, heatDone, heatName, isRaceSession } from './crewDutyHelpers';

const ZONE_FILTERS: { key: ArenaCrewZoneFilter; label: MessageKey }[] = [
  { key: 'all', label: 'desk.commentary.zoneAll' },
  { key: 'start', label: 'desk.commentary.zoneStart' },
  { key: 'centre', label: 'desk.commentary.zoneCentre' },
  { key: 'top', label: 'desk.commentary.zoneTop' },
];

// Headings in the same words as the filter, with the pole numbers for the centre line.
const ZONE_HEADINGS: Record<string, MessageKey> = { start: 'desk.commentary.zoneStart', centre: 'desk.commentary.headCentre', top: 'desk.commentary.zoneTop' };

function validSheet(data: unknown): data is ArenaCrewPropSheet {
  return !!data && typeof data === 'object' && Array.isArray((data as ArenaCrewPropSheet).allHeatRaces);
}

function Group({ title, items, tone }: { title: string; items: string[]; tone: 'in' | 'out' | 'keep' }) {
  const t = useT();
  const colour = tone === 'in' ? '--mg-ok' : tone === 'out' ? '--mg-elim' : '--mg-muted';
  return (
    <section className="rounded-[10px] bg-[rgb(var(--mg-subtle))] p-3.5" style={{ borderLeft: `6px solid rgb(var(${colour}))` }} aria-label={title}>
      <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: `rgb(var(${colour}))` }}>{title}</h3>
      {items.length === 0
        ? <p className="mt-1 text-lg text-[rgb(var(--mg-muted))]">{t('desk.commentary.nothing')}</p>
        : <ul className="mt-1 space-y-1.5">{items.map((item) => <li key={item} className="text-xl font-semibold leading-snug text-[rgb(var(--mg-ink))]">{item}</li>)}</ul>}
    </section>
  );
}

function NowCard({ card, filter }: { card: ArenaCrewRaceCard; filter: ArenaCrewZoneFilter }) {
  const t = useT();
  const zones = filterRaceCardZones(card, filter);
  return (
    <section aria-label={t('desk.commentary.now')} className="overflow-hidden rounded-[12px] border-2 border-[rgb(var(--mg-button))] bg-[rgb(var(--mg-surface))]">
      <header className="bg-[rgb(var(--mg-button))] px-4 py-3 text-[rgb(var(--mg-button-ink))]">
        <p className="text-sm font-bold uppercase tracking-wide opacity-90">{t('desk.commentary.now')}</p>
        <h2 className="text-2xl font-bold leading-tight">{card.raceName}</h2>
      </header>
      <div className="space-y-4 p-4">
        {zones.map((zone) => (
          <div key={zone.zoneKey}>
            <h3 className="text-base font-bold text-[rgb(var(--mg-heading))]">{ZONE_HEADINGS[zone.zoneKey] ? t(ZONE_HEADINGS[zone.zoneKey]) : zone.zoneLabel}</h3>
            {zone.items.length === 0
              ? <p className="text-lg text-[rgb(var(--mg-muted))]">{t('desk.commentary.nothingToSet')}</p>
              : <ul className="mt-1 space-y-1">{zone.items.map((item) => <li key={item} className="text-xl font-semibold leading-snug text-[rgb(var(--mg-ink))]">{item}</li>)}</ul>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ArenaCrewPage() {
  usePageWidth('narrow');
  const t = useT();
  const { competition } = useCompetition();
  const sections = competition.sections;
  const [params, setParams] = useSearchParams();
  usePageHeader({ title: t('desk.commentary.crewTitle'), subtitle: competition.name, backTo: `/competitions/${competition.id}`, backLabel: t('desk.commentary.timetable') });

  const raceSessions = useMemo(
    () => competition.sessions.filter(isRaceSession).slice().sort((a, b) => a.orderIndex - b.orderIndex),
    [competition.sessions],
  );
  const fallback = useMemo(() => defaultChoice(competition.sessions), [competition.sessions]);

  const wantedSession = Number(params.get('session'));
  const session = raceSessions.find((s) => s.id === wantedSession) ?? raceSessions.find((s) => s.id === fallback?.sessionId) ?? null;
  const heats = useMemo(() => (session ? session.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex) : []), [session]);
  const wantedHeat = Number(params.get('heat'));
  const heat = heats.find((h) => h.id === wantedHeat)
    ?? (session && session.id === fallback?.sessionId ? heats.find((h) => h.id === fallback.heatId) : undefined)
    ?? heats.find((h) => !heatDone(h)) ?? heats[0] ?? null;

  const [filter, setFilter] = useState<ArenaCrewZoneFilter>('all');
  const [sheet, setSheet] = useState<ArenaCrewPropSheet | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);

  // Changes whenever a race in this heat completes or the heat's races change, so live updates refetch the sheet.
  const heatSignature = heat ? heat.races.map((r) => `${r.id}:${r.isComplete ? 1 : 0}`).join(',') : '';
  const sessionId = session?.id ?? null;
  const heatId = heat?.id ?? null;
  const sessionRef = useRef(session);
  const heatRef = useRef(heat);
  useEffect(() => { sessionRef.current = session; heatRef.current = heat; });

  const fetchSheet = useCallback(async (): Promise<{ sheet: ArenaCrewPropSheet; offline: boolean }> => {
    try {
      const { data } = await api.get<ArenaCrewPropSheet>(`/competitions/${competition.id}/arena-crew-sheet`, {
        params: { ...(sessionId != null ? { sessionId } : {}), ...(heatId != null ? { heatId } : {}) },
      });
      if (!validSheet(data)) throw new Error('Unexpected response');
      return { sheet: data, offline: false };
    } catch {
      let templates: RaceTemplate[] = [];
      try { templates = await loadRaceTemplates(); } catch { /* build from the timetable alone */ }
      return { sheet: buildOfflineArenaCrewPropSheet(competition.id, sessionRef.current, heatRef.current, templates, sessionFormat({ sections }, sessionRef.current)), offline: true };
    }
  }, [competition.id, sections, sessionId, heatId]);

  // heatSignature is only a trigger: it changes when a race in this heat completes.
  useEffect(() => {
    let active = true;
    void fetchSheet().then((result) => {
      if (!active) return;
      setSheet(result.sheet);
      setOffline(result.offline);
      setLoading(false);
    });
    return () => { active = false; };
  }, [fetchSheet, heatSignature]);

  function choose(next: { session?: number; heat?: number }) {
    const merged = new URLSearchParams(params);
    if (next.session != null) { merged.set('session', String(next.session)); merged.delete('heat'); }
    if (next.heat != null) merged.set('heat', String(next.heat));
    setParams(merged, { replace: true });
  }

  if (raceSessions.length === 0) {
    return <p className="mg-card p-4 text-base">{t('desk.commentary.noRaceSessions')}</p>;
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Three settings rows, each opening a bottom sheet: one control per choice rather than boxes and a row of pills. */}
      <div className="mg-card overflow-hidden divide-y divide-[rgb(var(--mg-rule-soft))]">
        <PickRow label={t('desk.commentary.pickSession')} value={String(session?.id ?? '')} onPick={(id) => choose({ session: Number(id) })}
          options={raceSessions.map((s) => ({ value: String(s.id), label: `${s.name}${s.arenaName ? ` · ${s.arenaName}` : ''}` }))} />
        <PickRow label={t('desk.commentary.pickHeat')} value={String(heat?.id ?? '')} onPick={(id) => choose({ heat: Number(id) })}
          options={heats.map((h) => ({ value: String(h.id), label: heatName(h) }))} />
        <PickRow label={t('desk.commentary.pickZone')} value={filter} onPick={(key) => setFilter(key as ArenaCrewZoneFilter)}
          options={ZONE_FILTERS.map((z) => ({ value: z.key, label: t(z.label) }))} />
      </div>

      {offline && <p role="status" className="rounded-[10px] bg-[rgb(var(--mg-info-bg))] px-3 py-2 text-sm text-[rgb(var(--mg-info-ink))]">{t('desk.commentary.offline')}</p>}

      {loading && !sheet && <p className="mg-card p-4 text-base" role="status">{t('desk.commentary.loadingSheet')}</p>}

      {sheet && !sheet.currentRace && <p className="mg-card p-4 text-base">{t('desk.commentary.noRaces')}</p>}

      {sheet?.currentRace && <NowCard card={sheet.currentRace} filter={filter} />}

      {sheet?.currentRace && (
        <section aria-label={t('desk.commentary.nextRace')} className="mg-card space-y-3 p-4">
          <h2 className="text-lg font-bold text-[rgb(var(--mg-heading))]">
            {sheet.nextRace ? t('desk.commentary.nextRaceName', { name: sheet.nextRace.raceName }) : t('desk.commentary.nextRace')}
          </h2>
          {sheet.nextRace && sheet.transition
            ? <>
                <Group title={t('desk.commentary.bringIn')} items={sheet.transition.bringIn} tone="in" />
                <Group title={t('desk.commentary.clear')} items={sheet.transition.clearOut} tone="out" />
                <Group title={t('desk.commentary.keep')} items={sheet.transition.keepInRing} tone="keep" />
              </>
            : <p className="text-lg text-[rgb(var(--mg-muted))]">{t('desk.commentary.lastRaceOfHeat')}</p>}
        </section>
      )}
    </div>
  );
}
