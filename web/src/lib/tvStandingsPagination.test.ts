import { describe, expect, it } from 'vitest';
import {
  TV_STANDINGS_PAGE_INTERVAL_MS,
  TV_STANDINGS_PAGE_SIZE,
  advanceTvStandingsOrSlide,
  formatTvStandingsPageLabel,
  paginateTvStandings,
} from './tvStandingsPagination';

describe('paginateTvStandings', () => {
  it('keeps small sections on a single page without pagination', () => {
    const teams = Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`);
    const page = paginateTvStandings(teams, 0);
    expect(TV_STANDINGS_PAGE_SIZE).toBe(10);
    expect(TV_STANDINGS_PAGE_INTERVAL_MS).toBe(10_000);
    expect(page).toEqual({
      pageIndex: 0,
      totalPages: 1,
      pageSize: 10,
      startRank: 1,
      endRank: 8,
      hasMultiplePages: false,
      pageLabel: 'Page 1 of 1: Ranks 1–8',
      rows: teams,
    });
  });

  it('paginates 18 teams into Page 1 of 2: Ranks 1–10 and Page 2 of 2: Ranks 11–18', () => {
    const teams = Array.from({ length: 18 }, (_, i) => `Team ${i + 1}`);
    const page1 = paginateTvStandings(teams, 0, 10);
    expect(page1.hasMultiplePages).toBe(true);
    expect(page1.totalPages).toBe(2);
    expect(page1.pageLabel).toBe('Page 1 of 2: Ranks 1–10');
    expect(page1.rows).toHaveLength(10);
    expect(page1.rows[0]).toBe('Team 1');
    expect(page1.rows[9]).toBe('Team 10');

    const page2 = paginateTvStandings(teams, 1, 10);
    expect(page2.pageLabel).toBe('Page 2 of 2: Ranks 11–18');
    expect(page2.rows).toHaveLength(8);
    expect(page2.rows[0]).toBe('Team 11');
    expect(page2.rows[7]).toBe('Team 18');

    // Out-of-bounds page indices clamp cleanly
    expect(paginateTvStandings(teams, 99, 10).pageIndex).toBe(1);
    expect(paginateTvStandings(teams, -3, 10).pageIndex).toBe(0);
  });

  it('handles empty sections gracefully', () => {
    const empty = paginateTvStandings([], 2, 10);
    expect(empty).toEqual({
      pageIndex: 0,
      totalPages: 1,
      pageSize: 10,
      startRank: 0,
      endRank: 0,
      hasMultiplePages: false,
      pageLabel: 'Page 1 of 1: Ranks 0–0',
      rows: [],
    });
    expect(formatTvStandingsPageLabel(0, 2, 1, 10)).toBe('Page 1 of 2: Ranks 1–10');
  });
});

describe('advanceTvStandingsOrSlide', () => {
  const slides = ['lanes', 'heat', 'latest', 'standings'] as const;

  it('cycles through every standings page before advancing to the next slide and section', () => {
    // From 'latest' -> enters 'standings' at page 0
    const intoStandings = advanceTvStandingsOrSlide({
      currentSlide: 'latest',
      slides,
      standingsSlide: 'standings',
      currentPage: 0,
      totalRows: 18,
      currentSectionIndex: 0,
      totalSections: 2,
    });
    expect(intoStandings).toEqual({
      nextSlide: 'standings',
      nextPage: 0,
      nextSectionIndex: 0,
      advancedSection: false,
    });

    // Page 1 of 2 -> advances to Page 2 of 2 on 'standings'
    const toPage2 = advanceTvStandingsOrSlide({
      currentSlide: 'standings',
      slides,
      standingsSlide: 'standings',
      currentPage: 0,
      totalRows: 18,
      currentSectionIndex: 0,
      totalSections: 2,
    });
    expect(toPage2).toEqual({
      nextSlide: 'standings',
      nextPage: 1,
      nextSectionIndex: 0,
      advancedSection: false,
    });

    // Page 2 of 2 -> wraps to 'lanes', resets page to 0, and advances section
    const afterLastPage = advanceTvStandingsOrSlide({
      currentSlide: 'standings',
      slides,
      standingsSlide: 'standings',
      currentPage: 1,
      totalRows: 18,
      currentSectionIndex: 0,
      totalSections: 2,
    });
    expect(afterLastPage).toEqual({
      nextSlide: 'lanes',
      nextPage: 0,
      nextSectionIndex: 1,
      advancedSection: true,
    });
  });

  it('handles single-section and empty-slides edge cases', () => {
    const singleSection = advanceTvStandingsOrSlide({
      currentSlide: 'standings',
      slides,
      standingsSlide: 'standings',
      currentPage: 0,
      totalRows: 5,
      currentSectionIndex: 0,
      totalSections: 1,
    });
    expect(singleSection).toEqual({
      nextSlide: 'lanes',
      nextPage: 0,
      nextSectionIndex: 0,
      advancedSection: false,
    });

    const emptySlides = advanceTvStandingsOrSlide({
      currentSlide: 'standings',
      slides: [],
      standingsSlide: 'standings',
      currentPage: 0,
      totalRows: 5,
    });
    expect(emptySlides.nextSlide).toBe('standings');
  });
});
