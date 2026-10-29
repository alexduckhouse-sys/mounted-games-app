import { tr } from '../../i18n/translate';
import { useState } from 'react';
import { api } from '../../api';
import { problemMessage } from '../../lib/apiError';
import { FormSheet, SheetField } from '../clubShop/ui';

export function SaveStartingPoint({ competitionId, competitionName }: { competitionId: number; competitionName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(competitionName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return <>
    <button type="button" className="rf-row w-full" onClick={() => { setError(null); setOpen(true); }}>{tr('completion.keepTemplate')}</button>
    {saved && <p className="rf-note" role="status">{tr('completion.templateAdded')}</p>}
    {open && <FormSheet title={tr('completion.keepTemplate')} description={tr('completion.keepTemplateScope')} canSave={Boolean(name.trim())} onClose={() => setOpen(false)} error={error} onSave={async () => {
      try { await api.post(`/competitions/${competitionId}/starting-points`, { name: name.trim() }); setSaved(true); return true; }
      catch (e) { setError(problemMessage(e, tr('completion.keepTemplateError'))); return false; }
    }}><SheetField label={tr('completion.templateName')}><input maxLength={100} value={name} onChange={e => setName(e.target.value)} /></SheetField></FormSheet>}
  </>;
}
