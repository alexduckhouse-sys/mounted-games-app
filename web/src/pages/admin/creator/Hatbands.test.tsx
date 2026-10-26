import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { defaultDraft, defaultSection, type CreatorDraft } from '../../../lib/creatorDraft';
import { HatbandEditor, HatbandList } from './Hatbands';

describe('HatbandList', () => {
  it('shows each hatband by its name with its colour, never the colour code', () => {
    render(<HatbandList hatbands={['Red', 'Lilac #B79CED']} />);
    const list = screen.getByRole('list', { name: 'Hatbands by lane' });
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('Lane 2 · Lilac');
    expect(list).not.toHaveTextContent('#B79CED');
  });
});

/** The editor with a real draft behind it, so changes show up on screen. */
function Harness({ start, onDraft }: { start: Partial<CreatorDraft>; onDraft: (d: CreatorDraft) => void }) {
  const [draft, setDraft] = useState<CreatorDraft>({ ...defaultDraft(new Date(2026, 9, 24)), ...start });
  onDraft(draft);
  return <HatbandEditor draft={draft} change={(patch) => setDraft((cur) => ({ ...cur, ...patch }))} />;
}

function setup(start: Partial<CreatorDraft> = {}) {
  let latest!: CreatorDraft;
  render(<Harness start={start} onDraft={(d) => { latest = d; }} />);
  return { draft: () => latest, group: () => screen.getByRole('group', { name: 'Hatbands' }) };
}

const menu = async (name: string, item: string) => {
  await userEvent.click(screen.getByRole('button', { name: `More for ${name}` }));
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
};

describe('HatbandEditor', () => {
  it('lists the usual colours for the biggest heat, in lane order', () => {
    const { group } = setup({ sections: [{ ...defaultSection(), maxTeamsPerHeat: '4' }] });
    const rows = within(group()).getAllByText(/^(Red|White|Blue|Yellow|Green|Black)$/);
    expect(rows.map((r) => r.textContent)).toEqual(['Red', 'White', 'Blue', 'Yellow']);
  });

  it('moves a hatband up or down, and the first and last cannot go further', async () => {
    const { draft } = setup({ laneHatbands: ['Red', 'Blue', 'Green'] });
    expect(screen.getByRole('button', { name: 'Move Red up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Green down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Blue up' }));
    expect(draft().laneHatbands).toEqual(['Blue', 'Red', 'Green']);
    await userEvent.click(screen.getByRole('button', { name: 'Move Blue down' }));
    expect(draft().laneHatbands).toEqual(['Red', 'Blue', 'Green']);
  });

  it('changes a colour from the ⋯ menu: name and colour save as they are typed, and a custom colour keeps its name', async () => {
    const { draft } = setup({ laneHatbands: ['Red', 'Lilac #B79CED'] });
    await menu('Lilac', 'Change colour');
    expect(screen.getByLabelText('Hatband name')).toHaveValue('Lilac');
    expect(screen.getByLabelText('Colour code')).toHaveValue('#B79CED');
    await userEvent.type(screen.getByLabelText('Hatband name'), 's');
    expect(draft().laneHatbands).toEqual(['Red', 'Lilacs #B79CED']);
    fireEvent.change(screen.getByLabelText('Colour code'), { target: { value: '#00FF00' } });
    expect(draft().laneHatbands[1]).toBe('Lilacs #00FF00');
    // A colour code only lands once it is a whole one.
    fireEvent.change(screen.getByLabelText('Colour code'), { target: { value: '#00FF' } });
    expect(draft().laneHatbands[1]).toBe('Lilacs #00FF00');
    fireEvent.change(screen.getByLabelText('Colour'), { target: { value: '#112233' } });
    expect(draft().laneHatbands[1]).toBe('Lilacs #112233');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Hatband name')).not.toBeInTheDocument();
  });

  it('gives a nameless hatband its lane number when Done is pressed', async () => {
    const { draft } = setup({ laneHatbands: ['Red', 'Blue'] });
    await menu('Blue', 'Change colour');
    await userEvent.clear(screen.getByLabelText('Hatband name'));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(draft().laneHatbands[1]).toBe('Lane 2 #2B5FA8');
  });

  it('removes one from the menu, and all of them, and offers the usual colours back', async () => {
    const { draft } = setup({ laneHatbands: ['Red', 'Blue', 'Green'] });
    await menu('Blue', 'Remove');
    expect(draft().laneHatbands).toEqual(['Red', 'Green']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove all hatbands' }));
    expect(draft()).toMatchObject({ laneHatbands: [], noHatbands: true });
    expect(screen.getByText('No hatbands')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove all hatbands' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use the usual colours' }));
    expect(draft().laneHatbands).toEqual(['Red', 'White', 'Blue', 'Yellow', 'Green', 'Black']);
    expect(draft().noHatbands).toBe(false);
  });

  it('adds a hatband from a quick colour or by name and colour, up to the biggest arena’s lanes', async () => {
    const { draft } = setup({ laneHatbands: ['Red', 'Blue'], arenas: [{ name: 'Main arena', lanes: '4' }], sections: [{ ...defaultSection(), maxTeamsPerHeat: '4' }] });
    await userEvent.click(screen.getByRole('button', { name: 'Add a hatband' }));
    const quick = screen.getByRole('group', { name: 'Quick colours' });
    expect(within(quick).getByRole('button', { name: 'Red' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add hatband' })).toBeDisabled();
    await userEvent.click(within(quick).getByRole('button', { name: 'Orange' }));
    expect(screen.getByLabelText('Hatband name')).toHaveValue('Orange');
    await userEvent.click(screen.getByRole('button', { name: 'Add hatband' }));
    expect(draft().laneHatbands).toEqual(['Red', 'Blue', 'Orange']);

    await userEvent.click(screen.getByRole('button', { name: 'Add a hatband' }));
    await userEvent.type(screen.getByLabelText('Hatband name'), 'Sea green');
    fireEvent.change(screen.getByLabelText('Colour code'), { target: { value: 'nope' } });
    expect(screen.getByRole('button', { name: 'Add hatband' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Colour code'), { target: { value: '#2E8B57' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add hatband' }));
    expect(draft().laneHatbands).toEqual(['Red', 'Blue', 'Orange', 'Sea green #2E8B57']);
    // Four lanes, four hatbands: no room for another.
    expect(screen.queryByRole('button', { name: 'Add a hatband' })).not.toBeInTheDocument();
  });

  it('can cancel adding, and opening one editor closes the other', async () => {
    setup({ laneHatbands: ['Red'] });
    await userEvent.click(screen.getByRole('button', { name: 'Add a hatband' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Quick colours' })).not.toBeInTheDocument();
    await menu('Red', 'Change colour');
    await userEvent.click(screen.getByRole('button', { name: 'Add a hatband' }));
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    await menu('Red', 'Change colour');
    expect(screen.queryByRole('group', { name: 'Quick colours' })).not.toBeInTheDocument();
  });
});
