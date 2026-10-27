import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { heat, session as makeSession } from '../../test/factories';
import { SessionSharePrint } from './SessionSharePrint';
import { ShareTextButtons } from './ShareTextButtons';
import { copyText, drawShareText, shareWithSheet, timetableShareText, whatsAppShareHref } from './shareText';
import type { Session } from '../../types';

const at = (h: number, m = 0) => new Date(2031, 4, 4, h, m).toISOString();
const entry = (teamId: number, teamName: string, laneIndex: number) => ({ id: teamId, teamId, teamName, laneIndex });
const s1 = makeSession(1, { name: 'Session 1', sectionName: 'Under 12', arenaName: 'Arena 1', scheduledStart: at(10), heats: [
  heat(2, { orderIndex: 2, label: null, scheduledStart: at(10, 30), entries: [entry(3, 'Elm C', 1)] }),
  heat(1, { orderIndex: 1, label: 'Heat A', scheduledStart: at(10), entries: [entry(2, 'Oak B', 2), entry(1, 'Ash A', 1)] }),
] });

afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'share'); Reflect.deleteProperty(navigator, 'clipboard'); });

describe('shareText', () => {
  it('writes the timetable by arena in running order, with a link', () => {
    const lunch = makeSession(2, { name: 'Lunch', isBreak: true, sectionName: null, arenaName: null, scheduledStart: at(12) });
    const later = makeSession(3, { name: 'Session 2', sectionName: 'Under 14', arenaName: 'Arena 1', scheduledStart: at(9), orderIndex: 3 });
    const tba = makeSession(4, { name: 'Open', sectionName: null, arenaName: 'Arena 1', scheduledStart: null, orderIndex: 4 });
    const text = timetableShareText({ name: 'Spring Games', startDate: at(9), sessions: [s1, lunch, later, tba] }, 'https://x.test/c/7');
    const lines = text.split('\n');
    expect(lines[0]).toBe('Spring Games');
    expect(lines[1]).toMatch(/^Timetable, /);
    expect(text.indexOf('09:00  Under 14, Session 2')).toBeLessThan(text.indexOf('10:00  Under 12, Session 1'));
    expect(text).toContain('Time to be confirmed  Open');
    expect(text).toContain('All arenas\n12:00  Lunch');
    expect(text.endsWith('Live times and scores: https://x.test/c/7')).toBe(true);
  });

  it('writes the draw heat by heat, lane by lane', () => {
    const text = drawShareText({ name: 'Spring Games' }, s1, 'https://x.test/c/7');
    expect(text).toContain('Draw: Under 12, Session 1 (Arena 1)');
    expect(text.indexOf('Heat A, 10:00')).toBeLessThan(text.indexOf('Heat 2, 10:30'));
    expect(text.indexOf('Lane 1: Ash A')).toBeLessThan(text.indexOf('Lane 2: Oak B'));
  });

  it('copes with a session that has no section, arena or times', () => {
    const bare = { name: 'Session 1', sectionName: null, arenaName: null, heats: [heat(1, { label: 'Heat 1', scheduledStart: 'nonsense', entries: [] })] } as Pick<Session, 'name' | 'sectionName' | 'arenaName' | 'heats'>;
    expect(drawShareText({ name: 'G' }, bare, 'l')).toContain('Draw: Session 1\n\nHeat 1\n');
  });

  it('builds a WhatsApp link with no number', () => {
    expect(whatsAppShareHref('Hello there')).toBe('https://wa.me/?text=Hello%20there');
  });

  it('uses the share sheet when there is one', async () => {
    expect(await shareWithSheet('t', 'x')).toBe('unavailable');
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    expect(await shareWithSheet('t', 'x')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 't', text: 'x' });
    share.mockRejectedValue(Object.assign(new Error('no'), { name: 'AbortError' }));
    expect(await shareWithSheet('t', 'x')).toBe('cancelled');
    share.mockRejectedValue(new Error('broken'));
    expect(await shareWithSheet('t', 'x')).toBe('unavailable');
  });

  it('copies with the clipboard, then the older route, then gives up', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    expect(await copyText('a')).toBe(true);
    writeText.mockRejectedValue(new Error('denied'));
    document.execCommand = vi.fn().mockReturnValue(true);
    expect(await copyText('b')).toBe(true);
    document.execCommand = vi.fn().mockReturnValue(false);
    expect(await copyText('c')).toBe(false);
    document.execCommand = vi.fn(() => { throw new Error('gone'); });
    expect(await copyText('d')).toBe(false);
    Reflect.deleteProperty(navigator, 'clipboard');
    document.execCommand = vi.fn().mockReturnValue(true);
    expect(await copyText('e')).toBe(true);
  });
});

describe('ShareTextButtons', () => {
  it('copies the text and confirms', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ShareTextButtons title="Share timetable" name="Timetable" text="The text" />);
    expect(screen.queryByRole('button', { name: 'Share timetable' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy timetable' }));
    expect(writeText).toHaveBeenCalledWith('The text');
    expect(await screen.findByText('Timetable copied')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send on WhatsApp' })).toHaveAttribute('href', 'https://wa.me/?text=The%20text');
  });

  it('says so when copying fails', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
    document.execCommand = vi.fn().mockReturnValue(false);
    render(<ShareTextButtons title="Share draw" name="Draw" text="x" />);
    await user.click(screen.getByRole('button', { name: 'Copy draw' }));
    expect(await screen.findByText(/Couldn’t copy/)).toBeInTheDocument();
  });

  it('offers the share sheet where the phone has one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    render(<ShareTextButtons title="Share draw" name="Draw" text="Lanes" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Share draw' }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: 'Share draw', text: 'Lanes' }));
  });
});

describe('SessionSharePrint', () => {
  const show = (session: Session) => render(
    <MemoryRouter initialEntries={['/s']}>
      <Routes>
        <Route path="/s" element={<SessionSharePrint competition={{ id: 7, name: 'Spring Games' }} session={session} />} />
        <Route path="/event-tools/7/print/:view" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

  it('prints one sheet for this session only, picked from a list', async () => {
    show(s1);
    await userEvent.click(screen.getByRole('button', { name: 'Print this session' }));
    expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual(['Draw', 'Score sheets', 'Results']);
    await userEvent.click(screen.getByRole('radio', { name: 'Score sheets' }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/event-tools/7/print/score-sheets?sessionId=1');
  });

  it('shows the lanes message before sending it', async () => {
    show(s1);
    await userEvent.click(screen.getByRole('button', { name: 'Send the lanes' }));
    expect(screen.getByText(/Ash A/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send on WhatsApp' })).toBeInTheDocument();
  });

  it('offers no draw to share before there are heats', () => {
    show({ ...s1, heats: [] });
    expect(screen.queryByRole('button', { name: 'Send the lanes' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print this session' })).toBeInTheDocument();
  });
});

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}{location.search}</p>;
}
