/**
 * Minimal CSV helpers — quote anything with commas, newlines or double-quotes;
 * double up embedded quotes; build a Blob and trigger a download.
 */

function escape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const lines = [header.map(escape).join(',')];
  for (const r of rows) lines.push(r.map(escape).join(','));
  return lines.join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  // BOM ensures Excel opens UTF-8 correctly (umlauts in club names etc.).
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

/** Sanitises a string for use in a filename (windows-safe). */
export function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_.]+/g, '_').slice(0, 80);
}

const STATUS_LABEL: Record<number, string> = {
  0: 'pending', 1: 'paid', 2: 'refunded', 3: 'cancelled',
};

interface SignupRow {
  sectionName: string;
  fullName: string;
  ponyClubName?: string | null;
  contactInfo?: string | null;
  amountMinor: number;
  status: number;
  paidAt?: string | null;
  createdAt: string;
}

/**
 * CSV of signups for a single competition. Columns kept narrow so it opens
 * cleanly in Excel / Google Sheets without horizontal scroll.
 */
export function signupsToCsv(signups: ReadonlyArray<SignupRow>): string {
  const header = [
    'Section', 'Name', 'Pony Club', 'Contact', 'Amount (GBP)',
    'Status', 'Paid at', 'Signed up at',
  ];
  const rows = signups.map((s) => [
    s.sectionName,
    s.fullName,
    s.ponyClubName ?? '',
    s.contactInfo ?? '',
    (s.amountMinor / 100).toFixed(2),
    STATUS_LABEL[s.status] ?? String(s.status),
    s.paidAt ?? '',
    s.createdAt,
  ]);
  return toCsv(header, rows);
}
