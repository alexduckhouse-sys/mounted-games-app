import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useT } from '../../i18n/LanguageContext';
import { competitionDateText } from '../../lib/competitionDates';
import {
  buildStoryResultCardData,
  canShareStoryResultCard,
  downloadStoryResultCardPng,
  makeStoryResultCardPng,
  shareStoryResultCardPng,
  type StoryResultCardData,
} from '../../lib/storyResultCard';
import { storyResultsAreProvisional } from '../../lib/storyResultStatus';
import { buildToplist } from '../../lib/toplist';
import type { CompetitionDetail, CompetitionSection, StandingRow } from '../../types';
import { PickSheet } from '../clubShop/ui';

/** Why the picture says Provisional: racing still to come, or finished results still open for queries. */
type Provisional = 'unfinished' | 'queries' | null;
interface Card { sectionName: string; data: StoryResultCardData; blob: Blob; url: string; provisional: Provisional }

function raceSessions(competition: CompetitionDetail, sectionId: number) {
  return (competition.sessions ?? []).filter((session) =>
    session.competitionSectionId === sectionId && !session.isBreak && (session.kind ?? 0) === 0);
}

/** Age groups with a race session under way or finished: the only ones a results picture can show anything for. */
function sectionsWithResults(competition: CompetitionDetail): CompetitionSection[] {
  return (competition.sections ?? []).filter((section) => raceSessions(competition, section.id).some((session) => session.status !== 0));
}

function wasCancelled(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}

export interface StoryImage {
  /** False until an age group has results, so the Share event sheet leaves the choice out. */
  available: boolean;
  busy: boolean;
  start: () => void;
  /** The age-group picker, the picture sheet and any error; render it once, beside the Share event row. */
  node: ReactNode;
}

/**
 * The "Share a results picture" choice in the Share event sheet: pick an age group, see the 9:16 picture, then
 * Share or Save. The picture is made first and shared from a second tap, because iOS refuses a share that follows
 * a download.
 */
export function useStoryImage(competition: CompetitionDetail): StoryImage {
  const t = useT();
  const sections = sectionsWithResults(competition);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  useEffect(() => () => { if (card) URL.revokeObjectURL(card.url); }, [card]);

  async function make(section: CompetitionSection) {
    setBusy(true);
    setError(null);
    try {
      const { data: standings } = await api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId: section.id } });
      const rows = Array.isArray(standings) ? standings : [];
      const list = buildToplist(rows, competition.sessions, competition.teams, section.id, section.finalistCount);
      if (!list.started || rows.length === 0) {
        setError(t('competition.details.storyNoResults', { section: section.displayName }));
        return;
      }
      const provisional: Provisional = !storyResultsAreProvisional(competition.sessions, section.id) ? null
        : raceSessions(competition, section.id).some((session) => session.status !== 2) ? 'unfinished' : 'queries';
      const data = buildStoryResultCardData({
        competitionName: competition.name,
        sectionName: section.displayName,
        standings: rows,
        ranking: list.rows,
        dateLabel: competition.startDate ? competitionDateText(competition.startDate, competition.endDate) : null,
        locationLabel: competition.location || null,
        isProvisional: provisional !== null,
      });
      const blob = await makeStoryResultCardPng(data);
      if (!blob) {
        setError(t('competition.details.storyUnsupported'));
        return;
      }
      setSheetError(null);
      setCard({ sectionName: section.displayName, data, blob, url: URL.createObjectURL(blob), provisional });
    } catch {
      setError(t('competition.details.storyFailed'));
    } finally {
      setBusy(false);
    }
  }

  function start() {
    if (busy) return;
    if (sections.length === 1) void make(sections[0]);
    else setPicking(true);
  }

  async function share(current: Card) {
    setSheetError(null);
    try {
      await shareStoryResultCardPng(current.blob, current.data);
    } catch (err) {
      if (!wasCancelled(err)) setSheetError(t('competition.details.storyFailed'));
    }
  }

  const canShare = card ? canShareStoryResultCard(card.blob, card.data) : false;

  const node = (
    <>
      {error && <Notice className="mx-4 my-2">{error}</Notice>}
      {picking && (
        <PickSheet
          title={t('competition.details.storyPick')}
          options={sections.map((section) => ({ value: String(section.id), label: section.displayName }))}
          value={null}
          onClose={() => setPicking(false)}
          onPick={(value) => {
            const section = sections.find((s) => String(s.id) === value);
            if (section) void make(section);
          }}
        />
      )}
      {card && (
        <Sheet title={t('competition.details.storyTitle', { section: card.sectionName })} onClose={() => setCard(null)}>
          {() => (
            <div className="kit-sheet-inner">
              <img src={card.url} alt={t('competition.details.storyAlt', { section: card.sectionName })}
                className="mx-auto block aspect-[9/16] max-h-[52vh] w-auto rounded-xl border border-[rgb(var(--mg-rule))]" />
              {card.provisional && (
                <p className="m-0 text-center text-sm text-[rgb(var(--mg-muted))]">
                  {card.provisional === 'unfinished' ? t('competition.details.storyUnfinished', { section: card.sectionName }) : t('competition.details.storyProvisional')}
                </p>
              )}
              {sheetError && <p role="alert" className="cs-field-error m-0">{sheetError}</p>}
              <div className="kit-acts">
                {canShare && <button type="button" className="kit-pill kit-pill-fill" onClick={() => { void share(card); }}>{t('competition.details.storyShare')}</button>}
                <button type="button" className={canShare ? 'kit-pill' : 'kit-pill kit-pill-fill'} onClick={() => downloadStoryResultCardPng(card.blob, card.data)}>
                  {t('competition.details.storySave')}
                </button>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </>
  );

  return { available: sections.length > 0, busy, start, node };
}
