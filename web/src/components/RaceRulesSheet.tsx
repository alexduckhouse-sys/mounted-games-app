/* eslint-disable react-refresh/only-export-components */
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, X } from 'lucide-react';
import { api } from '../api';
import { equipmentFromDiagram } from '../lib/raceEquipment';
import type { RaceTemplate } from '../types';
import { RaceDiagram } from './RaceDiagram';

export const GOVERNING_BODIES = ['EGUK', 'Pony Club', 'MGA', 'STRUK'] as const;
export type GoverningBody = (typeof GOVERNING_BODIES)[number];

export interface GoverningBodyRulebook {
  body: GoverningBody;
  title: string;
  edition: string;
  equipment: string;
  setup: string;
  howToRide: string;
  penalties: string;
  rulesText: string;
}

export interface RaceTemplateDetail extends RaceTemplate {
  rulebooks?: GoverningBodyRulebook[];
}

const raceDetailCache = new Map<string, Promise<RaceTemplateDetail | null>>();

export function clearRaceDetailCache() {
  raceDetailCache.clear();
}

export function normaliseBodyName(body: string): GoverningBody {
  const upper = body.trim().toUpperCase();
  if (upper === 'EGUK') return 'EGUK';
  if (upper === 'PONY CLUB' || upper === 'PC' || upper === 'PCUK') return 'Pony Club';
  if (upper === 'MGA' || upper === 'IMGA') return 'MGA';
  if (upper === 'STRUK') return 'STRUK';
  return 'EGUK';
}

export function buildRaceRulebooks(template: RaceTemplateDetail | RaceTemplate): GoverningBodyRulebook[] {
  const existing = new Map<GoverningBody, GoverningBodyRulebook>();
  if ('rulebooks' in template && Array.isArray(template.rulebooks)) {
    for (const rb of template.rulebooks) {
      if (!rb || typeof rb.body !== 'string') continue;
      const key = normaliseBodyName(rb.body);
      existing.set(key, { ...rb, body: key });
    }
  }

  const eqItems = equipmentFromDiagram(template.diagramJson);
  const equipmentStr = eqItems.length > 0
    ? `Per lane: ${eqItems.map((it) => `${it.count} × ${it.label}`).join(', ')}`
    : `Per lane: standard setup for ${template.name}.`;
  const rulesText = (template.rules?.trim() || `Standard mounted games rules apply for ${template.name}.`);
  const firstSentence = rulesText.split(/(?<=[.!?])\s+|\n+/)[0] ?? rulesText;

  const defaults: Record<GoverningBody, GoverningBodyRulebook> = {
    EGUK: {
      body: 'EGUK',
      title: `EGUK — ${template.name}`,
      edition: 'Equestrian Games UK Rulebook 2026',
      equipment: equipmentStr,
      setup: `${firstSentence} Poles P1–P5 are spaced 6 m apart (P1–P4 before the 27 m Changeover line; P5 at 30 m and far-end props beyond the Changeover line).`,
      howToRide: rulesText,
      penalties: 'Knocked poles, cones or props must be replaced by the rider responsible before continuing from where the fault occurred. Handovers must take place behind the Start/Finish or Changeover line with all four hooves across.',
      rulesText,
    },
    'Pony Club': {
      body: 'Pony Club',
      title: `Pony Club — ${template.name}`,
      edition: 'The Pony Club Mounted Games Rulebook 2026',
      equipment: equipmentStr,
      setup: `${firstSentence} First pole 14 m from the Start/Finish Line, poles 7–9 m apart, with the 5th pole and changeover-end containers/tables positioned 3 m beyond the Changeover Line.`,
      howToRide: rulesText,
      penalties: 'Ponies must be led by the near rein when dismounted. Any misplaced or dropped equipment must be corrected by the rider concerned from the point of error before the next rider crosses the line.',
      rulesText,
    },
    MGA: {
      body: 'MGA',
      title: `MGA — ${template.name}`,
      edition: 'Mounted Games Association (IMGA) Rulebook 2026',
      equipment: equipmentStr,
      setup: `${firstSentence} Standard international arena layout: Start/Finish at 0 m, P1–P5 evenly spaced every 6 m (6 m, 12 m, 18 m, 24 m, 30 m), Changeover line at 27 m, and P5 / far-end equipment beyond the Changeover line.`,
      howToRide: rulesText,
      penalties: 'Under MGA/IMGA rules, all four hooves must cross the Start/Finish or Changeover line before handover or collection beyond the line. Uncorrected faults result in elimination.',
      rulesText,
    },
    STRUK: {
      body: 'STRUK',
      title: `STRUK — ${template.name}`,
      edition: 'Sporting Track Riding UK Rulebook 2026',
      equipment: equipmentStr,
      setup: `${firstSentence} STRUK lane grid uses evenly spaced poles P1–P4 in the main lane with P5 and changeover-end equipment (bins, tables, cartons, flag cones) beyond the Changeover line.`,
      howToRide: rulesText,
      penalties: 'Riders must complete all equipment placements upright and in sequence before the incoming rider crosses the Start/Finish Line. Faults must be rectified immediately by the active rider.',
      rulesText,
    },
  };

  return GOVERNING_BODIES.map((body) => existing.get(body) ?? defaults[body]);
}

