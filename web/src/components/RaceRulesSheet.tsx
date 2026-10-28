/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { api } from '../api';
import { equipmentFromDiagram } from '../lib/raceEquipment';
import { findRaceTemplate } from '../lib/raceTemplates';
import type { RaceTemplate, SectionFormat } from '../types';
import { Notice } from './Notice';
import { RaceDiagram } from './RaceDiagram';
import { DropdownRow } from './DropdownRow';
import { Sheet } from './Sheet';

import { useT } from '../i18n/LanguageContext';

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

/** The edition shown for a governing body whose own rules have not been added. It says nothing a reader can use, so it is not shown. */
export const UNVERIFIED_EDITION = 'App race guide · body-specific rules not verified';

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

  return GOVERNING_BODIES.map((body) => existing.get(body) ?? {
    body,
    title: `${body} — ${template.name}`,
    edition: UNVERIFIED_EDITION,
    equipment: equipmentStr,
    setup: firstSentence,
    howToRide: rulesText,
    penalties: `Standard mounted games fault rules apply: knocked-over props or poles must be replaced upright before finishing, and handovers take place behind the line. Check the event's published ${body} rulebook with the organiser for any local variations.`,
    rulesText,
  });
}

/** A race's rules for a section of this format: its Pairs or Individual version when the library has one. */
export async function fetchRaceTemplateByName(
  raceName: string,
  fallback?: RaceTemplate | null,
  format?: SectionFormat | null,
): Promise<RaceTemplateDetail | null> {
  const name = raceName.trim().toLowerCase();
  if (!name) return null;
  const variant = format === 1 || format === 3 ? format : null;
  const key = variant ? `${name}|${variant}` : name;
  const cached = raceDetailCache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<RaceTemplateDetail | null> => {
    try {
      const url = `/race-templates/by-name/${encodeURIComponent(raceName.trim())}`;
      const res = variant
        ? await api.get<RaceTemplateDetail>(url, { params: { format: variant } })
        : await api.get<RaceTemplateDetail>(url);
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
        ? findRaceTemplate(listRes.data, raceName, variant)
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
  fitDiagram = false,
  picker = 'tabs',
}: {
  template: RaceTemplateDetail | RaceTemplate;
  showDiagram?: boolean;
  diagramHeight?: number;
  /** Size the diagram to its own shape instead of `diagramHeight`, so it has no empty bars on a phone. */
  fitDiagram?: boolean;
  /** How the rulebook is chosen: a row of small tabs (pages) or one settings row (the sheet, where tabs are too small to tap). */
  picker?: 'tabs' | 'row';
}) {
  const t = useT();
  const [activeBody, setActiveBody] = useState<GoverningBody>('EGUK');
  const rulebooks = buildRaceRulebooks(template);
  const current = rulebooks.find((r) => r.body === activeBody) ?? rulebooks[0];

  return (
    <div className="mt-3 space-y-3" aria-label={t('competition.rules.rulebooksFor', { name: template.name })}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-bold text-[rgb(var(--mg-heading))]">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          <span>{t('competition.rules.rulebooks', { name: template.name })}</span>
        </div>
        {picker === 'tabs' && (
          <div role="tablist" aria-label={t('competition.rules.body')} className="flex flex-wrap gap-1.5">
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
        )}
      </div>
      {picker === 'row' && (
        <DropdownRow
          label={t('competition.rules.rulebook')}
          value={activeBody}
          options={GOVERNING_BODIES.map((body) => ({ value: body, label: body }))}
          onChange={(body) => setActiveBody(body as GoverningBody)}
        />
      )}

      {showDiagram && template.diagramJson && (
        <div className="overflow-hidden rounded-lg border border-[rgb(var(--mg-rule))]">
          <RaceDiagram drop fit={fitDiagram} diagramJson={template.diagramJson} height={diagramHeight} />
        </div>
      )}

      <div
        role={picker === 'tabs' ? 'tabpanel' : 'group'}
        aria-label={t('competition.rules.bodyRules', { body: current.body })}
        className="rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-subtle))] p-3 space-y-2.5 text-sm"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-1 border-b border-[rgb(var(--mg-rule-soft))] pb-2">
          <div className="font-bold text-[rgb(var(--mg-heading))]">{current.title}</div>
          {current.edition !== UNVERIFIED_EDITION && <span className="text-xs text-[rgb(var(--mg-muted))]">{current.edition}</span>}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-[rgb(var(--mg-muted))]">{t('competition.rules.equipment')}</div>
            <p className="text-[rgb(var(--mg-body))]">{current.equipment}</p>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-[rgb(var(--mg-muted))]">{t('competition.rules.setup')}</div>
            <p className="text-[rgb(var(--mg-body))]">{current.setup}</p>
          </div>
        </div>

        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-[rgb(var(--mg-muted))]">{t('competition.rules.howRidden')}</div>
          <p className="whitespace-pre-wrap text-[rgb(var(--mg-body))]">{current.howToRide}</p>
        </div>

        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-[rgb(var(--mg-muted))]">{t('competition.rules.penalties')}</div>
          <p className="text-[rgb(var(--mg-body))]">{current.penalties}</p>
        </div>
      </div>
    </div>
  );
}

export function RaceRulesSheet({
  raceName,
  format,
  open,
  onClose,
}: {
  raceName: string | null;
  /** The section's format: Pairs and Individual sections read their own version of the race. */
  format?: SectionFormat | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [loaded, setLoaded] = useState<{ key: string; detail: RaceTemplateDetail | null } | null>(null);
  const activeKey = raceName ? `${raceName.trim().toLowerCase()}|${format ?? ''}` : '';
  const template = loaded && loaded.key === activeKey ? loaded.detail : null;
  const loading = Boolean(open && activeKey && (!loaded || loaded.key !== activeKey));

  useEffect(() => {
    if (!open || !raceName || !activeKey) return;
    let cancelled = false;
    fetchRaceTemplateByName(raceName, null, format).then((res) => {
      if (!cancelled) setLoaded({ key: activeKey, detail: res });
    });
    return () => {
      cancelled = true;
    };
  }, [open, raceName, format, activeKey]);

  if (!open || !raceName) return null;

  return (
    <Sheet title={template?.name ?? raceName} className="rules-sheet" onClose={onClose}>
      {({ close }) => (
        <>
          {/* Pinned with the title: the rules scroll underneath, the way out never does. */}
          <button type="button" className="rules-sheet-close" aria-label={t('competition.rules.close')} onClick={() => close()}>
            <X className="h-5 w-5" aria-hidden="true" strokeWidth={2.4} />
          </button>
          <div className="rules-sheet-body">
            {loading && !template && <Notice tone="info">{t('competition.rules.loadingRace')}</Notice>}
            {!loading && !template && <Notice tone="info" role={null}>{t('competition.rules.none')}</Notice>}
            {template && (
              <div className="space-y-3">
                {template.summary && <p className="text-sm text-[rgb(var(--mg-body))]">{template.summary}</p>}
                <RaceRulebookSection template={template} showDiagram fitDiagram picker="row" />
              </div>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
