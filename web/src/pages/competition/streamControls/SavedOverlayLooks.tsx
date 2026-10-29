import { tr } from '../../../i18n/translate';
import { useEffect, useState } from 'react';
import { api } from '../../../api';
import { apiErrorMessage } from '../../../lib/apiError';
import { parseLook, type OverlayLook, type OverlayElement } from '../../../lib/overlays';
import { confirmDialog } from '../../../components/ConfirmDialog';
import { Notice } from '../../../components/Notice';
import { RefineChoiceRow } from '../../refine/Refine';
import { FormSheet, SheetField } from '../../clubShop/ui';

interface SavedLook { id: number; name: string; look: unknown; mine: boolean }

/** Store visual settings only; event selection, banners and live race choices stay with the current stream. */
export function SavedOverlayLooks({ look, apply }: { look: unknown; apply: (look: OverlayLook) => Promise<void> }) {
  const [list, setList] = useState<SavedLook[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SavedLook | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api.get<SavedLook[]>('/overlay-looks').then(({ data }) => { if (active) setList(Array.isArray(data) ? data.filter(l => l && Number.isInteger(l.id) && typeof l.name === 'string') : []); })
      .catch(() => { if (active) setError(tr('completion.loadLooks')); });
    return () => { active = false; };
  }, [revision]);
  async function remove(item: SavedLook) {
    if (!await confirmDialog({ title: tr('completion.deleteLookQ'), message: item.name, confirmLabel: tr('completion.deleteLook'), destructive: true })) return;
    try { await api.delete(`/overlay-looks/${item.id}`); setList(prev => prev.filter(l => l.id !== item.id)); setSelected(null); }
    catch (e) { setError(apiErrorMessage(e, tr('completion.deleteLookError'))); }
  }
  const preview = selected ? parseLook(selected.look) : null;
  return <div className="my-3">
    <h3 className="rf-t1">{tr('completion.looks')}</h3>
    {error && !editing && <Notice actionLabel={tr('completion.retry')} onAction={() => { setError(null); setRevision(n => n + 1); }}>{error}</Notice>}
    <RefineChoiceRow label={tr('completion.chooseLook')} value={selected ? String(selected.id) : ''} onChange={value => setSelected(list.find(l => l.id === Number(value)) ?? null)} options={[{ value: '', label: tr('completion.currentLook') }, ...list.map(l => ({ value: String(l.id), label: l.name + (l.mine ? '' : tr('completion.otherOrganiser')) }))]} />
    {selected && preview && <>
      <div aria-label={tr('completion.lookPreview')} className="my-2 rounded-lg p-3" style={{ background: preview.background, color: preview.accent }}><strong>{selected.name}</strong><p>{tr(`completion.look.${preview.size}`)} · {Object.entries(preview.elements).filter(([, value]) => value.show).map(([key]) => tr(`completion.look.${key as OverlayElement}`)).join(', ')}</p></div>
      <div className="et-actions"><button className="rf-btn" type="button" onClick={() => void apply(preview)}>{tr('completion.applyLook')}</button><button className="rf-btn" type="button" onClick={() => { setName(selected.name); setError(null); setEditing(true); }}>{tr('completion.rename')}</button><button className="kit-redtext" type="button" onClick={() => void remove(selected)}>{tr('completion.delete')}</button></div>
    </>}
    <button type="button" className="rf-row w-full" onClick={() => { setSelected(null); setName(''); setError(null); setEditing(true); }}>{tr('completion.addLook')}</button>
    {editing && <FormSheet title={selected ? tr('completion.renameLook') : tr('completion.keepLook')} onClose={() => setEditing(false)} error={error} canSave={Boolean(name.trim())} onSave={async () => {
      try {
        const body = { name: name.trim(), look: parseLook(selected ? selected.look : look) };
        const { data } = selected ? await api.put<SavedLook>(`/overlay-looks/${selected.id}`, body) : await api.post<SavedLook>('/overlay-looks', body);
        setList(prev => [...prev.filter(l => l.id !== data.id), data]); setSelected(null); return true;
      } catch (e) { setError(apiErrorMessage(e, tr('completion.keepLookError'))); return false; }
    }}><SheetField label={tr('completion.lookName')}><input value={name} maxLength={60} onChange={e => setName(e.target.value)} /></SheetField></FormSheet>}
  </div>;
}