export async function fetchRaceTemplateByName(
  raceName: string,
  fallback?: RaceTemplate | null,
): Promise<RaceTemplateDetail | null> {
  const key = raceName.trim().toLowerCase();
  if (!key) return null;
  const cached = raceDetailCache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<RaceTemplateDetail | null> => {
    try {
      const res = await api.get<RaceTemplateDetail>(`/race-templates/by-name/${encodeURIComponent(raceName.trim())}`);
      if (res?.data && typeof res.data.name === 'string') {
        return {
          ...res.data,
          rulebooks: buildRaceRulebooks(res.data),
        };
      }
    } catch {
      // Fallback to provided template or list lookup if /by-name/ fails
    }
    if (fallback) {
      return { ...fallback, rulebooks: buildRaceRulebooks(fallback) };
    }
    try {
      const listRes = await api.get<RaceTemplate[]>('/race-templates');
      const found = Array.isArray(listRes?.data)
        ? listRes.data.find((t) => t.name.trim().toLowerCase() === key) ?? null
        : null;
      return found ? { ...found, rulebooks: buildRaceRulebooks(found) } : null;
    } catch {
      raceDetailCache.delete(key);
      return null;
    }
  })();

  raceDetailCache.set(key, promise);
  return promise;
}

export function RaceRulebookSection({
  template,
  showDiagram = false,
  diagramHeight = 180,
}: {
  template: RaceTemplateDetail | RaceTemplate;
  showDiagram?: boolean;
  diagramHeight?: number;
}) {
  const [activeBody, setActiveBody] = useState<GoverningBody>('EGUK');
  const rulebooks = buildRaceRulebooks(template);
  const current = rulebooks.find((r) => r.body === activeBody) ?? rulebooks[0];

  return (
    <div className="mt-3 space-y-3" aria-label={`Rulebooks for ${template.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-bold text-[rgb(var(--mg-heading))]">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          <span>Rulebooks · {template.name}</span>
        </div>
        <div role="tablist" aria-label="Rulebook governing body" className="flex flex-wrap gap-1.5">
          {GOVERNING_BODIES.map((body) => {
            const selected = activeBody === body;
            return (
              <button
                key={body}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveBody(body)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  selected
                    ? 'bg-[rgb(var(--mg-button))] text-[rgb(var(--mg-button-ink))]'
                    : 'bg-[rgb(var(--mg-subtle))] text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-tint))]'
                }`}
              >
                {body}
              </button>
            );
          })}
        </div>
      </div>

      {showDiagram && template.diagramJson && (
        <div className="overflow-hidden rounded-lg border border-[rgb(var(--mg-rule))]">
          <RaceDiagram diagramJson={template.diagramJson} height={diagramHeight} />
        </div>
      )}

      <div
        role="tabpanel"
        aria-label={`${current.body} rules`}
        className="rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-subtle))] p-3 space-y-2.5 text-sm"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-1 border-b border-[rgb(var(--mg-rule-soft))] pb-2">
          <div className="font-bold text-[rgb(var(--mg-heading))]">{current.title}</div>
          <span className="text-xs text-[rgb(var(--mg-muted))]">{current.edition}</span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-[rgb(var(--mg-muted))]">Equipment</div>
            <p className="text-[rgb(var(--mg-body))]">{current.equipment}</p>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-[rgb(var(--mg-muted))]">Arena setup</div>
            <p className="text-[rgb(var(--mg-body))]">{current.setup}</p>
          </div>
        </div>

        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-[rgb(var(--mg-muted))]">How the race is ridden</div>
          <p className="whitespace-pre-wrap text-[rgb(var(--mg-body))]">{current.howToRide}</p>
        </div>

        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-[rgb(var(--mg-muted))]">Rules &amp; penalties</div>
          <p className="text-[rgb(var(--mg-body))]">{current.penalties}</p>
        </div>
      </div>
    </div>
  );
}

export function RaceRulesSheet({
  raceName,
  open,
  onClose,
}: {
  raceName: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const [loaded, setLoaded] = useState<{ key: string; detail: RaceTemplateDetail | null } | null>(null);
  const activeKey = raceName?.trim().toLowerCase() ?? '';
  const template = loaded && loaded.key === activeKey ? loaded.detail : null;
  const loading = Boolean(open && activeKey && (!loaded || loaded.key !== activeKey));

  useEffect(() => {
    if (!open || !raceName || !activeKey) return;
    let cancelled = false;
    fetchRaceTemplateByName(raceName).then((res) => {
      if (!cancelled) setLoaded({ key: activeKey, detail: res });
    });
    return () => {
      cancelled = true;
    };
  }, [open, raceName, activeKey]);

  if (!open || !raceName) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-[rgb(var(--mg-surface))] p-4 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={titleId} className="mg-display text-xl font-bold text-[rgb(var(--mg-heading))]">
            {template?.name ?? raceName}
          </h2>
          <button
            type="button"
            className="mg-icon-btn"
            aria-label="Close rules"
            onClick={onClose}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {loading && !template && <p role="status" className="text-sm text-[rgb(var(--mg-muted))]">Loading race rules…</p>}
        {!loading && !template && <p className="text-sm text-[rgb(var(--mg-muted))]">No rules have been added for this race yet.</p>}
        {template && (
          <div className="space-y-3">
            {template.summary && <p className="text-sm text-[rgb(var(--mg-body))]">{template.summary}</p>}
            <RaceRulebookSection template={template} showDiagram diagramHeight={180} />
            <div className="flex justify-end pt-1">
              <Link
                to={`/rulebooks?race=${encodeURIComponent(template.name)}`}
                onClick={onClose}
                className="mg-text-link text-xs"
              >
                Open race rulebook page
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
