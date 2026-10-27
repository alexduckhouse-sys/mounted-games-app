// Unused in web UI yet — reserved for iOS / upcoming wiring
export const TV_STANDINGS_PAGE_SIZE = 10;
export const TV_STANDINGS_PAGE_INTERVAL_MS = 10_000;

export interface TvStandingsPage<T> {
  pageIndex: number;
  totalPages: number;
  pageSize: number;
  startRank: number;
  endRank: number;
  hasMultiplePages: boolean;
  pageLabel: string;
  rows: T[];
}

export function formatTvStandingsPageLabel(
  pageIndex: number,
  totalPages: number,
  startRank: number,
  endRank: number,
): string {
  return `Page ${pageIndex + 1} of ${totalPages}: Ranks ${startRank}–${endRank}`;
}

/**
 * Slices a section's standings rows into TV-sized pages (default 10 rows per screen)
 * and produces a human-readable page indicator pill ("Page 1 of 2: Ranks 1–10").
 */
export function paginateTvStandings<T>(
  rows: ReadonlyArray<T>,
  requestedPageIndex: number,
  pageSize = TV_STANDINGS_PAGE_SIZE,
): TvStandingsPage<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / safePageSize));
  const pageIndex = Math.min(Math.max(0, Math.floor(requestedPageIndex)), totalPages - 1);

  if (totalRows === 0) {
    return {
      pageIndex: 0,
      totalPages: 1,
      pageSize: safePageSize,
      startRank: 0,
      endRank: 0,
      hasMultiplePages: false,
      pageLabel: 'Page 1 of 1: Ranks 0–0',
      rows: [],
    };
  }

  const startIdx = pageIndex * safePageSize;
  const endIdx = Math.min(startIdx + safePageSize, totalRows);
  const startRank = startIdx + 1;
  const endRank = endIdx;

  return {
    pageIndex,
    totalPages,
    pageSize: safePageSize,
    startRank,
    endRank,
    hasMultiplePages: totalPages > 1,
    pageLabel: formatTvStandingsPageLabel(pageIndex, totalPages, startRank, endRank),
    rows: rows.slice(startIdx, endIdx),
  };
}

export interface TvRotationStepInput<TSlide extends string> {
  currentSlide: TSlide;
  slides: ReadonlyArray<TSlide>;
  standingsSlide: TSlide;
  currentPage: number;
  totalRows: number;
  pageSize?: number;
  currentSectionIndex?: number;
  totalSections?: number;
}

export interface TvRotationStepResult<TSlide extends string> {
  nextSlide: TSlide;
  nextPage: number;
  nextSectionIndex: number;
  advancedSection: boolean;
}

/**
 * Advances the TV kiosk rotation: cycles through every page of standings before
 * moving to the next slide (and optionally cycling to the next section).
 */
export function advanceTvStandingsOrSlide<TSlide extends string>({
  currentSlide,
  slides,
  standingsSlide,
  currentPage,
  totalRows,
  pageSize = TV_STANDINGS_PAGE_SIZE,
  currentSectionIndex = 0,
  totalSections = 1,
}: TvRotationStepInput<TSlide>): TvRotationStepResult<TSlide> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(totalRows / safePageSize));
  const safeTotalSections = Math.max(1, Math.floor(totalSections));
  const safeSectionIndex = ((Math.floor(currentSectionIndex) % safeTotalSections) + safeTotalSections) % safeTotalSections;

  if (currentSlide === standingsSlide && currentPage + 1 < totalPages) {
    return {
      nextSlide: standingsSlide,
      nextPage: currentPage + 1,
      nextSectionIndex: safeSectionIndex,
      advancedSection: false,
    };
  }

  const idx = slides.indexOf(currentSlide);
  const nextSlide = slides.length > 0 ? slides[(idx + 1) % slides.length] : currentSlide;
  const finishingStandings = currentSlide === standingsSlide;
  const nextSectionIndex = finishingStandings && safeTotalSections > 1
    ? (safeSectionIndex + 1) % safeTotalSections
    : safeSectionIndex;

  return {
    nextSlide,
    nextPage: 0,
    nextSectionIndex,
    advancedSection: finishingStandings && safeTotalSections > 1,
  };
}
