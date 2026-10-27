import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StandingRow } from '../types';
import {
  buildStoryCaption, buildStoryResultCardData, canvasToPngBlob, fitText, loadStoryCardFonts, renderStoryResultCardCanvas, rosetteFor,
  shareOrDownloadStoryResultCard, wrapText, ROSETTE_COLOURS, STORY_CARD_HEIGHT, STORY_CARD_WIDTH,
} from './storyResultCard';

/** A 2D context that records what was drawn. Text is 20px wide per character. */
function fakeContext(withRoundRect = true) {
  const texts: string[] = [];
  const ctx: Record<string, unknown> = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic',
    measureText: (text: string) => ({ width: text.length * 20 }),
    fillText: (text: string) => { texts.push(text); },
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
    arc: vi.fn(), stroke: vi.fn(), rect: vi.fn(),
  };
  if (withRoundRect) ctx.roundRect = vi.fn();
  return { ctx, texts };
}

function fakeCanvas(ctx: unknown) {
  return { width: 0, height: 0, getContext: () => ctx, toBlob: (done: (b: Blob | null) => void) => done(new Blob(['png'], { type: 'image/png' })) } as unknown as HTMLCanvasElement;
}

const row = (teamId: number, teamName: string, totalPoints: number, extra: Partial<StandingRow> = {}): StandingRow => ({
  teamId, teamName, clubName: `${teamName} club`, totalPoints, racesRun: 8, wins: 1, eliminations: 0, finalTier: null, ...extra,
} as StandingRow);

const standings = [
  row(1, 'Kent A', 48, { wins: 1, finalTier: 0 }), row(2, 'Surrey A', 44.5), row(3, 'Essex A', 39, { clubName: '' }),
  row(4, 'Sussex A', 35), row(5, 'Dorset A', 30), row(6, 'Devon A', 28), row(7, 'Avon A', 20), row(8, 'Wilts A', 12), row(9, 'Hants A', 2),
];

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('rosettes and text fitting', () => {
  it('uses British rosette colours by place, with dark ink on yellow and light green, and grey after eighth', () => {
    expect(rosetteFor(1)).toEqual({ fill: ROSETTE_COLOURS[0], ink: '#FFFFFF' });
    expect(rosetteFor(3).ink).toBe('#0B1A2E');
    expect(rosetteFor(8).ink).toBe('#0B1A2E');
    expect(rosetteFor(9)).toEqual({ fill: '#5B6B80', ink: '#FFFFFF' });
  });

  it('shortens text to fit with an ellipsis', () => {
    const { ctx } = fakeContext();
    const measure = ctx as unknown as Pick<CanvasRenderingContext2D, 'measureText'>;
    expect(fitText(measure, 'Kent', 200)).toBe('Kent');
    expect(fitText(measure, 'Warwickshire Hunt A', 200)).toBe('Warwicksh…');
  });

  it('wraps onto the lines allowed and ends the last one with an ellipsis when there is more', () => {
    const { ctx } = fakeContext();
    const measure = ctx as unknown as Pick<CanvasRenderingContext2D, 'measureText'>;
    expect(wrapText(measure, 'Spring Open 2026', 400, 2)).toEqual(['Spring Open 2026']);
    expect(wrapText(measure, 'North West Area Mounted Games Championships', 400, 2)).toEqual(['North West Area', 'Mounted Games Champ…']);
    expect(wrapText(measure, 'Supercalifragilisticexpialidocious', 200, 2)).toEqual(['Supercali…']);
  });
});

