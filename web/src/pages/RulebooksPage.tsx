import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, Search } from 'lucide-react';
import { api } from '../api';
import { usePageHeader } from '../components/CompactPageBarContext';
import {
  fetchRaceTemplateByName,
  RaceRulebookSection,
  type RaceTemplateDetail,
} from '../components/RaceRulesSheet';
import { equipmentFromDiagram } from '../lib/raceEquipment';
import type { RaceTemplate } from '../types';

export function RulebooksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRace = searchParams.get('race')?.trim() ?? '';
  const [raceNames, setRaceNames] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');
  const [loadedRace, setLoadedRace] = useState<{ key: string; detail: RaceTemplateDetail | null } | null>(null);

  const activeKey = selectedRace.toLowerCase();
  const activeTemplate = loadedRace && loadedRace.key === activeKey ? loadedRace.detail : null;
  const loadingRace = Boolean(selectedRace && (!loadedRace || loadedRace.key !== activeKey));
  const loadingNames = raceNames === null;

  usePageHeader({
    title: selectedRace ? `${selectedRace} · Rules` : 'Race rules & setup',
    subtitle: 'EGUK · Pony Club · MGA · STRUK',
    backTo: '/',
    backLabel: 'Back',
    plain: true,
  });

  // Only fetch the lightweight race names list when needed to browse/switch races.
  useEffect(() => {
    if (raceNames !== null) return;
    let cancelled = false;
    api
      .get<string[]>('/race-templates/names')
      .then(async (res) => {
        if (!cancelled && Array.isArray(res.data)) {
          setRaceNames([...res.data].sort((a, b) => a.localeCompare(b)));
          return;
        }
        const fallback = await api.get<RaceTemplate[]>('/race-templates');
        if (!cancelled && Array.isArray(fallback.data)) {
          setRaceNames(fallback.data.map((r) => r.name).sort((a, b) => a.localeCompare(b)));
        } else if (!cancelled) {
          setRaceNames([]);
        }
      })
      .catch(async () => {
        try {
          const fallback = await api.get<RaceTemplate[]>('/race-templates');
          if (!cancelled && Array.isArray(fallback.data)) {
            setRaceNames(fallback.data.map((r) => r.name).sort((a, b) => a.localeCompare(b)));
          } else if (!cancelled) {
            setRaceNames([]);
          }
        } catch {
          if (!cancelled) setRaceNames([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [raceNames]);

  // Lazy-load ONLY the selected race's template & 4 rulebooks when clicked or opened via ?race=
  useEffect(() => {
    if (!selectedRace || !activeKey) return;
    let cancelled = false;
    fetchRaceTemplateByName(selectedRace).then((detail) => {
      if (!cancelled) setLoadedRace({ key: activeKey, detail });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedRace, activeKey]);

  const filteredNames = useMemo(() => {
    const list = raceNames ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((n) => n.toLowerCase().includes(q));
  }, [raceNames, search]);

  function chooseRace(name: string) {
    if (name) {
      setSearchParams({ race: name }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }

  const equipment = activeTemplate ? equipmentFromDiagram(activeTemplate.diagramJson) : [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 pt-2 pb-10">
      <h1 className="sr-only">{selectedRace ? `${selectedRace} rules and setup` : 'Race rules and setup'}</h1>

      {selectedRace ? (
        <div className="mg-card p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--mg-muted))]">
                {activeTemplate?.category ?? 'Mounted Games Race'}
              </div>
              <h2 className="mg-display text-2xl font-bold text-[rgb(var(--mg-heading))]">
                {activeTemplate?.name ?? selectedRace}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => chooseRace('')}
              className="mg-btn mg-btn-secondary !min-h-9 !px-3 !py-1 text-xs"
            >
              All races ({raceNames?.length || 'A–Z'})
            </button>
          </div>

          {loadingRace && !activeTemplate && (
            <p role="status" className="text-sm text-[rgb(var(--mg-muted))]">
              Loading rules for {selectedRace}…
            </p>
          )}

          {!loadingRace && !activeTemplate && (
            <p className="text-sm text-[rgb(var(--mg-muted))]">
              No rules found for &ldquo;{selectedRace}&rdquo;.
            </p>
          )}

          {activeTemplate && (
            <>
              {activeTemplate.summary && (
                <p className="text-sm text-[rgb(var(--mg-body))]">{activeTemplate.summary}</p>
              )}

              {equipment.length > 0 && (
                <div className="flex flex-wrap gap-1.5" aria-label="Equipment required">
                  {equipment.map((item) => (
                    <span
                      key={item.label}
                      className="inline-flex items-center gap-1 rounded-md bg-[rgb(var(--mg-subtle))] px-2 py-0.5 text-xs font-semibold text-[rgb(var(--mg-ink))]"
                    >
                      {item.count} × {item.label}
                    </span>
                  ))}
                </div>
              )}

              <RaceRulebookSection template={activeTemplate} showDiagram diagramHeight={220} />
            </>
          )}
        </div>
      ) : (
        <div className="mg-card p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-sm font-bold text-[rgb(var(--mg-heading))]">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              <span>Select a race to view its setup &amp; rulebooks (EGUK · Pony Club · MGA · STRUK)</span>
            </div>
          </div>

          <label className="mg-field !min-h-10">
            <Search className="h-4 w-4 shrink-0 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
            <span className="sr-only">Search races</span>
            <input
              type="search"
              placeholder="Search race name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>

          {loadingNames && (
            <p role="status" className="text-sm text-[rgb(var(--mg-muted))]">
              Loading race list…
            </p>
          )}

          <div className="grid gap-1.5 sm:grid-cols-2 md:grid-cols-3" role="list" aria-label="Races A to Z">
            {filteredNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => chooseRace(name)}
                className="flex items-center justify-between rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-subtle))] px-3 py-2 text-left text-sm font-semibold text-[rgb(var(--mg-ink))] transition hover:bg-[rgb(var(--mg-tint))]"
              >
                <span className="truncate">{name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default RulebooksPage;
