import { describe, expect, it, vi } from 'vitest';
import {
  cleanWhatsAppPhone,
  formatPaymentReminderWhatsApp,
  formatTreasurerBacsWhatsApp,
  formatVolunteerLinkWhatsApp,
  shareViaWhatsApp,
  whatsAppUrl,
} from './whatsapp';

describe('whatsapp', () => {
  it('cleans UK and international phone numbers for wa.me', () => {
    expect(cleanWhatsAppPhone(null)).toBe('');
    expect(cleanWhatsAppPhone('   ')).toBe('');
    expect(cleanWhatsAppPhone('no-digits')).toBe('');
    expect(cleanWhatsAppPhone('07700 900123')).toBe('447700900123');
    expect(cleanWhatsAppPhone('+44 7700 900123')).toBe('447700900123');
    expect(cleanWhatsAppPhone('00353 87 123 4567')).toBe('353871234567');
  });

  it('builds wa.me URLs and opens them in a new window when sharing', () => {
    expect(whatsAppUrl('Hello Arena 1', '07700 900123')).toBe(
      'https://wa.me/447700900123?text=Hello%20Arena%201',
    );
    expect(whatsAppUrl('Hello Treasurer')).toBe('https://wa.me/?text=Hello%20Treasurer');

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const url = shareViaWhatsApp('Test message', '07700 900123');
    expect(url).toBe('https://wa.me/447700900123?text=Test%20message');
    expect(openSpy).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('formats organiser BACS payment reminders with optional payment link', () => {
    const reminder = formatPaymentReminderWhatsApp({
      entrantName: 'Jamie Carter',
      competitionName: 'Spring Championships',
      sectionName: 'Under 17 Teams',
      amountMinor: 12000,
      reference: 'WARW-42',
      paymentDestination: 'Sort code 12-34-56 Acc 12345678',
      paymentLinkUrl: 'https://buy.stripe.com/test_123',
    });
    expect(reminder).toContain('Hi Jamie, quick reminder for Spring Championships (Under 17 Teams).');
    expect(reminder).toContain('Amount due: £120');
    expect(reminder).toContain('Payment reference: WARW-42');
    expect(reminder).toContain('Bank details: Sort code 12-34-56 Acc 12345678');
    expect(reminder).toContain('Pay online by card / Apple Pay: https://buy.stripe.com/test_123');

    const fallbackName = formatPaymentReminderWhatsApp({
      entrantName: '   ',
      competitionName: 'Summer Gala',
      amountMinor: 4550,
      reference: 'GALA-9',
    });
    expect(fallbackName).toContain('Hi there, quick reminder for Summer Gala.');
    expect(fallbackName).toContain('Amount due: £45.50');
  });

  it('formats treasurer BACS forwarding messages', () => {
    const msg = formatTreasurerBacsWhatsApp({
      competitionName: 'Spring Championships',
      sectionName: 'Open Pairs',
      clubOrTeamName: 'Warwickshire Hunt',
      amountMinor: 6500,
      reference: 'WARW-88',
      paymentDestination: 'Sort code 12-34-56 Acc 12345678',
      paymentLinkUrl: 'https://pay.sumup.com/b2c/Q123',
    });
    expect(msg).toContain('Entry payment for Spring Championships — Open Pairs — Warwickshire Hunt');
    expect(msg).toContain('Amount: £65');
    expect(msg).toContain('Payment reference: WARW-88');
    expect(msg).toContain('Sort code 12-34-56 Acc 12345678');
    expect(msg).toContain('Pay online by card / Apple Pay: https://pay.sumup.com/b2c/Q123');

    const minimal = formatTreasurerBacsWhatsApp({
      competitionName: 'Spring Championships',
      amountMinor: 5000,
      reference: 'REF-1',
    });
    expect(minimal).toBe('Entry payment for Spring Championships\nAmount: £50\nPayment reference: REF-1');
  });

  it('formats volunteer scorer and camera WhatsApp links', () => {
    expect(
      formatVolunteerLinkWhatsApp({
        competitionName: 'Spring Championships',
        label: 'Scorer link',
        arenaName: 'Arena 1',
        url: 'https://mounted-games-app.vercel.app/score/tok_123',
      }),
    ).toBe(
      'Spring Championships — Scorer link (Arena 1):\nhttps://mounted-games-app.vercel.app/score/tok_123',
    );
    expect(
      formatVolunteerLinkWhatsApp({
        label: 'Big screen',
        url: 'https://mounted-games-app.vercel.app/competitions/4/screen',
      }),
    ).toBe('Big screen:\nhttps://mounted-games-app.vercel.app/competitions/4/screen');
  });
});
