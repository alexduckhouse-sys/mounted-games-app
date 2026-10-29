import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n/LanguageContext';
import { formatTime } from '../lib/time';
import { upcomingHazard, type ForecastHour } from '../lib/weatherAlert';
import { WIND_FRESH_MS, windPrompt, type WindPrompt } from '../lib/windForecast';
import { RefineChoiceRow, RefineQty, RefineSwitchRow } from '../pages/refine/Refine';
import { useScoreOutbox } from '../offline/useScoreOutbox';
import { useNow } from '../hooks/useNow';
import type { CompetitionDetail } from '../types';
import { Sheet } from './Sheet';
import { RaceDiagram } from './RaceDiagram';

export interface WindSelection { sectionId: number; profileId: string; revision: number; eventLevel: string; publishedSpare: string; permittedRaces: string[]; venueNotes: string; reviewMph: number; officialReviewMph: number; venueLimitMph: number | null; adoptionConfirmed: boolean }
interface Profile { id: string; name: string; source: string; clause: string; authority: string; guidance: string }
interface Rules { profiles: Profile[]; selections: WindSelection[]; candidates: string[] }
interface Preview { fingerprint: string; profileId: string; authority: string; source: string; clause: string; races: { raceId: number; heat: string; before: string; after: string }[]; diagramJson: string; rules: string; equipment: string; canApply: boolean; blockedReason: string | null }
const defaults: WindSelection = { sectionId: 0, profileId: 'unverified', revision: 0, eventLevel: '', publishedSpare: '', permittedRaces: [], venueNotes: '', reviewMph: 25, officialReviewMph: 35, venueLimitMph: null, adoptionConfirmed: false };

