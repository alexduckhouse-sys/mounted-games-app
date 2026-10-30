import { useMemo, useState } from 'react';
import { api } from '../../../api';
import { broadcastSource } from '../../../lib/broadcast';
import type { CompetitionDetail } from '../../../types';
import { useT } from '../../../i18n/LanguageContext';
import { Stepper } from '../../admin/creator/controls';
import { RefineChoiceRow, RefineList, RefineNote, RefineSection } from '../../refine/Refine';

/** Longest delay the overlay link accepts (`broadcastOptions` in `lib/broadcast.ts`). */
const MAX_DELAY_SECONDS = 120;

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
  // Absolute, so it works pasted into OBS or vMix, which have no page to be relative to.
  const url = `${window.location.origin}${source}`;
  async function visibility(hidden: boolean) {
    setBusy(true); setMessage('');
    try { await api.put(`/competitions/${competition.id}/broadcast-snapshot/visibility`, { arena, hidden }); setMessage(t(hidden ? 'broadcast.hiddenConfirmed' : 'broadcast.showConfirmed')); }
    catch { setMessage(t('broadcast.failed')); }
    finally { setBusy(false); }
  }
  function copy() {
    if (!navigator.clipboard) { setMessage(t('broadcast.copyFailed')); return; }
    void navigator.clipboard.writeText(url).then(() => setMessage(t('broadcast.copied')), () => setMessage(t('broadcast.copyFailed')));
  }
  return <details className="sx-broadcast"><summary>{t('broadcast.title')}</summary>
    <RefineNote>{t('broadcast.instructions')}</RefineNote>
    <RefineList as="div" label={t('broadcast.title')}>
      {arenas.length > 1 && <RefineChoiceRow label={t('broadcast.arena')} value={arena} options={arenas.map(a => ({ value: a, label: a }))} onChange={setArena} />}
      <RefineChoiceRow label={t('broadcast.section')} value={selected === null ? '' : String(selected)}
        options={[{ value: '', label: t('broadcast.follow') }, ...sections.map(s => ({ value: String(s.id), label: s.displayName || s.ageGroup }))]}
        onChange={next => setSection(next ? Number(next) : null)} />
      <div className="rf-row">
        <span className="rf-grow rf-t1">{t('broadcast.delay')}</span>
        <Stepper name={t('broadcast.delay')} value={String(delay)} min={0} max={MAX_DELAY_SECONDS} step={5} onChange={setDelay} />
      </div>
    </RefineList>
    {arena ? <iframe title={t('broadcast.preview')} src={`${source}&preview=1`} className="sx-broadcast-preview" /> : <RefineNote>{t('broadcast.addArena')}</RefineNote>}
    <label className="sx-broadcast-url">{t('broadcast.url')}<input readOnly value={url} onFocus={e => e.target.select()} /></label>
    <div className="kit-acts">
      <button type="button" className="kit-pill kit-pill-fill" disabled={!arena} onClick={copy}>{t('broadcast.copy')}</button>
      <button type="button" className="kit-pill" disabled={!arena || busy} onClick={() => void visibility(true)}>{t('broadcast.hide')}</button>
      <button type="button" className="kit-pill" disabled={!arena || busy} onClick={() => void visibility(false)}>{t('broadcast.show')}</button>
    </div>
    {message && <p className="rf-note" role="status">{message}</p>}

    <RefineSection title={t('broadcast.howTo')} />
    <div className="sx-howto">
      <h3>{t('broadcast.obs')}</h3>
      <ol><li>{t('broadcast.obs1')}</li><li>{t('broadcast.obs2')}</li><li>{t('broadcast.obs3')}</li><li>{t('broadcast.obs4')}</li></ol>
      <h3>{t('broadcast.vmix')}</h3>
      <ol><li>{t('broadcast.vmix1')}</li><li>{t('broadcast.vmix2')}</li><li>{t('broadcast.vmix3')}</li></ol>
      <h3>{t('broadcast.delayHead')}</h3>
      <p>{t('broadcast.delayHow')}</p>
    </div>
  </details>;
}
