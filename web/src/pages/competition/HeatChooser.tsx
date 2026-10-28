import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Sheet } from '../../components/Sheet';
import { useOptionalTicker } from '../../components/TickerContext';
import { computeTimings } from '../../lib/time';
import { timetableRows } from '../../lib/timetableRows';
import { heatChooserGroups } from '../../lib/heatChooser';
import { useLanguage } from '../../i18n/LanguageContext';
import type { Session } from '../../types';

/**
 * "Change heat": a list button beside the ticker dock that opens a sheet of every heat of the day, grouped by age
 * group, with the one on screen ticked. Tapping a heat goes to it (sliding in like any deeper page) and closes the sheet.
 */
export function HeatChooser({ competitionId, sessions, currentHeatId }: { competitionId: number; sessions: Session[]; currentHeatId: number | null }) {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const setDockAction = useOptionalTicker()?.setDockAction;
  const label = t('competition.heat.change');

  useEffect(() => {
    if (!setDockAction) return;
    setDockAction({ label, count: 0, icon: 'list', onClick: () => setOpen(true) });
    return () => setDockAction(null);
  }, [setDockAction, label]);

  const groups = useMemo(
    () => heatChooserGroups(
      timetableRows(sessions, computeTimings(sessions), true),
      currentHeatId,
      (row) => row.heat?.label || t('competition.timetable.heat', { n: row.heatIndex + 1 }),
    ),
    [sessions, currentHeatId, t],
  );

  if (!open) return null;
  const go = (sessionId: number, heatId: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('heat', String(heatId));
    navigate(`/competitions/${competitionId}/session/${sessionId}?${next.toString()}`, { state: { mgTransition: 'push' } });
  };
  return (
    <Sheet title={label} className="heat-sheet" onClose={() => setOpen(false)}>
      {({ close }) => (
        <div className="hc-list">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.section}>
              <h3 className="hc-head">{group.section}</h3>
              {group.rows.map((row) => (
                <button
                  key={row.heatId}
                  type="button"
                  className="hc-row"
                  aria-current={row.current ? 'true' : undefined}
                  onClick={() => close(() => { setOpen(false); if (!row.current) go(row.sessionId, row.heatId); })}
                >
                  <span className="hc-time">{row.time ? row.time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '–'}</span>
                  <span className="hc-name">{row.label}</span>
                  <span className={`hc-status${row.status === 'live' ? ' hc-status-live' : ''}`}>
                    {row.status === 'finished' ? t('common.finished') : row.status === 'live' ? t('shell.header.onNow') : ''}
                  </span>
                  <span className="hc-tick" aria-hidden="true">{row.current && <Check className="h-5 w-5" strokeWidth={2.5} />}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}
