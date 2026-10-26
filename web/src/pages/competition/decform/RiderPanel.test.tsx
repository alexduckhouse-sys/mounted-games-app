import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { blankRider, riderReady, type DecRider } from '../../../lib/decForm';
import { BASIC_CONFIG, type DecFormConfig } from '../../../lib/decFormConfig';
import { RiderPanel } from './RiderPanel';
import { api } from '../../../api';

function Harness({ config, reserve = false, start = {} }: { config: DecFormConfig; reserve?: boolean; start?: Partial<DecRider> }) {
  const [form, setForm] = useState<DecRider>({ ...blankRider(), fullName: 'Ella', pony: 'Pickle', ...start });
  return (
    <RiderPanel title="Add a rider" reserve={reserve} editing={false} form={form} choices={[]} addLabel="Add rider"
      ready={riderReady(form, reserve, undefined, config)} config={config}
      onChange={(patch) => setForm((cur) => ({ ...cur, ...patch }))} onPick={vi.fn()} onCommit={vi.fn()} onClose={vi.fn()} />
  );
}

const config = (patch: Partial<DecFormConfig> = {}): DecFormConfig => ({ ...BASIC_CONFIG, ...patch });

describe('RiderPanel on a set-up dec form', () => {
  it('hides the previous pony certification immediately when the lookup changes', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: { found: true, certified: true, status: 'Certified', officialNotes: 'Test pony inspection' } });
    render(<Harness config={config()} start={{ ponyOwnerFullName: 'Test Owner' }} />);
    expect(await screen.findByText(/Test pony inspection/)).toBeInTheDocument();
    get.mockReturnValue(new Promise(() => {}));
    fireEvent.change(screen.getByLabelText('Pony'), { target: { value: 'Different test pony' } });
    expect(screen.queryByText(/Test pony inspection/)).not.toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('asks only for a name and a pony on the basic form', () => {
    render(<Harness config={BASIC_CONFIG} />);
    expect(screen.getByLabelText('Rider')).toBeInTheDocument();
    expect(screen.getByLabelText('Pony')).toBeInTheDocument();
    for (const label of [/Date of birth/, /Year of birth/, /Age group/, /Height/, /weight/i, /passport/i, /Membership/, /Emergency/, /Medical/]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Add rider' })).toBeEnabled();
  });

  it('asks for a birth year, then an age group, marking optional ones', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness config={config({ dob: 1, dobFormat: 1 })} />);
    expect(screen.getByText('(optional)')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Year of birth/), '14');
    expect(screen.getByText('Enter a four-digit year, like 2014.')).toBeInTheDocument();
    rerender(<Harness config={config({ dob: 2, dobFormat: 2 })} />);
    expect(screen.getByLabelText('Age group')).toBeInTheDocument();
  });

  it('shows weight in kilograms or in stone and pounds', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness config={config({ weight: 2 })} />);
    expect(screen.getByText('kg')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Rider’s weight'), '3x');
    expect(screen.getByLabelText('Rider’s weight')).toHaveValue(3);
    unmount();
    render(<Harness config={config({ weight: 2, weightUnit: 1 })} />);
    expect(screen.getByLabelText('Weight, stone')).toBeInTheDocument();
    expect(screen.getByLabelText('Weight, pounds')).toBeInTheDocument();
    expect(screen.getByText('Still needed: weight.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Weight, stone'), '5');
    expect(screen.queryByText(/Still needed/)).not.toBeInTheDocument();
  });

  it('asks for an emergency contact in full, and for pony details but not for a reserve', async () => {
    const user = userEvent.setup();
    const c = config({ emergencyContact: 2, ponyPassport: 1, ponyAge: 1, membershipNumber: 1, medicalNotes: 1, ponyHeight: 1 });
    const { unmount } = render(<Harness config={c} />);
    expect(screen.getByLabelText(/Pony passport/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Pony’s age/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Membership number/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Emergency contact/), 'Mum');
    expect(screen.getByRole('alert')).toHaveTextContent('Give both a name and a phone number');
    await user.type(screen.getByLabelText(/Their phone number/), '07700');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Medical notes/), 'Asthma');
    await user.type(screen.getByLabelText(/Height/), 'tall');
    expect(screen.getByText('Use hands, like 13.2 (inches run 0 to 3).')).toBeInTheDocument();
    unmount();
    render(<Harness config={c} reserve />);
    expect(screen.queryByLabelText(/Pony passport/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Pony’s age/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Pony (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Height (hh) (optional)')).toBeInTheDocument();
  });

  it('shows the limit, and an amber warning that goes away when the number is back in range', async () => {
    const user = userEvent.setup();
    render(<Harness config={config({ customFields: [
      { id: 'g', label: 'Girth', type: 1, required: true, min: null, max: 90, unit: 'cm' },
      { id: 't', label: 'Saddle', type: 0, required: false },
    ] })} />);
    expect(screen.getByText('No more than 90 cm')).toBeInTheDocument();
    expect(screen.getByText('Still needed: Girth.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Girth'), '120');
    expect(screen.getByRole('status')).toHaveTextContent('Girth is above the limit');
    expect(screen.getByRole('button', { name: 'Add rider' })).toBeEnabled();
    await user.clear(screen.getByLabelText('Girth'));
    await user.type(screen.getByLabelText('Girth'), '60');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Saddle/), '17');
    expect(screen.getByLabelText(/Saddle/)).toHaveValue('17');
  });
});
