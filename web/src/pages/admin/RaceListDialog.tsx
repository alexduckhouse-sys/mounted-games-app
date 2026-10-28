import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2, X } from 'lucide-react';
import { Dropdown } from '../../components/Dropdown';
import { GripButton } from '../../components/GripButton';
import { useRowDrag } from '../../hooks/useRowDrag';
import { moveItem } from '../../lib/creatorRaces';
import { defaultRaceList, type RaceScope } from '../../lib/defaultRaces';
import { useLanguage } from '../../i18n/LanguageContext';

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
  const { t } = useLanguage();
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

  const { grab, keys, lifted, rowStyle } = useRowDrag();
  const onMove = (from: number, to: number) => setList((current) => moveItem(current, from, to));
  // A race name can be in the list twice, so a row's key counts the ones before it.
  const seen = new Map<string, number>();
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
      { value: '__custom__', label: t('admin.format.dialog.custom') },
    ];
  }, [templates, search, t]);

  return (
    <dialog ref={ref} onCancel={onClose} aria-label={title}
      className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl bg-[rgb(var(--mg-ground))] p-0 text-[rgb(var(--mg-ink))] shadow-xl backdrop:bg-[rgb(var(--mg-overlay)/0.55)]">
      <div className="skin flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <h2 className="mg-display min-w-0 flex-1 text-2xl font-bold leading-tight text-[rgb(var(--mg-heading))]">{title}</h2>
          <button type="button" onClick={onClose} className="mg-icon-btn" aria-label={t('admin.format.dialog.close')}><X className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('admin.format.dialog.standardLists')}>
          {(['Zone', 'Area'] as RaceScope[]).map((scope) => (
            <button key={scope} type="button" className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-sm" onClick={() => setList(defaultRaceList(scope, format, ageGroup))}>{t('admin.format.dialog.useList', { scope: t(scope === 'Zone' ? 'admin.format.dialog.scope.Zone' : 'admin.format.dialog.scope.Area') })}</button>
          ))}
        </div>
        <ol className="mg-card mg-list" data-row-list="" aria-label={t('admin.format.dialog.inOrder')}>
          {list.length === 0 && <li className="p-4 text-sm text-[rgb(var(--mg-muted))]">{t('admin.format.dialog.empty')}</li>}
          {list.map((race, i) => {
            const nth = seen.get(race) ?? 0;
            seen.set(race, nth + 1);
            return (
              <li key={`${race}-${nth}`} data-race-row="" data-lifted={lifted(i)} style={rowStyle(i)} className="flex min-h-12 items-center gap-1 py-1 pl-1 pr-1">
                <GripButton label={t('admin.format.dialog.move', { race })} onPointerDown={(e) => grab(e, i, list.length, onMove)} onKeyDown={(e) => keys(e, i, list.length, onMove)} />
                <span className="w-6 text-sm tabular-nums text-[rgb(var(--mg-muted))]">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{race}</span>
                <button type="button" className="mg-icon-btn !border-0" aria-label={t('admin.format.dialog.remove', { race })} onClick={() => setList((current) => current.filter((_, index) => index !== i))}><Trash2 className="h-4 w-4" /></button>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-col gap-2">
          <label className="mg-field !min-h-11">
            <Search className="h-4 w-4 shrink-0 text-[rgb(var(--mg-muted))]" aria-hidden="true" />
            <span className="sr-only">{t('admin.format.dialog.searchLibrary')}</span>
            <input type="search" value={search} placeholder={t('admin.format.dialog.searchPlaceholder')} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <Dropdown label={t('admin.format.dialog.addFromLibrary')} value="" options={filteredTemplates} onChange={add}
            buttonClassName="flex min-h-12 w-full items-center gap-2 rounded-[10px] border-[1.5px] border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] px-3 text-left text-[15px] font-semibold text-[rgb(var(--mg-heading))]">
            <Plus className="h-4 w-4" aria-hidden="true" />{t('admin.format.dialog.addFromLibrary')}
          </Dropdown>
          <div className="flex gap-2">
            <label className="mg-field !min-h-12 flex-1"><span className="sr-only">{t('admin.format.dialog.raceName')}</span>
              <input ref={customInputRef} value={custom} placeholder={t('admin.format.dialog.typeName')} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(custom); setCustom(''); } }} />
            </label>
            <button type="button" className="mg-btn mg-btn-secondary !min-h-12 !px-4" disabled={!custom.trim()} onClick={() => { add(custom); setCustom(''); }}>{t('admin.format.dialog.add')}</button>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="mg-btn mg-btn-secondary !min-h-12" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="mg-btn mg-btn-primary !min-h-12" disabled={list.length === 0} onClick={() => onSave(list)}>{t('admin.format.dialog.save')}</button>
        </div>
      </div>
    </dialog>
  );
}
