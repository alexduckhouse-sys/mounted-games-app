import { resolvePaymentLinkUrl } from './paymentLink';

/**
 * Normalises a phone number for `wa.me` deep links (digits only, with UK `07...` converted to `447...`).
 */
export function cleanWhatsAppPhone(phone?: string | null): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) {
    return digits.slice(2);
  }
  if (digits.startsWith('07') && digits.length === 11) {
    return `44${digits.slice(1)}`;
  }
  return digits;
}

/**
 * Builds a `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}` deep link.
 */
export function whatsAppUrl(text: string, phone?: string | null): string {
  const cleanPhone = cleanWhatsAppPhone(phone);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

/**
 * Opens a `wa.me` deep link in a new tab/window and returns the generated URL.
 */
export function shareViaWhatsApp(text: string, phone?: string | null): string {
  const url = whatsAppUrl(text, phone);
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return url;
}

function formatPounds(amountMinor: number): string {
  const pounds = Math.max(0, amountMinor) / 100;
  return Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
}

export interface PaymentReminderWhatsAppOptions {
  entrantName: string;
  competitionName: string;
  sectionName?: string | null;
  amountMinor: number;
  reference: string;
  paymentDestination?: string | null;
  paymentLinkUrl?: string | null;
}

/**
 * Builds a friendly 1-tap WhatsApp BACS payment reminder message for an unpaid entrant.
 */
export function formatPaymentReminderWhatsApp(options: PaymentReminderWhatsAppOptions): string {
  const firstName = options.entrantName.trim().split(/\s+/)[0] || 'there';
  const sectionPart = options.sectionName?.trim() ? ` (${options.sectionName.trim()})` : '';
  const amount = formatPounds(options.amountMinor);
  const lines = [
    `Hi ${firstName}, quick reminder for ${options.competitionName.trim()}${sectionPart}.`,
    `Amount due: ${amount}`,
    `Payment reference: ${options.reference.trim()}`,
  ];
  const destination = options.paymentDestination?.trim();
  if (destination) {
    lines.push(`Bank details: ${destination}`);
  }
  const paymentLink = resolvePaymentLinkUrl({
    paymentLinkUrl: options.paymentLinkUrl,
    paymentDestination: options.paymentDestination,
  });
  if (paymentLink && (!destination || !destination.includes(paymentLink))) {
    lines.push(`Pay online by card / Apple Pay: ${paymentLink}`);
  }
  return lines.join('\n');
}

export interface TreasurerBacsWhatsAppOptions {
  competitionName: string;
  sectionName?: string | null;
  clubOrTeamName?: string | null;
  amountMinor: number;
  reference: string;
  paymentDestination?: string | null;
  paymentLinkUrl?: string | null;
}

/**
 * Builds a 1-tap WhatsApp message for a trainer or team manager to forward BACS transfer details
 * and the exact payment reference to their club treasurer.
 */
export function formatTreasurerBacsWhatsApp(options: TreasurerBacsWhatsAppOptions): string {
  const amount = formatPounds(options.amountMinor);
  const details = [options.competitionName.trim()];
  if (options.sectionName?.trim()) details.push(options.sectionName.trim());
  if (options.clubOrTeamName?.trim()) details.push(options.clubOrTeamName.trim());
  const lines = [
    `Entry payment for ${details.join(' — ')}`,
    `Amount: ${amount}`,
    `Payment reference: ${options.reference.trim()}`,
  ];
  const destination = options.paymentDestination?.trim();
  if (destination) {
    lines.push(`Bank details:\n${destination}`);
  }
  const paymentLink = resolvePaymentLinkUrl({
    paymentLinkUrl: options.paymentLinkUrl,
    paymentDestination: options.paymentDestination,
  });
  if (paymentLink && (!destination || !destination.includes(paymentLink))) {
    lines.push(`Pay online by card / Apple Pay: ${paymentLink}`);
  }
  return lines.join('\n');
}

export interface VolunteerLinkWhatsAppOptions {
  competitionName?: string | null;
  label: string;
  url: string;
  arenaName?: string | null;
}

/**
 * Builds a 1-tap WhatsApp message to send a Scorer, Camera, or Big Screen link to a volunteer.
 */
export function formatVolunteerLinkWhatsApp(options: VolunteerLinkWhatsAppOptions): string {
  const compPrefix = options.competitionName?.trim() ? `${options.competitionName.trim()} — ` : '';
  const arenaPart = options.arenaName?.trim() ? ` (${options.arenaName.trim()})` : '';
  return `${compPrefix}${options.label.trim()}${arenaPart}:\n${options.url.trim()}`;
}
