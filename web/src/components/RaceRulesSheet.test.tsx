import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import {
  buildRaceRulebooks,
  clearRaceDetailCache,
  fetchRaceTemplateByName,
  normaliseBodyName,
  RaceRulebookSection,
  RaceRulesSheet,
} from './RaceRulesSheet';

vi.mock('../api', () => ({
  api: { get: vi.fn() },
}));

describe('RaceRulesSheet & rulebook helpers', () => {
  beforeEach(() => {
    clearRaceDetailCache();
    vi.mocked(api.get).mockReset();
  });

  it('normalises governing body names across aliases and defaults unknown values to EGUK', () => {
    expect(normaliseBodyName('eguk')).toBe('EGUK');
    expect(normaliseBodyName('Pony Club')).toBe('Pony Club');
    expect(normaliseBodyName('pc')).toBe('Pony Club');
    expect(normaliseBodyName('PCUK')).toBe('Pony Club');
    expect(normaliseBodyName('mga')).toBe('MGA');
    expect(normaliseBodyName('IMGA')).toBe('MGA');
    expect(normaliseBodyName('struk')).toBe('STRUK');
    expect(normaliseBodyName('other')).toBe('EGUK');
  });

  it('builds all 4 governing body rulebooks from a template with custom overrides or defaults', () => {
    const books = buildRaceRulebooks({
      id: 1,
      name: 'Bending',
      isBuiltIn: true,
      rules: 'Weave through the 5 poles. Hand over the baton.',
      diagramJson: JSON.stringify({
        items: [{ type: 'pole', x: 50, y: 80 }],
      }),
      rulebooks: [
        null as unknown as never,
        {
          body: 'pc' as never,
          title: 'Custom PC Bending',
          edition: 'PC 2026',
          equipment: '5 poles',
          setup: 'Custom setup',
          howToRide: 'Custom ride',
          penalties: 'Custom penalties',
          rulesText: 'Custom rules',
        },
      ],
    });

    expect(books.map((b) => b.body)).toEqual(['EGUK', 'Pony Club', 'MGA', 'STRUK']);
    expect(books[1].title).toBe('Custom PC Bending');
    expect(books[0].equipment).toContain('Per lane:');

    const fallbackBooks = buildRaceRulebooks({
      id: 2,
      name: 'Mystery Race',
      isBuiltIn: false,
      rules: '',
      diagramJson: null,
    });
    expect(fallbackBooks[0].equipment).toContain('standard setup for Mystery Race');
    expect(fallbackBooks[0].howToRide).toContain('Standard mounted games rules apply for Mystery Race');
  });

  it('fetches race templates by name with caching, fallback template, and list fallback', async () => {
    expect(await fetchRaceTemplateByName('   ')).toBeNull();

    vi.mocked(api.get).mockResolvedValueOnce({
      data: { id: 10, name: 'Mug Race', isBuiltIn: true, rules: 'Move mugs.' },
    });
    const first = await fetchRaceTemplateByName('Mug Race');
    expect(first?.name).toBe('Mug Race');
    expect(first?.rulebooks).toHaveLength(4);

    // Cached second call does not hit api.get again
    const second = await fetchRaceTemplateByName('mug race');
    expect(second?.name).toBe('Mug Race');
    expect(api.get).toHaveBeenCalledTimes(1);

    // Fallback object when /by-name/ fails
    vi.mocked(api.get).mockRejectedValueOnce(new Error('404'));
    const withFallback = await fetchRaceTemplateByName('Bottle', {
      id: 11,
      name: 'Bottle Race',
      isBuiltIn: true,
      rules: 'Swap bottle.',
    });
    expect(withFallback?.name).toBe('Bottle Race');

    // List lookup when /by-name/ returns empty and no fallback is passed
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: [{ id: 12, name: 'Flag Race', rules: 'Place flags.' }] });
    const fromList = await fetchRaceTemplateByName('Flag Race');
    expect(fromList?.name).toBe('Flag Race');

    // Returns null when not in list
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ data: [] });
    expect(await fetchRaceTemplateByName('Unknown Race')).toBeNull();

    // Evicts cache and returns null when both /by-name/ and /race-templates fail
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));
    expect(await fetchRaceTemplateByName('Offline Race')).toBeNull();
  });

  it('switches between governing body tabs in RaceRulebookSection and renders RaceRulesSheet', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        id: 20,
        name: 'Sword Race',
        summary: 'Collect rings with the sword.',
        rules: 'Collect all rings.',
        diagramJson: JSON.stringify({ items: [{ type: 'pole', x: 50, y: 80 }] }),
      },
    });

    const onClose = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <RaceRulesSheet raceName={null} open={false} onClose={onClose} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(
      <MemoryRouter>
        <RaceRulesSheet raceName="Sword Race" open={true} onClose={onClose} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Collect rings with the sword.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Pony Club' }));
    expect(screen.getByRole('tabpanel', { name: 'Pony Club rules' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'MGA' }));
    expect(screen.getByRole('tabpanel', { name: 'MGA rules' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'STRUK' }));
    expect(screen.getByRole('tabpanel', { name: 'STRUK rules' })).toBeInTheDocument();

    // Clicking backdrop closes, clicking dialog content does not
    const dialog = screen.getByRole('dialog');
    fireEvent.pointerDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('link', { name: 'Open race rulebook page' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows empty state when no rules exist for the requested race', async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ data: [] });

    render(
      <MemoryRouter>
        <RaceRulesSheet raceName="Missing Race" open={true} onClose={vi.fn()} />
        <RaceRulebookSection template={{ id: 1, name: 'Plain Race', isBuiltIn: true, rules: 'Run fast.' }} showDiagram={false} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('No rules have been added for this race yet.')).toBeInTheDocument();
    });
  });
});
