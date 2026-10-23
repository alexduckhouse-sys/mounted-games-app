import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbedCard } from './EmbedCard';

const sections = [{ id: 5, displayName: 'Teams Seniors' }, { id: 6, displayName: 'Teams Juniors' }];
const snippet = () => (screen.getByLabelText('Code to paste') as HTMLTextAreaElement).value;

afterEach(() => vi.useRealTimers());

describe('EmbedCard for a competition', () => {
  it('starts with standings, no custom colour, and a copyable iframe', () => {
    render(<EmbedCard kind="competition" competitionId={7} name="Spring Games" sections={sections} />);
    expect(snippet()).toContain(`src="${window.location.origin}/embed/competitions/7/standings"`);
    expect(snippet()).toContain('title="Spring Games: Standings"');
    expect(snippet()).toContain('height="520"');
    expect(screen.getByTitle('Preview of the standings widget')).toHaveAttribute('src', '/embed/competitions/7/standings');
    expect(screen.getByRole('button', { name: 'Standings' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('follows the choices: view, age group, theme, colour and height', async () => {
    render(<EmbedCard kind="competition" competitionId={7} name="Spring Games" sections={sections} />);
    await userEvent.click(screen.getByRole('button', { name: 'Timetable' }));
    expect(snippet()).toContain('/embed/competitions/7/timetable"');
    expect(snippet()).toContain('height="600"');
    await userEvent.selectOptions(screen.getByLabelText('Age group'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Dark background' }));
    await userEvent.click(screen.getByLabelText('Use my club’s colour'));
    expect(snippet()).toContain('?accent=17385f&amp;theme=dark&amp;section=6');
    const height = screen.getByLabelText('Height (pixels)');
    await userEvent.clear(height);
    await userEvent.type(height, '700');
    expect(snippet()).toContain('height="700"');
    // Changing the view later keeps a height the organiser chose.
    await userEvent.click(screen.getByRole('button', { name: 'Latest results' }));
    expect(snippet()).toContain('height="700"');
    await userEvent.clear(height);
    await userEvent.tab();
    expect(height).toHaveValue(240);
  });

  it('only updates the preview once the choices settle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<EmbedCard kind="competition" competitionId={7} name="Spring Games" sections={sections} />);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Dark background' }));
    expect(screen.getByTitle('Preview of the standings widget')).toHaveAttribute('src', '/embed/competitions/7/standings');
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByTitle('Preview of the standings widget')).toHaveAttribute('src', '/embed/competitions/7/standings?theme=dark');
  });

  it('hides the age group choice when there is only one', () => {
    render(<EmbedCard kind="competition" competitionId={7} name="Spring Games" sections={sections.slice(0, 1)} />);
    expect(screen.queryByLabelText('Age group')).not.toBeInTheDocument();
  });

  it('copies the code and confirms it, or asks the organiser to copy by hand', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<EmbedCard kind="competition" competitionId={7} name="Spring Games" sections={sections} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith(snippet());
    expect(screen.getByText('Copied.')).toBeInTheDocument();
    writeText.mockRejectedValue(new Error('blocked'));
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(screen.getByText('Select the code above and copy it.')).toBeInTheDocument();
  });
});

describe('EmbedCard for a season', () => {
  it('has no view or age group choice and points at the season widget', () => {
    render(<EmbedCard kind="season" seasonId="3f2b8c1e-aaaa-4bbb-8ccc-0123456789ab" title="League 2026" />);
    expect(screen.queryByRole('button', { name: 'Timetable' })).not.toBeInTheDocument();
    expect(snippet()).toContain('/embed/seasons/3f2b8c1e-aaaa-4bbb-8ccc-0123456789ab/standings"');
    expect(snippet()).toContain('title="League 2026: Season standings"');
  });
});
