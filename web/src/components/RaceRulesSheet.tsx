/* eslint-disable react-refresh/only-export-components */
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { api } from '../api';
import { equipmentFromDiagram } from '../lib/raceEquipment';
import type { RaceTemplate } from '../types';
import { Notice } from './Notice';
import { RaceDiagram } from './RaceDiagram';

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
    penalties: `Verified ${body} rules and penalties for this race have not been added. Check the event's published rulebook with the organiser.`,
    rulesText,
  });
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
      </div>

      {showDiagram && template.diagramJson && (
        <div className="overflow-hidden rounded-lg border border-[rgb(var(--mg-rule))]">
          <RaceDiagram drop diagramJson={template.diagramJson} height={diagramHeight} />
        </div>
      )}

      <div
        role="tabpanel"
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
  open,
  onClose,
}: {
  raceName: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
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

  useEffect(() => {
    if (!open || !raceName) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, raceName, onClose]);

  if (!open || !raceName) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgb(var(--mg-overlay)/0.45)] p-0 sm:items-center sm:p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-t-[26px] bg-[rgb(var(--mg-surface))] px-5 pb-6 pt-2 shadow-xl [corner-shape:squircle] sm:rounded-[20px]"
      >
        <span aria-hidden="true" className="kit-sheet-grip" />
        <h2 id={titleId} className="kit-sheet-title">
          {template?.name ?? raceName}
        </h2>

        {loading && !template && <Notice tone="info">{t('competition.rules.loadingRace')}</Notice>}
        {!loading && !template && <Notice tone="info" role={null}>{t('competition.rules.none')}</Notice>}
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
                {t('competition.rules.openPage')}
              </Link>
            </div>
          </div>
        )}
        <div className="kit-acts">
          <button type="button" className="kit-pill kit-pill-fill" aria-label={t('competition.rules.close')} onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
