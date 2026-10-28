import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageContext';
import { setActiveLang } from '../i18n/translate';
import { DemoPaymentNotice, type DemoPaymentKind } from './DemoPaymentNotice';

const ENGLISH: Record<DemoPaymentKind, string> = {
  entry: 'This is a demo. No money will be taken or sent, and your entry hasn’t been paid for.',
  order: 'This is a demo. No money will be taken or sent, and your order hasn’t been paid for.',
  payout: 'This is a demo. No money will be taken or sent, and your bank details won’t be used to pay anyone.',
};

afterEach(() => setActiveLang('en'));

describe('DemoPaymentNotice', () => {
  it.each(Object.entries(ENGLISH) as [DemoPaymentKind, string][])('names the %s in its own sentence', (what, sentence) => {
    render(<DemoPaymentNotice what={what} />);
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it('is a calm information strip that is part of the page, so it is not announced', () => {
    render(<DemoPaymentNotice what="entry" className="mt-3" />);
    const strip = screen.getByText(ENGLISH.entry).closest('.kit-strip');
    expect(strip).toHaveClass('kit-strip-info', 'mt-3');
    expect(strip).not.toHaveAttribute('role');
  });

  it('can carry a link, as on My signups', () => {
    render(<MemoryRouter><DemoPaymentNotice what="entry" actionLabel="Open the test payment page" actionTo="/me/signups/4/test-payment" /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Open the test payment page' })).toHaveAttribute('href', '/me/signups/4/test-payment');
  });

  it('can carry a button', async () => {
    const onAction = vi.fn();
    render(<DemoPaymentNotice what="order" actionLabel="Got it" onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['cy', 'entry', 'Arddangosiad yw hwn.'],
    ['cy', 'order', 'nid yw eich archeb wedi’i thalu'],
    ['fr', 'entry', 'Ceci est une démonstration.'],
    ['fr', 'payout', 'vos coordonnées bancaires'],
  ] as const)('reads in %s (%s)', (lang, what, fragment) => {
    render(<LanguageProvider initial={lang}><DemoPaymentNotice what={what} /></LanguageProvider>);
    expect(document.querySelector('.kit-strip')).toHaveTextContent(fragment);
  });
});
