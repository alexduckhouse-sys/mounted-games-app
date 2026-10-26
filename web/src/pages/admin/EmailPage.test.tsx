import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { DRAFT_KEY } from './emailDraft';
import { EmailPage } from './EmailPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const comp = (id: number, name: string) => ({ id, name, location: 'Stoneleigh', startDate: '2026-11-08T09:00:00Z', endDate: null, isActive: true, isArchived: false, sectionCount: 1, teamCount: 1, sessionCount: 0 });
const summary = (extra: Record<string, unknown> = {}) => ({
  id: 7, subject: 'Spring news', audience: 0, status: 1, total: 3, sent: 3, failed: 0, skipped: 0, remaining: 0,
  createdAt: '2026-10-25T10:00:00Z', completedAt: '2026-10-25T10:05:00Z', createdByName: 'Demo Admin', ...extra,
});

let sentList: unknown[] = [];
let postHandler: (url: string, body: unknown) => unknown;

function mount() {
  return render(<MemoryRouter><EmailPage /></MemoryRouter>);
}
const png = () => new File([new Uint8Array(20)], 'poster.png', { type: 'image/png' });

describe('EmailPage', () => {
  beforeEach(() => {
    sentList = [summary({ id: 3, subject: 'Autumn dates', sent: 410, failed: 2, total: 412 })];
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/admin/custom-emails/audiences') return { data: [{ audience: 0, label: 'x', recipients: 3 }, { audience: 1, label: 'x', recipients: 64 }, { audience: 2, label: 'x', recipients: 70 }, { audience: 3, label: 'x', recipients: 6 }] } as never;
      if (url === '/competitions') return { data: [comp(5, 'Spring Open'), comp(6, 'Zone Champs')] } as never;
      if (url === '/admin/custom-emails') return { data: sentList } as never;
      return { data: [] } as never;
    });
    postHandler = () => ({});
    vi.mocked(api.post).mockImplementation(async (url: string, body?: unknown) => ({ data: postHandler(url, body) }) as never);
  });

  it('shows To with each list’s count, Email, Subject, the message and the sent list', async () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Email' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'To: News list · 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email: Text' })).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(await screen.findByText('Autumn dates')).toBeInTheDocument();
    expect(screen.getByText(/25 Oct · News list · 410 sent · 2 didn’t go/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'To: News list · 3' }));
    const options = within(screen.getByRole('listbox', { name: 'To' })).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['News list · 3', 'Trainers · 64', 'Organisers and admins · 70', 'Admins · 6']);
    await user.click(screen.getByRole('option', { name: 'Trainers · 64' }));
    expect(screen.getByRole('button', { name: 'To: Trainers · 64' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send to 64 people/ })).toBeDisabled();
    expect(screen.queryByText('An unsubscribe link is always added for the news list.')).not.toBeInTheDocument();
  });

  it('adds a link on words, putting them at the end of the message when they are not there, and lists it with Remove', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Message'), 'Entries are open.');
    await user.click(screen.getByRole('button', { name: 'Add a link' }));
    await user.type(screen.getByLabelText('Words to link'), 'Enter now');
    expect(screen.getByRole('button', { name: 'Links to: Entry form' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add link' })).toBeEnabled();
    await user.click(await screen.findByRole('button', { name: 'Event: Spring Open' }));
    await user.click(screen.getByRole('option', { name: 'Zone Champs' }));
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByLabelText('Message')).toHaveValue('Entries are open. Enter now');
    const list = screen.getByRole('list', { name: 'Links in the message' });
    expect(within(list).getByText('Entry form · Zone Champs')).toBeInTheDocument();
    expect(screen.getAllByText('Enter now').some((el) => el.tagName === 'U')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Remove the link on Enter now' }));
    expect(screen.queryByRole('list', { name: 'Links in the message' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue('Entries are open. Enter now');
  });

  it('links words already in the message in place, and takes a web address that must be https', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Message'), 'Read the rules first.');
    await user.click(screen.getByRole('button', { name: 'Add a link' }));
    await user.type(screen.getByLabelText('Words to link'), 'rules');
    await user.click(screen.getByRole('button', { name: 'Links to: Entry form' }));
    await user.click(screen.getByRole('option', { name: 'A web address' }));
    expect(screen.queryByRole('button', { name: /^Event/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Web address'), 'http://example.org');
    expect(screen.getByText('Web addresses must start with https://')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add link' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Web address'));
    await user.type(screen.getByLabelText('Web address'), 'https://example.org/rules');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByLabelText('Message')).toHaveValue('Read the rules first.');
    expect(screen.getByText('https://example.org/rules')).toBeInTheDocument();
    // Cancel closes the form without adding anything.
    await user.click(screen.getByRole('button', { name: 'Add a link' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Words to link')).not.toBeInTheDocument();
  });

  it('shows a picture email: upload, link choice with Nothing, and the picture in the preview', async () => {
    const user = userEvent.setup();
    postHandler = (url) => (url === '/admin/custom-email-images' ? { id: 'img-1', url: '/api/email-images/img-1', bytes: 20 } : {});
    mount();
    await user.click(screen.getByRole('button', { name: 'Email: Text' }));
    await user.click(screen.getByRole('option', { name: 'A picture' }));
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Links to: Nothing' })).toBeInTheDocument();
    await user.upload(screen.getByLabelText('Email picture, file'), png());
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/custom-email-images', expect.any(File), { headers: { 'Content-Type': 'image/png' } }));
    expect(await screen.findByText('poster.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Links to: Nothing' }));
    await user.click(screen.getByRole('option', { name: 'Timetable' }));
    expect(await screen.findByRole('button', { name: 'Event: Spring Open' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Links to: Timetable' }));
    await user.click(screen.getByRole('option', { name: 'Nothing' }));
    expect(screen.queryByRole('button', { name: /^Event/ })).not.toBeInTheDocument();
  });

  it('refuses a picture that is the wrong type or too big, and says what the server said when it fails', async () => {
    const user = userEvent.setup({ applyAccept: false });
    mount();
    await user.click(screen.getByRole('button', { name: 'Email: Text' }));
    await user.click(screen.getByRole('option', { name: 'A picture' }));
    const input = screen.getByLabelText('Email picture, file');
    await user.upload(input, new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PNG, JPG or WebP');
    await user.upload(input, new File([new Uint8Array(500 * 1024 + 1)], 'big.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('500 KB or smaller');
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { detail: 'That file isn’t a PNG, JPEG or WebP image.' } } });
    await user.upload(input, png());
    expect(await screen.findByRole('alert')).toHaveTextContent('isn’t a PNG, JPEG or WebP image');
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('takes a picture dropped on the zone, and one pasted on the page', async () => {
    postHandler = () => ({ id: 'img-2', url: '/api/email-images/img-2', bytes: 20 });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Email: Text' }));
    await user.click(screen.getByRole('option', { name: 'A picture' }));
    const zone = screen.getByRole('button', { name: /Email picture: drop, paste or choose one/ });
    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute('data-over', 'true');
    fireEvent.drop(zone, { dataTransfer: { files: [png()] } });
    expect(await screen.findByText('poster.png')).toBeInTheDocument();
    fireEvent.paste(document.body, { clipboardData: { files: [new File([new Uint8Array(5)], 'shot.png', { type: 'image/png' })] } });
    expect(await screen.findByText('shot.png')).toBeInTheDocument();
    fireEvent.paste(screen.getByRole('button', { name: /Email picture: shot.png/ }), { clipboardData: { files: [new File([new Uint8Array(5)], 'again.png', { type: 'image/png' })] } });
    expect(await screen.findByText('again.png')).toBeInTheDocument();
  });

  it('keeps a footer picture and footer text, with a way back to the usual line', async () => {
    postHandler = () => ({ id: 'img-3', url: '/api/email-images/img-3', bytes: 20 });
    const user = userEvent.setup();
    mount();
    const text = screen.getByLabelText('Footer text');
    expect(text).toHaveValue('You’re getting this because you asked to hear about new competitions.');
    expect(screen.getByText('An unsubscribe link is always added for the news list.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use the usual one' })).not.toBeInTheDocument();
    await user.clear(text);
    await user.type(text, 'From the club.');
    await user.click(screen.getByRole('button', { name: 'Use the usual one' }));
    expect(text).toHaveValue('You’re getting this because you asked to hear about new competitions.');
    await user.upload(screen.getByLabelText('Footer picture, file'), png());
    expect(await screen.findByText('poster.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove the picture' }));
    expect(screen.queryByText('poster.png')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Email: Text' }));
  });

  it('previews an ordinary email with a From / To / Subject strip and the footer last', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: 'To: News list · 3' });
    await user.type(screen.getByLabelText('Subject'), 'New dates');
    await user.type(screen.getByLabelText('Message'), 'Hello there.{enter}{enter}Second one.');
    const preview = document.querySelector('.em-prev') as HTMLElement;
    expect(within(preview).getByText('Mounted Games')).toBeInTheDocument();
    expect(within(preview).getByText('News list (3)')).toBeInTheDocument();
    expect(within(preview).getByText('New dates')).toBeInTheDocument();
    expect(within(preview).getByText('Hello there.')).toBeInTheDocument();
    expect(within(preview).getByText('Second one.')).toBeInTheDocument();
    expect(within(preview).getByText('Unsubscribe')).toBeInTheDocument();
    expect(within(preview).queryByRole('button')).not.toBeInTheDocument();
    expect(within(preview).queryByRole('link')).not.toBeInTheDocument();
    // Phone: the tabs switch between the two panes.
    await user.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('.em-grid')).toHaveAttribute('data-view', 'preview');
    await user.click(screen.getByRole('tab', { name: 'Write' }));
    expect(document.querySelector('.em-grid')).toHaveAttribute('data-view', 'write');
  });

  it('keeps the draft as it is made, with no save button, and brings it back', async () => {
    const user = userEvent.setup();
    const first = mount();
    await user.type(screen.getByLabelText('Subject'), 'Kept');
    await user.type(screen.getByLabelText('Message'), 'Draft text');
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? '{}')).toMatchObject({ subject: 'Kept', message: 'Draft text' });
    first.unmount();
    mount();
    expect(screen.getByLabelText('Subject')).toHaveValue('Kept');
    expect(screen.getByLabelText('Message')).toHaveValue('Draft text');
  });

  async function fillReady(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('button', { name: 'To: News list · 3' });
    await user.type(screen.getByLabelText('Subject'), 'Spring news');
    await user.type(screen.getByLabelText('Message'), 'Entries are open.');
  }

  it('asks first with the full preview, then sends in batches with progress, and offers the failures again', async () => {
    const user = userEvent.setup();
    const batches = [summary({ status: 0, sent: 1, remaining: 2 }), summary({ status: 1, sent: 2, failed: 1, remaining: 0 })];
    postHandler = (url) => {
      if (url === '/admin/custom-emails') return summary({ status: 0, sent: 0, total: 3, remaining: 3 });
      if (url === '/admin/custom-emails/7/send-batch') return batches.shift() ?? summary({ failed: 0 });
      if (url === '/admin/custom-emails/7/retry-failed') return summary({ status: 0, sent: 2, failed: 0, remaining: 1 });
      return {};
    };
    mount();
    await fillReady(user);
    expect(screen.getByRole('button', { name: 'Send me a test' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Send to 3 people' }));
    const dialog = screen.getByRole('dialog', { name: 'Send this email?' });
    expect(within(dialog).getByText(/To the news list, 3 people\. It can’t be unsent\./)).toBeInTheDocument();
    expect(within(dialog).getByText('Entries are open.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Not yet' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Send to 3 people' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send to 3 people' }));
    expect(await screen.findByText('Sent. 1 didn’t go through.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/admin/custom-emails', {
      subject: 'Spring news', audience: 0, confirm: true, expectedRecipients: 3,
      blocks: [{ type: 0, text: 'Entries are open.', links: [] }],
    });
    expect(api.post).toHaveBeenCalledWith('/admin/custom-emails/7/send-batch');
    // The form is clear for the next email.
    expect(screen.getByLabelText('Subject')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Try those again' }));
    expect(await screen.findByText('Sent.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/admin/custom-emails/7/retry-failed');
    expect(screen.queryByRole('button', { name: 'Try those again' })).not.toBeInTheDocument();
  });

  it('shows Sending… X of N with a bar, and Stop sending cancels', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => undefined;
    vi.mocked(api.post).mockImplementation((async (url: string) => {
      if (url === '/admin/custom-emails') return { data: summary({ status: 0, total: 3, sent: 0, remaining: 3 }) };
      if (url === '/admin/custom-emails/7/send-batch') return new Promise((resolve) => { release = resolve; });
      if (url === '/admin/custom-emails/7/cancel') return { data: summary({ status: 2, sent: 1, remaining: 0 }) };
      return { data: {} };
    }) as never);
    mount();
    await fillReady(user);
    await user.click(screen.getByRole('button', { name: 'Send to 3 people' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send to 3 people' }));
    const status = await screen.findByText('Sending… 0 of 3');
    expect(status).toBeInTheDocument();
    expect(screen.getByText('Keep this page open while it sends.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to 3 people' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop sending' }));
    expect(await screen.findByText('Stopped after 1 person.')).toBeInTheDocument();
    release({ data: summary({ status: 0, sent: 2, remaining: 1 }) });
    await waitFor(() => expect(screen.queryByText(/Sending…/)).not.toBeInTheDocument());
    expect(screen.getByText('Stopped after 1 person.')).toBeInTheDocument();
  });

  it('says so when sending drops out, and carries on from where it was', async () => {
    const user = userEvent.setup();
    let calls = 0;
    vi.mocked(api.post).mockImplementation((async (url: string) => {
      if (url === '/admin/custom-emails') return { data: summary({ status: 0, total: 3, sent: 0, remaining: 3 }) };
      if (url === '/admin/custom-emails/7/send-batch') {
        calls += 1;
        if (calls === 1) throw new Error('offline');
        return { data: summary({ sent: 3 }) };
      }
      return { data: {} };
    }) as never);
    mount();
    await fillReady(user);
    await user.click(screen.getByRole('button', { name: 'Send to 3 people' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send to 3 people' }));
    expect(await screen.findByText('Paused. 0 of 3')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Carry on' }));
    expect(await screen.findByText('Sent.')).toBeInTheDocument();
  });

  it('picks up a send that was left part-way when the page is opened again', async () => {
    sentList = [summary({ id: 9, status: 0, total: 10, sent: 4, remaining: 6, subject: 'Half done' })];
    postHandler = (url) => (url === '/admin/custom-emails/9/send-batch' ? summary({ id: 9, total: 10, sent: 10, remaining: 0 }) : {});
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText('Paused. 4 of 10')).toBeInTheDocument();
    expect(screen.getByText(/sending, 4 of 10/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Carry on' }));
    expect(await screen.findByText('Sent.')).toBeInTheDocument();
  });

  it('shows what the API says when it will not send, and nothing was sent', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { message: 'The email can’t be made yet.', problems: ['Block 1: write some text or remove it.'] } } });
    mount();
    await fillReady(user);
    await user.click(screen.getByRole('button', { name: 'Send to 3 people' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send to 3 people' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Block 1: write some text or remove it.');
    expect(screen.getByLabelText('Subject')).toHaveValue('Spring news');
  });

  it('sends the links with the message, and a picture email with its footer', async () => {
    const user = userEvent.setup();
    postHandler = (url) => (url === '/admin/custom-email-images' ? { id: 'img-9', url: '/api/email-images/img-9', bytes: 20 } : url === '/admin/custom-emails' ? summary({ status: 1 }) : summary());
    mount();
    await screen.findByRole('button', { name: 'To: News list · 3' });
    await user.type(screen.getByLabelText('Subject'), 'Both');
    await user.type(screen.getByLabelText('Message'), 'Enter now please.');
    await user.click(screen.getByRole('button', { name: 'Add a link' }));
    await user.type(screen.getByLabelText('Words to link'), 'Enter now');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.clear(screen.getByLabelText('Footer text'));
    await user.type(screen.getByLabelText('Footer text'), 'From the club.');
    await user.click(screen.getByRole('button', { name: 'Send me a test' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/custom-emails/test', {
      subject: 'Both', audience: 0,
      blocks: [{ type: 0, text: 'Enter now please.', links: [{ words: 'Enter now', competitionId: 5, page: 1 }] }, { type: 4, text: 'From the club.', imageId: null, alt: '' }],
    }));

    await user.click(screen.getByRole('button', { name: 'Email: Text' }));
    await user.click(screen.getByRole('option', { name: 'A picture' }));
    await user.upload(screen.getByLabelText('Email picture, file'), png());
    await screen.findByText('poster.png');
    await user.click(screen.getByRole('button', { name: 'Links to: Nothing' }));
    await user.click(screen.getByRole('option', { name: 'A web address' }));
    await user.type(screen.getByLabelText('Web address'), 'https://example.org/poster');
    await user.click(screen.getByRole('button', { name: /Send me a test/ }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/admin/custom-emails/test', {
      subject: 'Both', audience: 0,
      blocks: [{ type: 1, imageId: 'img-9', alt: 'Both', url: 'https://example.org/poster' }, { type: 4, text: 'From the club.', imageId: null, alt: '' }],
    }));
  });

  it('says when the test went and when it did not', async () => {
    const user = userEvent.setup();
    postHandler = () => ({ status: 1 });
    mount();
    await fillReady(user);
    await user.click(screen.getByRole('button', { name: 'Send me a test' }));
    expect(await screen.findByRole('button', { name: 'Test sent to you' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Subject'), '!');
    expect(screen.getByRole('button', { name: 'Send me a test' })).toBeInTheDocument();
    postHandler = () => ({ status: 3 });
    await user.click(screen.getByRole('button', { name: 'Send me a test' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('test email wasn’t sent');
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { message: 'Your account has no email address to send a test to.' } } });
    await user.click(screen.getByRole('button', { name: 'Send me a test' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('no email address'));
  });

  it('holds the buttons back, and says why, while the email is not ready', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: 'To: News list · 3' });
    expect(screen.getByRole('button', { name: 'Send to 3 people' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send me a test' })).toBeDisabled();
    await user.type(screen.getByLabelText('Message'), 'Enter now please.');
    expect(screen.getByText('Add a subject.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Subject'), 'S');
    expect(screen.getByRole('button', { name: 'Send to 3 people' })).toBeEnabled();
    // Words that were linked and then edited out of the message stop it being sent.
    await user.click(screen.getByRole('button', { name: 'Add a link' }));
    await user.type(screen.getByLabelText('Words to link'), 'Enter now');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.clear(screen.getByLabelText('Message'));
    await user.type(screen.getByLabelText('Message'), 'Gone');
    expect(screen.getByText('Not in the message any more')).toBeInTheDocument();
    expect(screen.getByText(/isn’t in the message any more/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to 3 people' })).toBeDisabled();
  });

  it('says so when the lists cannot be counted', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/admin/custom-emails/audiences' || url === '/admin/custom-emails') throw new Error('offline');
      return { data: [] } as never;
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('count who is on each list');
    expect(await screen.findByText('Nothing sent yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
