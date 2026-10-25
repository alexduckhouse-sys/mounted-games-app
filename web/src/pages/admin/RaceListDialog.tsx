import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Search, Trash2, X } from 'lucide-react';
import { Dropdown } from '../../components/Dropdown';
import { SCOPE_LABEL, defaultRaceList, type RaceScope } from '../../lib/defaultRaces';

/** The races a session runs in each heat, in order: start from a standard list, then add, move or remove races. */
export function RaceListDialog({ title, races, format, ageGroup, templates, onSave, onClose }: {
  title: string;
  races: string[];
  format: number;
  ageGroup: string;
  /** Names of the races in the library, for adding one. */
  templates: string[];
  onSave: (races: string[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const [list, setList] = useState(races);
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState('');
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const move = (from: number, to: number) => setList((current) => {
    if (to < 0 || to >= current.length) return current;
    const next = [...current];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  });
  const add = (name: string) => {
    if (name === '__custom__') {
      customInputRef.current?.focus();
      return;
    }
    const trimmed = name.trim();
    if (trimmed) setList((current) => [...current, trimmed]);
  };

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = q ? templates.filter((name) => name.toLowerCase().includes(q)) : templates;
    return [
      ...matching.map((name) => ({ value: name, label: name })),
      { value: '__custom__', label: '+ Custom race…' },
    ];
  }, [templates, search]);

  return (
    <dialog ref={ref} onCancel={onClose} aria-label={title}
      className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl bg-[rgb(var(--mg-ground))] p-0 text-[rgb(var(--mg-ink))] shadow-xl backdrop:bg-[rgb(var(--mg-overlay)/0.55)]">
      <div className="skin flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <h2 className="mg-display min-w-0 flex-1 text-2xl font-bold leading-tight text-[rgb(var(--mg-heading))]">{title}</h2>
          <button type="button" onClick={onClose} className="mg-icon-btn" aria-label="Close without saving"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Standard lists">
          {(['Zone', 'Area'] as RaceScope[]).map((scope) => (
            <button key={scope} type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-sm" onClick={() => setList(defaultRaceList(scope, format, ageGroup))}>Use {SCOPE_LABEL[scope]} list</button>
          ))}
        </div>
        <ol className="mg-card mg-list" aria-label="Races in running order">
          {list.length === 0 && <li className="p-4 text-sm text-[rgb(var(--mg-muted))]">No races yet. Add one below.</li>}
          {list.map((race, i) => (
            <li key={`${race}-${i}`} className="flex min-h-12 items-center gap-1 py-1 pl-3 pr-1">
              <span className="w-6 text-sm tabular-nums text-[rgb(var(--mg-muted))]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{race}</span>
              <button type="button" className="mg-icon-btn !border-0" aria-label={`Move ${race} up`} disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp className="h-4 w-4" /></button>
              <button type="button" className="mg-icon-btn !border-0" aria-label={`Move ${race} down`} disabled={i === list.length - 1} onClick={() => move(i, i + 1)}><ArrowDown className="h-4 w-4" /></button>
              <button type="button" className="mg-icon-btn !border-0" aria-label={`Remove ${race}`} onClick={() => setList((current) => current.filter((_, index) => index !== i))}><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-2">
          <label className="mg-field !min-h-11">
            <Search className="h-4 w-4 shrink-0 text-[rgb(var(--mg-muted))]" aria-hidden="true" />
            <span className="sr-only">Search race library</span>
            <input type="search" value={search} placeholder="Search races…" onChange={(e) => setSearch(e.target.value)} />
          </label>
          <Dropdown label="Add a race from the library" value="" options={filteredTemplates} onChange={add}
            buttonClassName="flex min-h-12 w-full items-center gap-2 rounded-[10px] border-[1.5px] border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] px-3 text-left text-[15px] font-semibold text-[rgb(var(--mg-heading))]">
            <Plus className="h-4 w-4" aria-hidden="true" />Add a race from the library
          </Dropdown>
          <div className="flex gap-2">
            <label className="mg-field !min-h-12 flex-1"><span className="sr-only">Race name</span>
              <input ref={customInputRef} value={custom} placeholder="Or type a race name" onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(custom); setCustom(''); } }} />
            </label>
            <button type="button" className="mg-btn mg-btn-secondary !min-h-12 !px-4" disabled={!custom.trim()} onClick={() => { add(custom); setCustom(''); }}>Add</button>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="mg-btn mg-btn-secondary !min-h-12" onClick={onClose}>Cancel</button>
          <button type="button" className="mg-btn mg-btn-primary !min-h-12" disabled={list.length === 0} onClick={() => onSave(list)}>Save race list</button>
        </div>
      </div>
    </dialog>
  );
}
