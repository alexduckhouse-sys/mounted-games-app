import { useMemo, useState } from 'react';
import { api } from '../../../api';
import { broadcastSource } from '../../../lib/broadcast';
import type { CompetitionDetail } from '../../../types';
import { useT } from '../../../i18n/LanguageContext';

export function BroadcastSetup({ competition }: { competition: CompetitionDetail }) {
  const t = useT();
  const arenas = useMemo(() => [...new Set(competition.sessions.map(s => s.arenaName?.trim() || 'Arena 1'))], [competition.sessions]);
  const [pickedArena, setArena] = useState('');
  const arena = arenas.includes(pickedArena) ? pickedArena : arenas[0] ?? '';
  const [delay, setDelay] = useState(0);
  const [section, setSection] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const sections = competition.sections.filter(s => competition.sessions.some(x => (x.arenaName?.trim() || 'Arena 1') === arena && x.competitionSectionId === s.id));
  const selected = sections.some(s => s.id === section) ? section : null;
  const source = broadcastSource(competition.id, arena, delay, selected);
  const url = `${window.location.origin}${source}`;
  async function visibility(hidden: boolean) {
    setBusy(true); setMessage('');
    try { await api.put(`/competitions/${competition.id}/broadcast-snapshot/visibility`, { arena, hidden }); setMessage(t(hidden ? 'broadcast.hiddenConfirmed' : 'broadcast.showConfirmed')); }
    catch { setMessage(t('broadcast.failed')); }
    finally { setBusy(false); }
  }
  return <details className="sx-broadcast"><summary>{t('broadcast.title')}</summary>
    <p className="rf-note">{t('broadcast.instructions')}</p>
    <label className="sx-broadcast-row">{t('broadcast.arena')}<select value={arena} onChange={e => setArena(e.target.value)}>{arenas.map(a => <option key={a}>{a}</option>)}</select></label>
    <label className="sx-broadcast-row">{t('broadcast.section')}<select value={selected ?? ''} onChange={e => setSection(e.target.value ? Number(e.target.value) : null)}><option value="">{t('broadcast.follow')}</option>{sections.map(s => <option value={s.id} key={s.id}>{s.displayName || s.ageGroup}</option>)}</select></label>
    <label className="sx-broadcast-row">{t('broadcast.delay')}<input type="number" min={0} max={120} value={delay} onChange={e => setDelay(Math.min(120, Math.max(0, Math.round(Number(e.target.value) || 0))))} /></label>
    {arena ? <iframe title={t('broadcast.preview')} src={`${source}&preview=1`} className="sx-broadcast-preview" /> : <p className="rf-note">{t('broadcast.addArena')}</p>}
    <label className="sx-broadcast-url">{t('broadcast.url')}<input readOnly value={url} onFocus={e => e.target.select()} /></label>
    <div className="sx-chips"><button type="button" className="sx-btn" disabled={!arena} onClick={() => { if (!navigator.clipboard) { setMessage(t('broadcast.copyFailed')); return; } void navigator.clipboard.writeText(url).then(() => setMessage(t('broadcast.copied')), () => setMessage(t('broadcast.copyFailed'))); }}>{t('broadcast.copy')}</button>
      <button type="button" className="sx-btn" disabled={!arena || busy} onClick={() => void visibility(true)}>{t('broadcast.hide')}</button>
      <button type="button" className="sx-btn" disabled={!arena || busy} onClick={() => void visibility(false)}>{t('broadcast.show')}</button></div>
    {message && <p className="rf-note" role="status">{message}</p>}
  </details>;
}
