import { describe, expect, it } from 'vitest';
import {
  buildStoryResultCardData,
  renderStoryResultCardCanvas,
  STORY_CARD_HEIGHT,
  STORY_CARD_WIDTH,
} from './storyResultCard';
import type { StandingRow } from '../types';

describe('storyResultCard (#10)', () => {
  const standings: StandingRow[] = [
    { teamId: 1, teamName: 'Kent A', clubName: 'Kent', totalPoints: 48, racesRun: 10, wins: 5, eliminations: 0, finalTier: 0 },
    { teamId: 2, teamName: 'Surrey A', clubName: 'Surrey', totalPoints: 44.5, racesRun: 10, wins: 3, eliminations: 0, finalTier: 0 },
    { teamId: 3, teamName: 'Essex A', clubName: 'Essex', totalPoints: 39, racesRun: 10, wins: 2, eliminations: 1, finalTier: 0 },
    { teamId: 4, teamName: 'Sussex A', clubName: 'Sussex', totalPoints: 35, racesRun: 10, wins: 1, eliminations: 0, finalTier: 0 },
  ];

  it('builds podium, featured team spotlight, caption, and filename for a 9:16 story card', () => {
    const card = buildStoryResultCardData({
      competitionName: 'Southern Championships',
      sectionName: 'U15 Teams',
      standings,
      featuredTeamId: 2,
      dateLabel: 'Sat 18 Jul',
      locationLabel: 'Ardingly',
      isProvisional: false,
    });

    expect(card.podium).toHaveLength(3);
    expect(card.featuredTeam).toMatchObject({
      teamId: 2,
      rank: 2,
      teamName: 'Surrey A',
      totalPoints: 44.5,
      wins: 3,
      finalTierLabel: 'A Final',
    });
    expect(card.captionText).toContain('Southern Championships — U15 Teams');
    expect(card.captionText).toContain('Surrey A: #2 (44.5 pts, 3 wins · A Final)');
    expect(card.suggestedFileName).toBe('southern-championships-u15-teams-surrey-a-story.png');
  });

  it('captions the podium in plain words, marked provisional when it is', () => {
    const card = buildStoryResultCardData({
      competitionName: 'Southern Championships',
      sectionName: 'U15 Teams',
      standings,
      isProvisional: true,
    });
    const lines = card.captionText.split('\n');
    expect(lines[0]).toBe('Southern Championships — U15 Teams (provisional)');
    expect(lines[1]).toMatch(/^1st .+, [\d.]+ pts$/);
    expect(card.captionText).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('renders onto a 1080x1920 canvas without throwing', () => {
    const card = buildStoryResultCardData({
      competitionName: 'Southern Championships',
      sectionName: 'U15 Teams',
      standings,
      isProvisional: true,
    });
    const canvas = renderStoryResultCardCanvas(card);
    expect(canvas.width).toBe(STORY_CARD_WIDTH);
    expect(canvas.height).toBe(STORY_CARD_HEIGHT);
  });
});