describe('renderStoryResultCardCanvas', () => {
  it('draws the heading, podium, the next five places and the footer', () => {
    const { ctx, texts } = fakeContext();
    const data = buildStoryResultCardData({ competitionName: 'Spring Open 2026', sectionName: 'U12', standings, dateLabel: '27 Oct', locationLabel: 'Stoneleigh', isProvisional: true });
    const canvas = renderStoryResultCardCanvas(data, fakeCanvas(ctx));
    expect([canvas.width, canvas.height]).toEqual([STORY_CARD_WIDTH, STORY_CARD_HEIGHT]);
    expect(texts).toContain('Provisional results');
    expect(texts).toContain('Spring Open 2026');
    expect(texts).toContain('U12 · Stoneleigh · 27 Oct');
    for (const place of ['1st', '2nd', '3rd', '4th', '8th']) expect(texts).toContain(place);
    expect(texts).not.toContain('9th');
    expect(texts).toContain('Kent A club');
    expect(texts).toContain('Mounted Games · Live results and standings');
  });

  it('draws a featured team, official results, no club line where there is none, and copes without roundRect', () => {
    const { ctx, texts } = fakeContext(false);
    const data = buildStoryResultCardData({ competitionName: 'Spring Open', sectionName: 'U12', standings: standings.slice(0, 3), featuredTeamId: 1 });
    renderStoryResultCardCanvas(data, fakeCanvas(ctx));
    expect(texts).toContain('Official results');
    expect(texts).toContain('1st overall');
    expect(texts).toContain('48 pts · 1 win · A Final');
    expect(texts).not.toContain('Essex A club');
    expect(ctx.rect).toHaveBeenCalled();
    const two = buildStoryResultCardData({ competitionName: 'Spring Open', sectionName: 'U12', standings: [row(2, 'Surrey A', 4, { wins: 2 })], featuredTeamId: 2 });
    renderStoryResultCardCanvas(two, fakeCanvas(fakeContext().ctx));
    expect(buildStoryCaption(two)).toContain('2 wins');
  });

  it('returns the canvas untouched without a 2D context, and makes its own canvas when none is given', () => {
    const canvas = fakeCanvas(null);
    expect(renderStoryResultCardCanvas(buildStoryResultCardData({ competitionName: '', sectionName: '', standings: [] }), canvas)).toBe(canvas);
    const own = renderStoryResultCardCanvas(buildStoryResultCardData({ competitionName: 'A', sectionName: 'B', standings: [] }));
    expect(own.width).toBe(STORY_CARD_WIDTH);
  });
});

describe('buildStoryResultCardData edges', () => {
  it('keeps a usable file name from symbols alone, ignores a featured team that is not listed, and drops a blank club', () => {
    const data = buildStoryResultCardData({ competitionName: '***', sectionName: '!!!', standings: [row(3, 'Essex A', 9, { clubName: '' })], featuredTeamId: 99 });
    expect(data.suggestedFileName).toBe('story.png');
    expect(data.featuredTeam).toBeNull();
    const featured = buildStoryResultCardData({ competitionName: 'A', sectionName: 'B', standings: [row(3, 'Essex A', 9, { clubName: '' })], featuredTeamId: 3 });
    expect(featured.featuredTeam?.clubName).toBeNull();
  });
});

describe('fonts, PNG and sharing', () => {
  it('loads the card fonts, and carries on when that fails or is not supported', async () => {
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', { value: { load }, configurable: true });
    await loadStoryCardFonts();
    expect(load).toHaveBeenCalledTimes(3);
    load.mockRejectedValue(new Error('blocked'));
    await expect(loadStoryCardFonts()).resolves.toBeUndefined();
    Reflect.deleteProperty(document, 'fonts');
    await expect(loadStoryCardFonts()).resolves.toBeUndefined();
  });

  it('gives no PNG when the canvas cannot make one', async () => {
    expect(await canvasToPngBlob({} as HTMLCanvasElement)).toBeNull();
  });

  const data = buildStoryResultCardData({ competitionName: 'Spring Open', sectionName: 'U12', standings });
  const withCanvas = (canvas: HTMLCanvasElement) => {
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? canvas : create(tag))) as typeof document.createElement);
  };

  it('shares the PNG where files can be shared', async () => {
    withCanvas(fakeCanvas(fakeContext().ctx));
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, canShare: () => true });
    expect(await shareOrDownloadStoryResultCard(data)).toBe('shared');
    expect(share.mock.calls[0][0]).toMatchObject({ title: 'Spring Open — U12', files: [expect.any(File)] });
  });

  it('downloads the PNG when files cannot be shared or there is no share sheet', async () => {
    withCanvas(fakeCanvas(fakeContext().ctx));
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:card'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('navigator', { share: vi.fn(), canShare: () => false });
    expect(await shareOrDownloadStoryResultCard(data)).toBe('downloaded');
    vi.stubGlobal('navigator', { share: vi.fn() });
    expect(await shareOrDownloadStoryResultCard(data)).toBe('shared');
    vi.stubGlobal('navigator', {});
    expect(await shareOrDownloadStoryResultCard(data)).toBe('downloaded');
    expect(click).toHaveBeenCalledTimes(2);
    // The download link's address is let go a few seconds later.
    vi.useFakeTimers();
    await shareOrDownloadStoryResultCard(data);
    vi.advanceTimersByTime(5000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:card');
    vi.useRealTimers();
  });

  it('says unsupported when no PNG can be made', async () => {
    withCanvas({ width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement);
    expect(await shareOrDownloadStoryResultCard(data)).toBe('unsupported');
  });
});
