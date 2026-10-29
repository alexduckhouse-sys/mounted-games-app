import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useEmbedResource } from '../../hooks/useEmbedResource';
import { broadcastOptions, broadcastPresentation, isBroadcastSnapshot, type BroadcastRow } from '../../lib/broadcast';
import './broadcast.css';
import { useBroadcastLive } from './useBroadcastLive';
import { useT } from '../../i18n/LanguageContext';

function Rows({ rows, scores = false }: { rows: BroadcastRow[]; scores?: boolean }) {
  return <div className="bc-rows">{rows.slice(0, 12).map(row => <div className="bc-row" key={row.teamId}>
    <b className="bc-place">{row.sitOut ? 'S' : scores ? row.eliminated ? 'E' : `${row.place ?? '–'}${row.joint ? '=' : ''}` : row.lane}</b>
    <span>{row.name}{row.hc && <small> HC</small>}</span>{scores && <strong>{row.points ?? '–'}</strong>}
  </div>)}</div>;
}

/** Public graphics only. This tree never imports app context, auth, video, local storage or the score outbox. */
export function BroadcastOverlay() {
  const t = useT();
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const options = useMemo(() => broadcastOptions(search), [search]);
  const preview = search.get('preview') === '1';
  const [clock, setClock] = useState(() => Date.now());
  const path = /^[1-9]\d*$/.test(id) && options.valid
    ? `/competitions/${id}/broadcast-snapshot?${new URLSearchParams({ arena: options.arena, delay: String(options.delay), ...(options.section === null ? {} : { section: String(options.section) }) })}` : null;
  const resource = useEmbedResource(path, isBroadcastSnapshot, (_data, failures) => Math.min(15_000, 2200 * 2 ** Math.min(failures, 3)));
  useBroadcastLive(path ? Number(id) : null, resource.reload);
  useEffect(() => {
    document.documentElement.classList.add('broadcast-document');
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex'; document.head.appendChild(robots);
    return () => { document.documentElement.classList.remove('broadcast-document'); clearInterval(timer); robots.remove(); };
  }, []);
  const display = broadcastPresentation(resource.data, resource.updatedAt?.getTime() ?? clock, clock);
  const diagnosis = !path ? t('broadcast.invalid') : resource.error ? t('broadcast.stale')
    : resource.data?.hidden ? t('broadcast.hidden') : resource.data?.warmingUp ? t('broadcast.warming')
      : !display ? t('broadcast.waiting') : t('broadcast.delayStatus', { arena: options.arena, seconds: options.delay });
  return <main className={`bc-source${preview ? ' bc-preview' : ''}`} aria-label={t('broadcast.title')}>
    {preview && <p className="bc-diagnostic" role="status">{diagnosis}</p>}
    {display && <div className="bc-canvas" style={{ '--bc-background': display.background ?? '#0F1E3D', '--bc-accent': display.accent ?? '#F5B82E' } as CSSProperties}>
      {display.banner && <div className="bc-banner">{display.banner}</div>}
      {display.podium ? <section className="bc-card bc-podium">
        <header>{display.podium.sectionName}<small>{t(display.podium.champions ? 'broadcast.champions' : 'broadcast.prizes')}</small></header>
        {display.podium.places.map(place => <div className="bc-row" key={place.teamId}><b>{place.place}</b><span>{place.teamName}</span><strong>{place.points}</strong></div>)}
      </section> : display.score ? <section className="bc-card bc-score"><header>{display.score.raceName}<small>{display.score.heatLabel} · {t('broadcast.scores')}</small></header><Rows rows={display.score.rows} scores /></section>
        : display.current && <section className="bc-card bc-lineup"><header>{display.current.raceName ?? display.current.label}<small>{display.current.sectionName} · {display.current.label} · {t(display.current.started ? 'broadcast.inArena' : 'broadcast.nextArena')}</small></header>{display.card !== 'title' && <Rows rows={display.current.rows} />}</section>}
      {!display.podium && !display.score && display.standings.length > 0 && <section className="bc-card bc-standings"><header>{t('broadcast.standings')}<small>{display.current?.sectionName}</small></header>
        {display.standings.slice(0, display.toplistRows ?? 8).map(row => <div className="bc-row" key={row.teamId}><b>{row.place}{row.joint ? '=' : ''}</b><span>{row.teamName}</span><strong>{row.totalPoints}</strong></div>)}
      </section>}
      {display.next && <div className="bc-next">{t('broadcast.next')} · {display.next.sectionName} · {display.next.label}{display.next.raceName ? ` · ${display.next.raceName}` : ''}</div>}
      {display.sponsors.length > 0 && <div className="bc-sponsors">{display.sponsors.map(s => <span key={s.name}>{s.name}</span>)}</div>}
    </div>}
  </main>;
}
