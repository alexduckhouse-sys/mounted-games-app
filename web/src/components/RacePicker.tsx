import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from 'lucide-react';
import {
  AREA_JUNIORS, AREA_PAIRS, AREA_SENIORS, defaultRaceList, SCOPE_LABEL,
  ZONE_JUNIORS, ZONE_PAIRS, ZONE_SENIORS, type RaceScope,
} from '../lib/defaultRaces';
import { loadRaceTemplates } from '../lib/raceTemplates';

const FALLBACK_RACES = Array.from(
  new Set([
    ...ZONE_SENIORS,
    ...ZONE_JUNIORS,
    ...ZONE_PAIRS,
    ...AREA_SENIORS,
    ...AREA_JUNIORS,
    ...AREA_PAIRS,
    '2 Flag',
    '2 Mug',
    '3 Mug',
    '4 Flag',
    '5 Cone',
    '5 Flag',
    '5 Mug',
    'Association',
    'Ball & Bucket',
    'Ball & Cone',
    'Ball & Racquet',
    'Ball & Socket',
    'Bank',
    'Bang-a-Balloon',
    'Bending',
    'Big Sack',
    'Bottle',
    'Bottle Shuttle',
    'Carton',
    'Flag Fliers',
    ' Groom',
    'Hi-Lo',
    'Hoopla',
    'Jousting',
    'Litter',
    'Milk Churn',
    'Mugs',
    'Nails',
    'Norman Patrick',
    'Old Sock',
    'Pony Express',
    'Pony Pairs',
    'Postman',
    'Pyramid',
    'Run & Ride',
    'Sack',
    'Speed Weavers',
    'Stepping Stones',
    'Sword',
    'Tool Box',
    'Two Flag',
    'Wash Day',
    'Windsor Castle',
  ].map((r) => r.trim()).filter(Boolean)),
).sort((a, b) => a.localeCompare(b));