export function WindReviewSheet({ competition, prompt, hours, reload, onClose, onSnooze }: {
  competition: CompetitionDetail; prompt: WindPrompt | null; hours: ForecastHour[] | null; reload: () => void; onClose: () => void; onSnooze?: () => void;
}) {
  const t = useT();
  const now = useNow(60_000).getTime();
  const outbox = useScoreOutbox();
  const [rules, setRules] = useState<Rules | null>(null);
  const [selection, setSelection] = useState<WindSelection>(defaults);
  const [permittedDraft, setPermittedDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [raceId, setRaceId] = useState('');
  const [replacement, setReplacement] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decision, setDecision] = useState('');
  const [equipment, setEquipment] = useState(false);
  const [official, setOfficial] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [arena, setArena] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const base = `/competitions/${competition.id}`;
  const sessions = competition.sessions.filter(s => s.status !== 2);
  const arenas = [...new Set(sessions.map(s => s.arenaName?.trim() ?? '').filter(Boolean))];
  const paused = sessions.filter(s => s.notes?.includes('[pausefor:wind]') && s.notes.includes('[paused:') && (!arena || s.arenaName === arena));
  const races = sessions.filter(s => !arena || s.arenaName === arena).flatMap(s => s.heats.flatMap(h => h.races.filter(r => !r.isComplete).map(r => ({ session: s, heat: h, race: r }))));
  const target = races.find(r => String(r.race.id) === raceId);
  const profile = rules?.profiles.find(p => p.id === selection.profileId);
  const hazard = hours ? upcomingHazard(hours, now) : null;
  const displayedPrompt = prompt ?? windPrompt(hours, now, null, 0, selection.officialReviewMph);
  const fresh = displayedPrompt && now - displayedPrompt.fetchedAt <= WIND_FRESH_MS;
  const pending = target && outbox.some(q => q.sessionId === target.session.id);

  useEffect(() => {
    let cancelled = false;
    api.get<Rules>(`${base}/wind-review/rules`).then(({ data }) => {
      if (!cancelled && Array.isArray(data.profiles) && Array.isArray(data.selections)) {
        setRules(data); setSelection(data.selections.find(s => s.sectionId === 0) ?? defaults); setPermittedDraft(null);
      }
    }).catch(() => { if (!cancelled) setError(t('wind.error')); });
    return () => { cancelled = true; };
  }, [base, t]);

  function changed() { setPreview(null); setEquipment(false); setDecision(''); setRequestId(crypto.randomUUID()); }
  async function save(next: WindSelection) {
    if (permittedDraft !== null) next = { ...next, permittedRaces: permittedDraft.split(',').map(name => name.trim()).filter(Boolean) };
    setPermittedDraft(null);
    setSelection(next); changed(); setBusy(true); setError('');
    try { const { data } = await api.put<WindSelection>(`${base}/wind-review/rules`, { ...next, expectedRevision: next.revision });
      window.dispatchEvent(new Event('mg:wind-review'));
      setSelection(data); setRules(old => old && { ...old, selections: [...old.selections.filter(s => s.sectionId !== data.sectionId), data] });
    } catch { setError(t('wind.error')); } finally { setBusy(false); }
  }
  async function action(run: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await run(); reload(); } catch { setError(t('wind.error')); } finally { setBusy(false); }
  }
  async function review() {
    if (!target) return;
    await action(async () => { const { data } = await api.post<Preview>(`${base}/wind-review/preview`, { sessionId: target.session.id, raceId: target.race.id, replacement }); setPreview(data); });
  }
  async function apply() {
    if (!preview || !target) return;
    await action(async () => { await api.post(`${base}/race-changes`, { sessionId: target.session.id, raceId: target.race.id, replacement,
      fingerprint: preview.fingerprint, requestId, authority: preview.authority, decision, equipmentConfirmed: equipment }); onClose(); });
  }
  const field = (label: string, value: string, onChange: (value: string) => void, onBlur?: () => void) => <label className="kit-sheet-field">{label}<input value={value} disabled={busy} onChange={e => onChange(e.target.value)} onBlur={onBlur} maxLength={1000} /></label>;

  return <Sheet title={t('wind.review')} onClose={onClose}>
    <p className="kit-sheet-text">{fresh ? `${t('wind.peak', { speed: Math.round(displayedPrompt.peakMph) })} · ${formatTime(new Date(displayedPrompt.startsAt))}–${formatTime(new Date(displayedPrompt.endsAt))} · ${t('wind.updated', { time: formatTime(new Date(displayedPrompt.fetchedAt)) })}` : t('wind.unavailable')}</p>
    <p className="kit-sheet-text">{t('wind.awareness')}</p>
    {hazard && <p className="kit-sheet-text">{t(hazard.kind === 'thunder' ? 'wind.alsoThunder' : 'wind.alsoRain')}</p>}
    {!!paused.length && <p className="kit-sheet-text">{t('wind.paused')}</p>}
    {arenas.length > 1 && <RefineChoiceRow label={t('wind.arena')} value={arena} options={[{ value: '', label: t('wind.allArenas') }, ...arenas.map(a => ({ value: a, label: a }))]} onChange={v => { setArena(v); changed(); }} />}
    {error && <p role="alert" className="kit-sheet-text">{error}</p>}
    {rules && <details><summary className="kit-sheet-text">{t('wind.rules')}</summary>
      <RefineChoiceRow label={t('wind.scope')} value={String(selection.sectionId)} options={[{ value: '0', label: t('wind.wholeEvent') }, ...competition.sections.map(s => ({ value: String(s.id), label: s.displayName }))]} onChange={v => { setSelection(rules.selections.find(s => s.sectionId === Number(v)) ?? { ...defaults, sectionId: Number(v) }); setPermittedDraft(null); changed(); }} disabled={busy} />
      <RefineChoiceRow label={t('wind.rulebook')} value={selection.profileId} options={rules.profiles.map(p => ({ value: p.id, label: p.name }))} onChange={v => void save({ ...selection, profileId: v, adoptionConfirmed: false })} disabled={busy} />
      {profile && <p className="kit-sheet-text">{profile.guidance} {profile.source && <a href={profile.source} target="_blank" rel="noreferrer">{profile.clause}</a>}</p>}
      {field(t('wind.eventLevel'), selection.eventLevel, v => setSelection({ ...selection, eventLevel: v }), () => void save(selection))}
      {field(t('wind.spare'), selection.publishedSpare, v => setSelection({ ...selection, publishedSpare: v }), () => void save(selection))}
      {field(t('wind.permitted'), permittedDraft ?? selection.permittedRaces.join(', '), setPermittedDraft, () => void save(selection))}
      <p className="kit-sheet-text">{rules.candidates.join(' · ')}</p>
      {field(t('wind.venueNotes'), selection.venueNotes, v => setSelection({ ...selection, venueNotes: v }), () => void save(selection))}
      <div className="rf-row"><span className="rf-grow">{t('wind.reviewSpeed')}</span><RefineQty name={t('wind.reviewSpeed')} value={selection.reviewMph} max={100} disabled={busy} onChange={v => void save({ ...selection, reviewMph: v })} /></div>
      <div className="rf-row"><span className="rf-grow">{t('wind.officialSpeed')}</span><RefineQty name={t('wind.officialSpeed')} value={selection.officialReviewMph} max={100} disabled={busy} onChange={v => void save({ ...selection, officialReviewMph: v })} /></div>
      {field(t('wind.venueLimit'), selection.venueLimitMph == null ? '' : String(selection.venueLimitMph), v => setSelection({ ...selection, venueLimitMph: v === '' ? null : Number(v) }), () => void save(selection))}
      <RefineSwitchRow label={t('wind.adopted')} on={selection.adoptionConfirmed} onChange={v => void save({ ...selection, adoptionConfirmed: v })} disabled={busy} />
    </details>}
    {selection.venueLimitMph != null && <p className="kit-sheet-text">{t('wind.limit', { speed: selection.venueLimitMph })}</p>}
    <details><summary className="kit-sheet-text">{t('wind.reviewRace')}</summary>
      <RefineChoiceRow label={t('wind.race')} value={raceId} options={[{ value: '', label: t('wind.chooseRace') }, ...races.map(r => ({ value: String(r.race.id), label: `${r.session.name} · ${r.heat.label ?? ''} · ${r.race.name}` }))]} onChange={v => { setRaceId(v); changed(); }} />
      {field(t('wind.replacement'), replacement, v => { setReplacement(v); changed(); })}
      {pending && <p className="kit-sheet-text">{t('wind.unsent')}</p>}
      <button className="kit-pill" disabled={busy || !raceId || !replacement.trim()} onClick={() => void review()}>{t('wind.preview')}</button>
      {preview && <><p className="kit-sheet-text">{preview.authority} · <a href={preview.source} target="_blank" rel="noreferrer">{preview.clause}</a></p>
        {preview.races.map(r => <p key={r.raceId} className="kit-sheet-text">{r.heat}: {r.before} → {r.after}</p>)}
        <p className="kit-sheet-text">{preview.rules}</p><RaceDiagram diagramJson={preview.diagramJson} /><p className="kit-sheet-text">{preview.equipment}</p>
        {preview.blockedReason && <p role="status" className="kit-sheet-text">{preview.blockedReason}</p>}
        {preview.canApply && <>{field(t('wind.decision'), decision, setDecision)}
          <RefineSwitchRow label={t('wind.equipmentReady')} on={equipment} onChange={setEquipment} />
          <button className="kit-pill kit-pill-fill" disabled={busy || !decision.trim() || !equipment} onClick={() => void apply()}>{t('wind.apply')}</button></>}
      </>}
    </details>
    <label className="kit-sheet-field">{t('wind.announcement')}<textarea maxLength={2000} value={announcement} onChange={e => setAnnouncement(e.target.value)} /></label>
    {!!paused.length && <RefineSwitchRow label={t('wind.officialResume')} on={official} onChange={setOfficial} />}
    <div className="kit-acts">
      <button className="kit-pill kit-pill-fill" disabled={busy || (!!paused.length && !official)} onClick={() => void action(async () => { await api.post(`${base}/sessions/${paused.length ? 'resume' : 'pause'}`, { arenaName: arena || undefined, reason: 'wind', announcement: announcement.trim() || undefined }); onClose(); })}>{t(paused.length ? 'wind.resume' : 'wind.pause')}</button>
      <button className="kit-pill" disabled={busy || !announcement.trim()} onClick={() => void action(async () => { await api.post(`${base}/sessions/weather-notice`, { body: announcement.trim() }); setAnnouncement(''); })}>{t('wind.tell')}</button>
      {fresh && <button className="kit-pill" disabled={busy} onClick={() => void action(async () => { await api.post(`${base}/wind-review/acknowledge`, { ...displayedPrompt, arena: arena || arenas.sort().join('|') }); window.dispatchEvent(new Event('mg:wind-review')); onClose(); })}>{t('wind.acknowledge')}</button>}
      {onSnooze && <button className="kit-pill" onClick={() => { onSnooze(); onClose(); }}>{t('common.notNow')}</button>}
    </div>
  </Sheet>;
}
