import { useEffect, useState } from 'react';
import { api } from '../../api';
import { parseLook, type OverlayLook } from '../../lib/overlays';
import { SelectField } from '../../components/SelectField';
import { confirmDialog } from '../../components/ConfirmDialog';

interface SavedLook { id: number; name: string; look: OverlayLook; mine: boolean }

function parseLooks(raw: unknown): SavedLook[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const l = item as Record<string, unknown>;
    return typeof l?.id === 'number' && typeof l.name === 'string'
      ? [{ id: l.id, name: l.name, look: parseLook(l.look), mine: l.mine === true }]
      : [];
  });
}

/**
 * Looks saved once and reused across events, e.g. "EGUK Champs". Applying one copies it into this event's
 * draft (saved with "Save for this event"), so changing a saved look later never alters past events.
 */
export function SavedLooks({ current, onApply, onError }: { current: OverlayLook; onApply: (look: OverlayLook) => void; onError: (message: string) => void }) {
  const [looks, setLooks] = useState<SavedLook[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = looks.find((l) => l.id === selected) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    api.get<unknown>('/overlay-looks', { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setLooks(parseLooks(data)); })
      .catch(() => { /* no saved looks to offer this time */ });
    return () => controller.abort();
  }, []);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try { await work(); } catch { onError('Couldn’t save the look. Check your connection and try again.'); } finally { setBusy(false); }
  }

  const saveNew = () => run(async () => {
    const { data } = await api.post<unknown>('/overlay-looks', { name: name.trim(), look: current });
    const [created] = parseLooks([data]);
    if (created) { setLooks((all) => [...all, created].sort((a, b) => a.name.localeCompare(b.name))); setSelected(created.id); }
    setName('');
  });
  const update = () => run(async () => {
    await api.put(`/overlay-looks/${chosen!.id}`, { name: chosen!.name, look: current });
    setLooks((all) => all.map((l) => (l.id === chosen!.id ? { ...l, look: current } : l)));
  });
  const remove = async () => { if (!(await confirmDialog({ title: 'Delete this look?', message: `Delete the look “${chosen?.name ?? ''}”?`, confirmLabel: 'Delete look', destructive: true }))) return; return run(async () => {
    await api.delete(`/overlay-looks/${chosen!.id}`);
    setLooks((all) => all.filter((l) => l.id !== chosen!.id));
    setSelected(null);
  }); };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm" role="group" aria-label="Reusable looks">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">Saved looks
          <SelectField value={selected ?? ''} onChange={(event) => setSelected(event.target.value ? Number(event.target.value) : null)}>
            <option value="">{looks.length ? 'Choose a look' : 'None saved yet'}</option>
            {looks.map((l) => <option key={l.id} value={l.id}>{l.name}{l.mine ? '' : ' (shared)'}</option>)}
          </SelectField>
        </label>
        <button type="button" className="mg-btn mg-btn-secondary !min-h-9" disabled={!chosen} onClick={() => chosen && onApply(chosen.look)}>Use for this event</button>
        <button type="button" className="mg-btn mg-btn-secondary !min-h-9" disabled={!chosen || busy} onClick={() => void update()}>Update saved look</button>
        <button type="button" className="mg-btn mg-btn-secondary !min-h-9" disabled={!chosen?.mine || busy} onClick={() => void remove()}>Delete</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="mg-field flex-1">
          <span className="sr-only">New look name</span>
          <input value={name} maxLength={60} placeholder="Name, e.g. EGUK Champs" onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="button" className="mg-btn mg-btn-secondary !min-h-9" disabled={!name.trim() || busy} onClick={() => void saveNew()}>Save as look</button>
      </div>
    </div>
  );
}
