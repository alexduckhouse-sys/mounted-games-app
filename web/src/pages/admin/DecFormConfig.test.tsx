import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BASIC_CONFIG, STANDARD_CONFIG, type DecFormConfig } from '../../lib/decFormConfig';
import { chooseOption, selectedValue } from '../../test/select';
import { DecFormConfigEditor } from './DecFormConfig';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../../api', () => ({ api }));

const response = (config: DecFormConfig, isStandard = false, formsSubmitted = 0) => ({ data: { config, isStandard, formsSubmitted } });
const part = (name: RegExp | string) => screen.getByRole('combobox', { name });

beforeEach(() => {
  api.get.mockResolvedValue(response(STANDARD_CONFIG, true));
  api.put.mockImplementation(async (_url: string, body: DecFormConfig) => response(body, false, 0));
});

describe('DecFormConfigEditor', () => {
  it('starts on the standard form and says so', async () => {
    render(<DecFormConfigEditor competitionId={9} />);
    expect(await screen.findByText(/trainers see the standard form/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/competitions/9/dec-form-config');
    expect(selectedValue(part('The rider: Age'))).toBe('2');
    expect(selectedValue(part('The pony: Height'))).toBe('2');
    expect(selectedValue(part('The rider: Weight'))).toBe('0');
    expect(screen.getByText(/never show on public pages/)).toBeInTheDocument();
  });

  it('explains when it can’t load or hasn’t yet', async () => {
    api.get.mockRejectedValueOnce(new Error('offline'));
    const { unmount } = render(<DecFormConfigEditor competitionId={9} />);
    expect(await screen.findByText(/Couldn’t load the dec form setup/)).toBeInTheDocument();
    unmount();
    api.get.mockResolvedValueOnce({ data: '<html>' });
    render(<DecFormConfigEditor competitionId={9} />);
    expect(screen.getByText(/Loading the dec form setup/)).toBeInTheDocument();
    expect(await screen.findByText(/Couldn’t load the dec form setup/)).toBeInTheDocument();
  });

  it('turns parts on, picks their format and saves the setup', async () => {
    const user = userEvent.setup();
    render(<DecFormConfigEditor competitionId={9} />);
    await screen.findByText(/trainers see the standard form/);

    await user.click(screen.getByRole('button', { name: 'Start from the basics' }));
    expect(selectedValue(part('The rider: Age'))).toBe('0');
    expect(screen.queryByText('What to ask for')).not.toBeInTheDocument();

    chooseOption(part('The rider: Age'), 'Optional');
    chooseOption(screen.getByRole('combobox', { name: 'What to ask for' }), 'Year of birth only');
    chooseOption(part('The rider: Weight'), 'Required');
    chooseOption(screen.getByRole('combobox', { name: 'Show weight in' }), 'Stone and pounds (st, lb)');
    chooseOption(part('Membership and safety: Medical notes'), 'Required');
    chooseOption(part('The pony: Passport or ID number'), 'Optional');

    await user.click(screen.getByRole('button', { name: 'Save the dec form' }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][0]).toBe('/competitions/9/dec-form-config');
    expect(api.put.mock.calls[0][1]).toMatchObject({
      dob: 1, dobFormat: 1, weight: 2, weightUnit: 1, medicalNotes: 2, ponyPassport: 1, ponyHeight: 0, customFields: [],
    });
    expect(await screen.findByText('Dec form setup saved')).toBeInTheDocument();
    expect(screen.queryByText(/trainers see the standard form/)).not.toBeInTheDocument();
  });

  it('adds a number question with a limit and removes another', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(response({ ...BASIC_CONFIG, customFields: [{ id: 'f1', label: 'Saddle', type: 0, required: false }] }, false, 4));
    render(<DecFormConfigEditor competitionId={9} />);
    expect(await screen.findByText(/The 4 already in keep the answers they have/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add a question' }));
    const labels = screen.getAllByLabelText('Question');
    await user.type(labels[1], 'Girth');
    const types = screen.getAllByRole('combobox', { name: 'Answer is' });
    chooseOption(types[1], 'A number');
    await user.type(screen.getByLabelText('Unit'), 'cm');
    await user.type(screen.getByLabelText('Can’t be above'), '90.5');
    await user.type(screen.getByLabelText('Can’t be below'), '20');
    chooseOption(screen.getAllByRole('combobox', { name: 'Must be answered' })[1], 'Yes, required');

    await user.click(screen.getByRole('button', { name: 'Remove Saddle' }));
    await user.click(screen.getByRole('button', { name: 'Save the dec form' }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1].customFields).toEqual([
      { id: 'f2', label: 'Girth', type: 1, required: true, min: 20, max: 90.5, unit: 'cm' },
    ]);
  });

  it('clears the limits when a question goes back to text, and lets a limit be emptied', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(response({ ...BASIC_CONFIG, customFields: [{ id: 'f1', label: 'Girth', type: 1, required: false, min: 1, max: 9, unit: 'cm' }] }));
    render(<DecFormConfigEditor competitionId={9} />);
    await screen.findByLabelText('Can’t be above');
    await user.clear(screen.getByLabelText('Can’t be above'));
    await user.click(screen.getByRole('button', { name: 'Save the dec form' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0][1].customFields[0]).toMatchObject({ min: 1, max: null });

    chooseOption(screen.getByRole('combobox', { name: 'Answer is' }), 'Text');
    expect(screen.queryByLabelText('Can’t be above')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save the dec form' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect(api.put.mock.calls[1][1].customFields[0]).toMatchObject({ type: 0, min: null, max: null, unit: null });
  });

  it('won’t save a limit the wrong way round, or a question with no name', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(response({ ...BASIC_CONFIG, customFields: [{ id: 'f1', label: 'Girth', type: 1, required: false, min: 50, max: 10 }] }));
    render(<DecFormConfigEditor competitionId={9} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('smallest allowed is bigger');
    expect(screen.getByRole('button', { name: 'Save the dec form' })).toBeDisabled();

    await user.clear(screen.getByLabelText('Can’t be below'));
    await user.clear(screen.getByLabelText('Question'));
    expect(screen.getByRole('alert')).toHaveTextContent('Give every extra field a name.');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('shows the reason when saving fails', async () => {
    const user = userEvent.setup();
    api.put.mockRejectedValueOnce({ response: { data: { message: 'Two extra fields share an id.' } } });
    render(<DecFormConfigEditor competitionId={9} />);
    await screen.findByText(/trainers see the standard form/);
    await user.click(screen.getByRole('button', { name: 'Save this setup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Two extra fields share an id.');
  });

  it('can return to the standard form and keeps the questions', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(response({ ...BASIC_CONFIG, weight: 2, customFields: [{ id: 'f1', label: 'Girth', type: 0, required: false }] }));
    render(<DecFormConfigEditor competitionId={9} />);
    await screen.findByLabelText('Question');
    await user.click(screen.getByRole('button', { name: 'Use the standard form' }));
    expect(selectedValue(part('The rider: Age'))).toBe('2');
    expect(selectedValue(part('The rider: Weight'))).toBe('0');
    expect(screen.getByLabelText('Question')).toHaveValue('Girth');
  });

  it('is read-only for people who can’t change it', async () => {
    api.get.mockResolvedValue(response(BASIC_CONFIG));
    render(<DecFormConfigEditor competitionId={9} readOnly />);
    await screen.findByText('Your own questions');
    expect(screen.getByRole('button', { name: 'Start from the basics' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add a question' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save the dec form' })).toBeDisabled();
    expect(part('The rider: Weight')).toBeDisabled();
  });

  it('stops at twelve questions', async () => {
    api.get.mockResolvedValue(response({ ...BASIC_CONFIG, customFields: Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, label: `Q${i}`, type: 0 as const, required: false })) }));
    render(<DecFormConfigEditor competitionId={9} />);
    await screen.findByText('Your own questions');
    expect(screen.getByRole('button', { name: 'Add a question' })).toBeDisabled();
  });
});
