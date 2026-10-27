import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { RaceTemplate } from '../types';
import {
  buildRaceRulebooks, clearRaceDetailCache, fetchRaceTemplateByName,
  normaliseBodyName, RaceRulebookSection, RaceRulesSheet,
  type RaceTemplateDetail,
} from './RaceRulesSheet';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
const template = (name = 'Fake Race'): RaceTemplate => ({ id: 71, name, isBuiltIn: true, rules: 'Ride around the pole. Return to the start.' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const sheet = (raceName: string | null, open = true, onClose = vi.fn()) =>
  <MemoryRouter><RaceRulesSheet raceName={raceName} open={open} onClose={onClose} /></MemoryRouter>;

beforeEach(() => { clearRaceDetailCache(); vi.mocked(api.get).mockReset(); });

describe('race rulebook lookup', () => {
  it('shares an in-flight lookup across spelling case and surrounding whitespace', async () => {
    const pending = deferred<{ data: RaceTemplate }>();
    vi.mocked(api.get).mockReturnValue(pending.promise);
    const first = fetchRaceTemplateByName(' Fake Race ');
    const second = fetchRaceTemplateByName('fake race');
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/race-templates/by-name/Fake%20Race');
    pending.resolve({ data: template() });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a?.rulebooks).toHaveLength(4);
    expect(await fetchRaceTemplateByName('FAKE RACE')).toEqual(a);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('does not fetch a blank name', async () => {
    expect(await fetchRaceTemplateByName('   ')).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('uses the supplied template when the detail response is malformed', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { name: 123 } });
    const fallback = template('Saved race');
    expect(await fetchRaceTemplateByName('Missing race', fallback)).toMatchObject({ name: 'Saved race', rulebooks: expect.any(Array) });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('finds a case-insensitive list match after the detail endpoint fails', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline detail')).mockResolvedValueOnce({ data: [template('Other'), template(' FAKE RACE ')] });
    expect(await fetchRaceTemplateByName('fake race')).toMatchObject({ name: ' FAKE RACE ' });
    expect(api.get).toHaveBeenLastCalledWith('/race-templates');
  });

  it.each([[], [template('Another race')], null, { unexpected: 'response' }])('returns no rules when the list has no usable match: %j', async (data) => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data });
    expect(await fetchRaceTemplateByName('Unknown race')).toBeNull();
  });

  it('retries after both endpoints fail instead of caching a transport failure forever', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('still offline'));
    expect(await fetchRaceTemplateByName('Fake Race')).toBeNull();
    vi.mocked(api.get).mockResolvedValueOnce({ data: template() });
    expect(await fetchRaceTemplateByName('Fake Race')).toMatchObject({ name: 'Fake Race' });
    expect(api.get).toHaveBeenCalledTimes(3);
  });
});

