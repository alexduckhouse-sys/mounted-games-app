import { tr } from '../../../i18n/translate';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api';
import { problemMessage } from '../../../lib/apiError';
import { Notice } from '../../../components/Notice';
import { confirmDialog } from '../../../components/ConfirmDialog';
import { RefineDateTimeRow } from '../../refine/Refine';
import { FormSheet, SheetField } from '../../clubShop/ui';

interface StartingPoint { id: number; name: string; sections: number; sessions: number; isMine: boolean; ownerName?: string | null }

/** Templates hold setup only. Creation is explicit, so choosing a template never creates an event. */
export function SavedStartingPoints() {
  const navigate = useNavigate();
  const [list, setList] = useState<StartingPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StartingPoint | null>(null);
  const [name, setName] = useState('');
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api.get<StartingPoint[]>('/starting-points').then(({ data }) => {
      if (active) setList(Array.isArray(data) ? data.filter(p => p && Number.isInteger(p.id) && typeof p.name === 'string') : []);
    }).catch(() => { if (active) setError(tr('completion.loadTemplates')); });
    return () => { active = false; };
  }, [revision]);
  async function remove(point: StartingPoint) {
    if (!await confirmDialog({ title: tr('completion.deleteTemplateQ'), message: point.name, confirmLabel: tr('completion.deleteTemplate'), destructive: true })) return;
    try { await api.delete(`/starting-points/${point.id}`); setList(prev => prev.filter(p => p.id !== point.id)); }
    catch (e) { setError(problemMessage(e, tr('completion.deleteTemplateError'))); }
  }
  async function submit() {
    if (!selected) return false;
    setError(null);
    try {
      if (renaming) {
        await api.put(`/starting-points/${selected.id}`, { name: name.trim() });
        setList(prev => prev.map(p => p.id === selected.id ? { ...p, name: name.trim() } : p));
      } else {
        const { data } = await api.post<{ competitionId: number }>(`/starting-points/${selected.id}/competition`, { name: name.trim(), startDate: start, endDate: end });
        if (!Number.isInteger(data.competitionId)) throw new Error('Invalid competition response');
        navigate(`/admin/competitions/${data.competitionId}`);
      }
      return true;
    } catch (e) { setError(problemMessage(e, tr('completion.useTemplateError'))); return false; }
  }
  const validDates = start !== null && Number.isFinite(Date.parse(start)) && (!end || Number.isFinite(Date.parse(end)) && Date.parse(end) >= Date.parse(start));
  return <>
    <h3 className="cw-t1">{tr('completion.templates')}</h3>
    {error && !selected && <Notice actionLabel={tr('completion.retry')} onAction={() => { setError(null); setRevision(n => n + 1); }}>{error}</Notice>}
    {list.length === 0 && !error && <p className="cw-note">{tr('completion.templatesHint')}</p>}
    <div className="cw-card">{list.map(point => <div className="cw-row" key={point.id}>
      <button type="button" className="cw-grow text-left" onClick={() => { setSelected(point); setName(point.name); setRenaming(false); setError(null); }}><span className="cw-t1">{point.name}</span><span className="cw-t2">{tr('completion.templateCounts', { sections: point.sections, sessions: point.sessions })}{!point.isMine && point.ownerName ? ` · ${point.ownerName}` : ''}</span></button>
      <button type="button" className="rf-btn" onClick={() => { setSelected(point); setName(point.name); setRenaming(true); setError(null); }}>{tr('completion.rename')}</button>
      <button type="button" className="kit-redtext" onClick={() => void remove(point)}>{tr('completion.delete')}</button>
    </div>)}</div>
    {selected && <FormSheet title={renaming ? tr('completion.renameTemplate') : tr('completion.createTemplate')} saveLabel={renaming ? tr('completion.done') : tr('completion.createCompetition')} error={error} onClose={() => setSelected(null)} onSave={submit} canSave={Boolean(name.trim()) && (renaming || validDates)} description={renaming ? undefined : tr('completion.templateScope')}>
      <SheetField label={renaming ? tr('completion.templateName') : tr('completion.competitionName')}><input value={name} maxLength={100} onChange={e => setName(e.target.value)} /></SheetField>
      {!renaming && <><RefineDateTimeRow label={tr('completion.starts')} value={start} onChange={setStart} removable={false} /><RefineDateTimeRow label={tr('completion.ends')} value={end} onChange={setEnd} /><p className="rf-note">{tr('completion.checkTimetable')}</p></>}
    </FormSheet>}
  </>;
}
