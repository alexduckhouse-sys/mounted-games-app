import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CreatorDraft } from '../../../lib/creatorDraft';
import { HatbandEditor, HatbandList } from './Hatbands';

describe('HatbandList', () => {
  it('shows each hatband by its name with its colour, never the colour code', () => {
    render(<HatbandList hatbands={['Red', 'Lilac #B79CED']} />);
    const list = screen.getByRole('list', { name: 'Hatbands by lane' });
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('Lane 2 · Lilac');
    expect(list).not.toHaveTextContent('#B79CED');
  });
});

describe('HatbandEditor', () => {
  const draft = { sections: [{ format: 2, maxTeamsPerHeat: '2' }], laneHatbands: ['Red', 'Lilac #B79CED'] } as unknown as CreatorDraft;

  it('shows a custom colour by its name and keeps the colour when the name is changed', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<HatbandEditor draft={draft} change={change} />);
    const box = screen.getByLabelText('Hatband colour for lane 2');
    expect(box).toHaveValue('Lilac');
    await user.type(box, 's');
    expect(change).toHaveBeenLastCalledWith({ laneHatbands: ['Red', 'Lilacs #B79CED'] });
  });

  it('stores a typed colour word as it was typed', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<HatbandEditor draft={{ ...draft, laneHatbands: ['Red', 'Sea green'] } as unknown as CreatorDraft} change={change} />);
    await user.type(screen.getByLabelText('Hatband colour for lane 2'), ' ');
    expect(change).toHaveBeenLastCalledWith({ laneHatbands: ['Red', 'Sea green '] });
  });
});