function useOfficialRaceNames(providedTemplates?: string[]): string[] {
  const [loaded, setLoaded] = useState<string[]>([]);

  useEffect(() => {
    if (providedTemplates && providedTemplates.length > 0) return;
    let cancelled = false;
    loadRaceTemplates()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) {
          setLoaded(list.map((t) => t.name).filter(Boolean));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [providedTemplates]);

  return useMemo(() => {
    const combined = new Set<string>([
      ...FALLBACK_RACES,
      ...(providedTemplates ?? []),
      ...loaded,
    ]);
    return Array.from(combined).sort((a, b) => a.localeCompare(b));
  }, [providedTemplates, loaded]);
}

/**
 * Searchable single-race selector with a "+ Custom race…" option.
 * Used when adding a race, swapping/changing a race, or picking a run-off race.
 */
export function RaceSelect({
  label = 'Select race',
  ariaLabel,
  value = '',
  onSelect,
  onChange,
  templates,
  submitLabel = 'Add race',
  placeholder = 'Search races…',
  autoReset = false,
}: {
  label?: string;
  ariaLabel?: string;
  value?: string;
  onSelect?: (raceName: string) => void;
  onChange?: (raceName: string) => void;
  templates?: string[];
  submitLabel?: string;
  placeholder?: string;
  autoReset?: boolean;
}) {
  const notify = (nextRace: string) => {
    onSelect?.(nextRace);
    onChange?.(nextRace);
  };
  const allRaces = useOfficialRaceNames(templates);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>(() => {
    if (!value) return '';
    return allRaces.includes(value) ? value : '__custom__';
  });
  const [customName, setCustomName] = useState<string>(() => (value && !allRaces.includes(value) ? value : ''));
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    if (!(selected === '__custom__' && customName.trim() === value)) {
      setSelected(value ? (allRaces.includes(value) ? value : '__custom__') : '');
      setCustomName(value && !allRaces.includes(value) ? value : '');
    }
  } else if (selected === '__custom__' && value && allRaces.includes(value) && customName.trim() === value) {
    setSelected(value);
    setCustomName('');
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRaces;
    return allRaces.filter((r) => r.toLowerCase().includes(q));
  }, [allRaces, search]);

  const effectiveRace = selected === '__custom__' ? customName.trim() : selected.trim();

  function commit(nextRace: string) {
    const trimmed = nextRace.trim();
    if (!trimmed) return;
    notify(trimmed);
    if (autoReset) {
      setSelected('');
      setCustomName('');
      setSearch('');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="mg-field !min-h-11">
        <Search className="h-4 w-4 shrink-0 text-[rgb(var(--mg-muted))]" aria-hidden="true" />
        <input
          aria-label="Search race library"
          type="search"
          value={search}
          onChange={(e) => {
            const q = e.target.value;
            setSearch(q);
            const firstMatch = allRaces.find((r) => r.toLowerCase().includes(q.trim().toLowerCase()));
            if (q.trim() && selected !== '__custom__') {
              const match = firstMatch ?? '';
              setSelected(match);
              if (!autoReset) notify(match);
            }
          }}
          placeholder={placeholder}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="mg-field !min-h-11 min-w-[200px] flex-1">
          <span className="sr-only">{label}</span>
          <select
            aria-label={ariaLabel ?? label}
            value={selected}
            onChange={(e) => {
              const val = e.target.value;
              setSelected(val);
              if (!autoReset) notify(val === '__custom__' ? customName.trim() : val);
            }}
          >
            <option value="">Choose a race ({filtered.length} matching)…</option>
            {filtered.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
            <option value="__custom__">+ Custom race…</option>
          </select>
        </label>

        {autoReset && selected !== '__custom__' && (
          <button
            type="button"
            className="mg-btn mg-btn-secondary !min-h-11 !px-4 !text-sm"
            disabled={!effectiveRace}
            onClick={() => commit(effectiveRace)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {submitLabel}
          </button>
        )}
      </div>

      {selected === '__custom__' && (
        <div className="flex gap-2">
          <label className="mg-field !min-h-11 flex-1">
            <span className="sr-only">Custom race name</span>
            <input
              type="text"
              value={customName}
              placeholder="Type custom race name…"
              onChange={(e) => {
                setCustomName(e.target.value);
                if (!autoReset) {
                  notify(e.target.value.trim());
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit(customName);
                }
              }}
            />
          </label>
          {autoReset && (
            <button
              type="button"
              className="mg-btn mg-btn-secondary !min-h-11 !px-4 !text-sm"
              disabled={!customName.trim()}
              onClick={() => commit(customName)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {submitLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-race ordered list picker with searchable RaceSelect + Custom race option.
 * Replaces multiline textareas everywhere a session or finals race list is configured.
 */
export function RaceListPicker({
  races,
  onChange,
  templates,
  format,
  ageGroup,
  label = 'Races in running order',
  ariaLabel,
}: {
  races: string[];
  onChange: (next: string[]) => void;
  templates?: string[];
  format?: number;
  ageGroup?: string;
  label?: string;
  ariaLabel?: string;
}) {
  const move = (from: number, to: number) => {
    const next = [...races];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };

  const add = (name: string) => {
    onChange([...races, name]);
  };

  const remove = (idx: number) => {
    onChange(races.filter((_, i) => i !== idx));
  };

  return (
    <div className="flex flex-col gap-3">
      {format !== undefined && ageGroup !== undefined && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Standard lists">
          {(['Zone', 'Area'] as RaceScope[]).map((scope) => (
            <button
              key={scope}
              type="button"
              className="mg-btn mg-btn-secondary !min-h-10 !px-3 !text-xs"
              onClick={() => onChange(defaultRaceList(scope, format, ageGroup))}
            >
              Use {SCOPE_LABEL[scope]} list
            </button>
          ))}
        </div>
      )}

      <ol className="mg-card mg-list max-h-60 overflow-y-auto" aria-label={ariaLabel ?? label}>
        {races.length === 0 && (
          <li className="p-3 text-sm text-[rgb(var(--mg-muted))]">No races selected yet. Search and add races below.</li>
        )}
        {races.map((race, i) => (
          <li key={`${race}-${i}`} className="flex min-h-11 items-center gap-1 py-1 pl-3 pr-1">
            <span className="w-6 text-xs font-semibold tabular-nums text-[rgb(var(--mg-muted))]">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[rgb(var(--mg-heading))]">{race}</span>
            <button
              type="button"
              className="mg-icon-btn !h-9 !w-9 !border-0"
              aria-label={`Move ${race} up`}
              disabled={i === 0}
              onClick={() => move(i, i - 1)}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="mg-icon-btn !h-9 !w-9 !border-0"
              aria-label={`Move ${race} down`}
              disabled={i === races.length - 1}
              onClick={() => move(i, i + 1)}
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="mg-icon-btn !h-9 !w-9 !border-0"
              aria-label={`Remove ${race}`}
              onClick={() => remove(i)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ol>

      <RaceSelect
        label="Add race"
        templates={templates}
        submitLabel="Add"
        placeholder="Search races to add…"
        autoReset
        onSelect={add}
      />
    </div>
  );
}