describe('race guide provenance', () => {
  it.each([
    [' eguk ', 'EGUK'], ['pc', 'Pony Club'], ['PCUK', 'Pony Club'], ['Pony Club', 'Pony Club'],
    ['imga', 'MGA'], ['MGA', 'MGA'], ['struk', 'STRUK'], ['unknown organisation', 'EGUK'],
  ])('normalises %s as %s', (input, expected) => expect(normaliseBodyName(input)).toBe(expected));

  it('ignores malformed rulebook entries while preserving a supplied guide and marking generated guides unverified', () => {
    const supplied = { body: 'PCUK', title: 'Supplied guide', edition: 'Test edition', equipment: 'One pole', setup: 'One lane', howToRide: 'Ride the lane', penalties: 'Ask the official', rulesText: 'Ride the lane' };
    const malformed = { ...template(), rulebooks: [null, { body: 123 }, supplied] } as unknown as RaceTemplateDetail;
    const books = buildRaceRulebooks(malformed);
    expect(books).toHaveLength(4);
    expect(books.find((book) => book.body === 'Pony Club')).toMatchObject({ title: 'Supplied guide', body: 'Pony Club' });
    for (const book of books.filter((item) => item.body !== 'Pony Club')) {
      expect(book.edition).toBe('App race guide · body-specific rules not verified');
      expect(book.penalties).toContain('Standard mounted games fault rules apply');
      expect(book.setup).toBe('Ride around the pole.');
    }
  });

  it('uses an honest default when there is no race text or diagram', () => {
    const books = buildRaceRulebooks({ ...template(), rules: '   ', diagramJson: null });
    expect(books[0].equipment).toBe('Per lane: standard setup for Fake Race.');
    expect(books[0].rulesText).toBe('Standard mounted games rules apply for Fake Race.');
    render(<RaceRulebookSection template={template()} showDiagram />);
    fireEvent.click(screen.getByRole('tab', { name: 'STRUK' }));
    expect(screen.getByRole('tabpanel', { name: 'STRUK rules' })).not.toHaveTextContent('body-specific rules not verified');
    expect(screen.getByRole('tabpanel', { name: 'STRUK rules' })).toHaveTextContent("Check the event's published STRUK rulebook");
    expect(screen.getByRole('tab', { name: 'STRUK' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('race rules sheet loading and closing', () => {
  it('waits until opened with a name before fetching', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: template() });
    const view = render(sheet(null));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.rerender(sheet('Fake Race', false));
    expect(api.get).not.toHaveBeenCalled();
    view.rerender(sheet('Fake Race'));
    expect(await screen.findByRole('dialog', { name: 'Fake Race' })).toBeInTheDocument();
    await screen.findByText('Rulebooks · Fake Race');
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when both available sources lack this race', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: [] });
    render(sheet('Unknown race'));
    expect(screen.getByRole('status')).toHaveTextContent('Loading race rules');
    expect(await screen.findByText('No rules have been added for this race yet.')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not let an old lookup replace the newly selected race', async () => {
    const first = deferred<{ data: RaceTemplate }>();
    const second = deferred<{ data: RaceTemplate }>();
    vi.mocked(api.get).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(sheet('First race'));
    view.rerender(sheet('Second race'));
    await act(async () => { second.resolve({ data: template('Second race') }); });
    expect(screen.getByRole('dialog', { name: 'Second race' })).toBeInTheDocument();
    await act(async () => { first.resolve({ data: template('First race') }); });
    expect(screen.getByRole('dialog', { name: 'Second race' })).toBeInTheDocument();
    expect(screen.queryByText('Rulebooks · First race')).not.toBeInTheDocument();
  });

  it('can close during a fetch and reopen its cached result without another request', async () => {
    const pending = deferred<{ data: RaceTemplate }>();
    vi.mocked(api.get).mockReturnValue(pending.promise);
    const view = render(sheet('Fake Race'));
    view.rerender(sheet('Fake Race', false));
    await act(async () => { pending.resolve({ data: template() }); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.rerender(sheet('Fake Race'));
    await screen.findByText('Rulebooks · Fake Race');
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('keeps inside taps open, closes on backdrop/button/page-link, and encodes the race name in the link', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...template('Fake race & poles'), summary: 'Fake setup summary' } });
    const close = vi.fn();
    render(sheet('Fake race & poles', true, close));
    await screen.findByText('Fake setup summary');
    const dialog = screen.getByRole('dialog');
    fireEvent.pointerDown(within(dialog).getByRole('heading'));
    expect(close).not.toHaveBeenCalled();
    fireEvent.pointerDown(dialog.parentElement!);
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close rules' }));
    expect(close).toHaveBeenCalledTimes(2);
    const link = screen.getByRole('link', { name: 'Open race rulebook page' });
    expect(link).toHaveAttribute('href', '/rulebooks?race=Fake%20race%20%26%20poles');
    fireEvent.click(link);
    expect(close).toHaveBeenCalledTimes(3);
  });
});
