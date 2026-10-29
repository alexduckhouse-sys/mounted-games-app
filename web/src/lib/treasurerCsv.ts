import { tr } from '../i18n/translate';
import { toCsv } from './csv';
import type { SectionSignup, SignupPaymentStatus, Team } from '../types';

export interface TreasurerSignupRow extends SectionSignup {
  stablesCount?: number;
  hookupsCount?: number;
  stablingClubOrTeam?: string | null;
  paymentMethod?: string | null;
  isWaitlist?: boolean;
  isWithdrawn?: boolean;
  refundPending?: boolean;
  teamsCount?: number;
}

export interface TreasurerOrderLine {
  id: number;
  listingId?: number;
  catalogueItemId?: number;
  title: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  detail?: string | null;
}

export interface TreasurerOrderRow {
  id: number;
  competitionId: number;
  buyerUserId?: string;
  isTestOrder?: boolean;
  buyerName?: string | null;
  status: number; // 0 AwaitingManualPayment, 1 AwaitingTestPayment, 2 Paid, 3 Declined, 4 Cancelled, 5 Refunded
  totalMinor: number;
  currency?: string;
  paidAt?: string | null;
  cancelledAt?: string | null;
  refundedAt?: string | null;
  createdAt: string;
  lines: TreasurerOrderLine[];
}

export interface TreasurerTotals {
  grossEntriesMinor: number;
  grossStablingMinor: number;
  grossShopMinor: number;
  totalRefundsMinor: number;
  netTotalCollectedMinor: number;
  totalPendingMinor: number;
}

export interface TreasurerCsvInput {
  competitionId?: number;
  competitionName?: string;
  signups: TreasurerSignupRow[];
  orders?: TreasurerOrderRow[];
  teams?: Team[];
  /** Optional unit price (in pence) for stables booked directly on an entry when not already in shop orders. */
  stablingUnitPriceMinor?: number;
}

export interface BankStatementLine {
  lineNumber: number;
  date: string;
  reference: string;
  amountMinor: number;
  rawText: string;
}

export type BankMatchStatus = 'matched' | 'amount_mismatch' | 'unmatched';

export interface BankStatementMatchRow {
  lineNumber: number;
  date: string;
  reference: string;
  amountMinor: number;
  status: BankMatchStatus;
  targetKind: 'signup' | 'order' | null;
  targetId: number | null;
  matchedLabel: string | null;
  expectedAmountMinor: number | null;
  approved: boolean;
}

const SIGNUP_STATUS_LABELS: Record<SignupPaymentStatus, string> = {
  0: 'Pending',
  1: 'Paid',
  2: 'Refunded',
  3: 'Cancelled',
};

const ORDER_STATUS_LABELS: Record<number, string> = {
  0: 'Awaiting BACS',
  1: 'Awaiting test payment',
  2: 'Paid',
  3: 'Declined',
  4: 'Cancelled',
  5: 'Refunded',
};

export function isStableItemTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  if (!lower.includes('stable') && !lower.includes('stabling')) return false;
  return !lower.includes('shaving') && !lower.includes('hay') && !lower.includes('bedding');
}

export function isHookupItemTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return (
    lower.includes('hook-up') ||
    lower.includes('hook up') ||
    lower.includes('hookup') ||
    lower.includes('electric')
  );
}

export function formatStablesCapacityPill(
  maxStables: number | null | undefined,
  stablesRemaining: number | null | undefined,
): string | null {
  if (maxStables == null || maxStables <= 0 || stablesRemaining == null) return null;
  const rem = Math.max(0, stablesRemaining);
  if (rem === 0) return 'All stables are booked';
  return `${rem} of ${maxStables} ${maxStables === 1 ? 'stable' : 'stables'} left`;
}

export function formatHookupsCapacityPill(
  maxHookups: number | null | undefined,
  hookupsRemaining: number | null | undefined,
): string | null {
  if (maxHookups == null || maxHookups <= 0 || hookupsRemaining == null) return null;
  const rem = Math.max(0, hookupsRemaining);
  if (rem === 0) return 'All electric hook-ups are booked';
  return `${rem} of ${maxHookups} ${maxHookups === 1 ? 'hook-up' : 'hook-ups'} left`;
}

export function formatMoneyPounds(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  return `${sign}£${(Math.abs(minor) / 100).toFixed(2)}`;
}

export function formatIsoDateShort(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

export function formatBacsReference(signupId: number, competitionId?: number): string {
  return competitionId && competitionId > 0 ? `MG-${competitionId}-${signupId}` : `MG-${signupId}`;
}

function isStablingOrHookupLine(title: string): boolean {
  return isStableItemTitle(title) || isHookupItemTitle(title);
}

export function computeTreasurerTotals(
  signups: TreasurerSignupRow[],
  orders: TreasurerOrderRow[] = [],
  stablingUnitPriceMinor = 0,
): TreasurerTotals {
  let grossEntriesMinor = 0;
  let grossStablingMinor = 0;
  let grossShopMinor = 0;
  let totalRefundsMinor = 0;
  let netTotalCollectedMinor = 0;
  let totalPendingMinor = 0;

  for (const s of signups) {
    const entryFee = Math.max(0, s.amountMinor ?? 0);
    const stablesFee = Math.max(0, s.stablesCount ?? 0) * Math.max(0, stablingUnitPriceMinor);
    const rowTotal = entryFee + stablesFee;

    if (s.status === 1) {
      grossEntriesMinor += entryFee;
      grossStablingMinor += stablesFee;
      if (s.refundPending) {
        totalRefundsMinor += rowTotal;
      } else {
        netTotalCollectedMinor += rowTotal;
      }
    } else if (s.status === 2) {
      grossEntriesMinor += entryFee;
      grossStablingMinor += stablesFee;
      // A partial refund keeps the rest of the entry fee as income.
      const refundedEntry = Math.min(entryFee, Math.max(0, s.refundedAmountMinor ?? entryFee));
      totalRefundsMinor += refundedEntry + stablesFee;
      netTotalCollectedMinor += entryFee - refundedEntry;
    } else if (s.status === 0 && !s.isWithdrawn && !s.isWaitlist) {
      totalPendingMinor += rowTotal;
    } else if (s.status === 3 && s.refundPending) {
      totalRefundsMinor += rowTotal;
    }
  }

  for (const order of orders) {
    let orderStablingMinor = 0;
    let orderOtherShopMinor = 0;
    for (const line of order.lines ?? []) {
      const lineTotal = Math.max(0, line.lineTotalMinor ?? line.unitPriceMinor * line.quantity);
      if (isStablingOrHookupLine(line.title)) {
        orderStablingMinor += lineTotal;
      } else {
        orderOtherShopMinor += lineTotal;
      }
    }
    const orderTotal =
      order.lines && order.lines.length > 0
        ? orderStablingMinor + orderOtherShopMinor
        : Math.max(0, order.totalMinor ?? 0);
    if (!order.lines || order.lines.length === 0) {
      orderOtherShopMinor = orderTotal;
    }

    if (order.status === 2) {
      grossStablingMinor += orderStablingMinor;
      grossShopMinor += orderOtherShopMinor;
      netTotalCollectedMinor += orderTotal;
    } else if (order.status === 5) {
      grossStablingMinor += orderStablingMinor;
      grossShopMinor += orderOtherShopMinor;
      totalRefundsMinor += orderTotal;
    } else if (order.status === 0 || order.status === 1) {
      totalPendingMinor += orderTotal;
    }
  }

  return {
    grossEntriesMinor,
    grossStablingMinor,
    grossShopMinor,
    totalRefundsMinor,
    netTotalCollectedMinor,
    totalPendingMinor,
  };
}

const TREASURER_HEADERS = [
  'Record Type',
  'ID',
  'BACS Reference',
  'Section / Category',
  'Entrant / Buyer',
  'Club / Team',
  'Items / Description',
  'Quantity',
  'Entry Fee',
  'Stables Count',
  'Stabling Fee',
  'Hook-ups Count',
  'Shop Total',
  'Row Total',
  'Payment Status',
  'Paid Date',
  'Refund Status',
] as const;

export function treasurerCsv(input: TreasurerCsvInput): string {
  const {
    competitionId,
    signups,
    orders = [],
    teams = [],
    stablingUnitPriceMinor = 0,
  } = input;

  const teamById = new Map<number, Team>(teams.map((t) => [t.id, t]));
  const rows: ReadonlyArray<unknown>[] = [];

  const sortedSignups = [...signups].sort((a, b) => a.id - b.id);
  for (const s of sortedSignups) {
    const team = s.teamId != null ? teamById.get(s.teamId) : undefined;
    const clubOrTeam =
      s.teamName?.trim() ||
      team?.displayName ||
      s.ponyClubName?.trim() ||
      s.stablingClubOrTeam?.trim() ||
      '';
    const stablesCount = Math.max(0, s.stablesCount ?? 0);
    const hookupsCount = Math.max(0, s.hookupsCount ?? 0);
    const entryFeeMinor = Math.max(0, s.amountMinor ?? 0);
    const stablingFeeMinor = stablesCount * Math.max(0, stablingUnitPriceMinor);
    const rowTotalMinor = entryFeeMinor + stablingFeeMinor;
    const teamsCount = Math.max(1, s.teamsCount ?? 1);

    const statusLabel = s.isWithdrawn
      ? 'Withdrawn'
      : s.isWaitlist
        ? 'Waitlist'
        : SIGNUP_STATUS_LABELS[s.status] ?? 'Pending';
    const refundStatus =
      s.status === 2 ? 'Refunded' : s.refundPending ? 'RefundPending' : '';

    rows.push([
      'Section Signup',
      s.id,
      formatBacsReference(s.id, competitionId),
      s.sectionName,
      s.fullName,
      clubOrTeam,
      s.isWholeTeam ? `Whole team entry (${teamsCount})` : 'Individual / pair entry',
      teamsCount,
      formatMoneyPounds(entryFeeMinor),
      stablesCount,
      formatMoneyPounds(stablingFeeMinor),
      hookupsCount,
      formatMoneyPounds(0),
      formatMoneyPounds(rowTotalMinor),
      statusLabel,
      formatIsoDateShort(s.paidAt),
      refundStatus,
    ]);

    if (s.status === 2 || s.refundPending) {
      rows.push([
        'Refund',
        s.id,
        formatBacsReference(s.id, competitionId),
        s.sectionName,
        s.fullName,
        clubOrTeam,
        s.status === 2 ? 'Entry refund completed' : 'Entry withdrawal — refund pending',
        teamsCount,
        formatMoneyPounds(entryFeeMinor),
        stablesCount,
        formatMoneyPounds(stablingFeeMinor),
        hookupsCount,
        formatMoneyPounds(0),
        formatMoneyPounds(rowTotalMinor),
        s.status === 2 ? 'Refunded' : 'RefundPending',
        formatIsoDateShort(s.paidAt),
        s.status === 2 ? 'Refunded' : 'RefundPending',
      ]);
    }
  }

  const sortedOrders = [...orders].sort((a, b) => a.id - b.id);
  for (const order of sortedOrders) {
    const orderLines = order.lines ?? [];
    const itemsSummary = orderLines
      .map((l) => `${l.title} x${l.quantity}${l.detail ? ` (${l.detail})` : ''}`)
      .join('; ');
    const totalQty = orderLines.reduce((acc, l) => acc + Math.max(0, l.quantity), 0);
    let stablesCount = 0;
    let stablingFeeMinor = 0;
    let hookupsCount = 0;
    let shopOnlyMinor = 0;
    for (const l of orderLines) {
      const lineTotal = Math.max(0, l.lineTotalMinor ?? l.unitPriceMinor * l.quantity);
      const isStable = isStableItemTitle(l.title);
      const isHookup = isHookupItemTitle(l.title);
      if (isStable) stablesCount += Math.max(0, l.quantity);
      if (isHookup) hookupsCount += Math.max(0, l.quantity);
      if (isStable || isHookup) {
        stablingFeeMinor += lineTotal;
      } else {
        shopOnlyMinor += lineTotal;
      }
    }
    const orderTotalMinor =
      orderLines.length > 0 ? stablingFeeMinor + shopOnlyMinor : Math.max(0, order.totalMinor ?? 0);
    if (orderLines.length === 0) {
      shopOnlyMinor = orderTotalMinor;
    }
    const statusLabel = ORDER_STATUS_LABELS[order.status] ?? 'Pending';
    const refundStatus = order.status === 5 ? 'Refunded' : '';

    rows.push([
      'Shop Order',
      order.id,
      `ORDER-${order.id}`,
      stablingFeeMinor > 0 && shopOnlyMinor === 0 ? 'Stabling & Hook-up' : 'Event Shop',
      order.buyerName ?? order.buyerUserId ?? '',
      '',
      itemsSummary || `Order #${order.id}`,
      totalQty,
      formatMoneyPounds(0),
      stablesCount,
      formatMoneyPounds(stablingFeeMinor),
      hookupsCount,
      formatMoneyPounds(shopOnlyMinor),
      formatMoneyPounds(orderTotalMinor),
      statusLabel,
      formatIsoDateShort(order.paidAt),
      refundStatus,
    ]);

    if (order.status === 5) {
      rows.push([
        'Refund',
        order.id,
        `ORDER-${order.id}`,
        'Event Shop',
        order.buyerName ?? order.buyerUserId ?? '',
        '',
        `Order #${order.id} refund`,
        totalQty,
        formatMoneyPounds(0),
        stablesCount,
        formatMoneyPounds(stablingFeeMinor),
        hookupsCount,
        formatMoneyPounds(shopOnlyMinor),
        formatMoneyPounds(orderTotalMinor),
        'Refunded',
        formatIsoDateShort(order.refundedAt ?? order.paidAt),
        'Refunded',
      ]);
    }
  }

  const totals = computeTreasurerTotals(signups, orders, stablingUnitPriceMinor);
  rows.push([
    'SUMMARY TOTALS',
    '',
    '',
    '',
    '',
    '',
    `Gross Entries: ${formatMoneyPounds(totals.grossEntriesMinor)} | Gross Stabling: ${formatMoneyPounds(totals.grossStablingMinor)} | Gross Shop: ${formatMoneyPounds(totals.grossShopMinor)} | Total Refunds: ${formatMoneyPounds(totals.totalRefundsMinor)} | Net Collected: ${formatMoneyPounds(totals.netTotalCollectedMinor)} | Total Pending: ${formatMoneyPounds(totals.totalPendingMinor)}`,
    '',
    formatMoneyPounds(totals.grossEntriesMinor),
    '',
    formatMoneyPounds(totals.grossStablingMinor),
    '',
    formatMoneyPounds(totals.grossShopMinor),
    formatMoneyPounds(totals.netTotalCollectedMinor),
    `Pending: ${formatMoneyPounds(totals.totalPendingMinor)}`,
    '',
    `Refunds: ${formatMoneyPounds(totals.totalRefundsMinor)}`,
  ]);

  return toCsv([...TREASURER_HEADERS], rows);
}

function splitCsvCells(line: string): string[] {
  const delimiter = line.includes('\t') ? '\t' : ',';
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseAmountToMinor(raw: string): number | null {
  const cleaned = raw.replace(/[£$,\s]/g, '').trim();
  if (!cleaned || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

function isHeaderRow(cells: string[]): boolean {
  const joined = cells.join(' ').toLowerCase();
  return (
    (joined.includes('date') || joined.includes('description') || joined.includes('reference')) &&
    (joined.includes('amount') || joined.includes('credit') || joined.includes('value') || joined.includes('paid in'))
  );
}

export function parseBankStatementCsv(text: string): BankStatementLine[] {
  if (!text || !text.trim()) return [];
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  const parsed: BankStatementLine[] = [];
  const balanceColIndices = new Set<number>();

  for (let idx = 0; idx < rawLines.length; idx++) {
    const raw = rawLines[idx].trim();
    if (!raw) continue;
    const cells = splitCsvCells(raw);
    if (idx === 0 && isHeaderRow(cells)) {
      cells.forEach((cell, cIdx) => {
        if (/\bbalance\b/i.test(cell)) balanceColIndices.add(cIdx);
      });
      continue;
    }

    let date = '';
    let reference = '';
    let amountMinor: number | null = null;

    if (cells.length >= 3) {
      date = cells[0];
      // Find the rightmost positive numeric amount column (excluding any 'Balance' column from the header)
      for (let c = cells.length - 1; c >= 1; c--) {
        if (balanceColIndices.has(c)) continue;
        const candidate = parseAmountToMinor(cells[c]);
        if (candidate !== null) {
          amountMinor = candidate;
          reference = cells.slice(1, c).filter(Boolean).join(' ').trim();
          break;
        }
      }
    } else if (cells.length === 2) {
      const secondAmount = parseAmountToMinor(cells[1]);
      if (secondAmount !== null) {
        reference = cells[0];
        amountMinor = secondAmount;
      }
    }

    if (amountMinor !== null && reference) {
      parsed.push({
        lineNumber: idx + 1,
        date,
        reference,
        amountMinor,
        rawText: raw,
      });
    }
  }

  return parsed;
}

function normaliseToken(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function matchBankStatementLines(
  lines: BankStatementLine[],
  signups: TreasurerSignupRow[],
  orders: TreasurerOrderRow[] = [],
  teams: Team[] = [],
): BankStatementMatchRow[] {
  const teamById = new Map<number, Team>(teams.map((t) => [t.id, t]));
  const pendingSignups = signups.filter(
    (s) => s.status === 0 && !s.isWithdrawn && !s.isWaitlist && (s.amountMinor ?? 0) > 0,
  );
  const pendingOrders = orders.filter(
    (o) => (o.status === 0 || o.status === 1) && (o.totalMinor ?? 0) > 0,
  );

  const usedSignupIds = new Set<number>();
  const usedOrderIds = new Set<number>();

  return lines.map((line): BankStatementMatchRow => {
    const refUpper = line.reference.toUpperCase();
    const refNorm = normaliseToken(line.reference);

    // 1. Explicit MG-<compId>-<signupId>, MG-<signupId>, or ENTRY-<signupId> reference
    const mgMatch = /\b(?:MG|ENTRY|SIGNUP)[-\s]*(?:\d+[-\s]+)?(\d+)\b/i.exec(refUpper);
    if (mgMatch) {
      const targetId = Number(mgMatch[1]);
      const signup = pendingSignups.find((s) => s.id === targetId && !usedSignupIds.has(s.id));
      if (signup) {
        const exactAmount = signup.amountMinor === line.amountMinor;
        if (exactAmount) usedSignupIds.add(signup.id);
        const label = formatSignupMatchLabel(signup, teamById);
        return {
          lineNumber: line.lineNumber,
          date: line.date,
          reference: line.reference,
          amountMinor: line.amountMinor,
          status: exactAmount ? 'matched' : 'amount_mismatch',
          targetKind: 'signup',
          targetId: signup.id,
          matchedLabel: label,
          expectedAmountMinor: signup.amountMinor,
          approved: exactAmount,
        };
      }
    }

    // 2. Explicit ORDER-<orderId> reference
    const orderMatch = /\bORDER[-\s#]*(\d+)\b/i.exec(refUpper);
    if (orderMatch) {
      const targetOrderId = Number(orderMatch[1]);
      const order = pendingOrders.find((o) => o.id === targetOrderId && !usedOrderIds.has(o.id));
      if (order) {
        const exactAmount = order.totalMinor === line.amountMinor;
        if (exactAmount) usedOrderIds.add(order.id);
        const label = `Order #${order.id}${order.buyerName ? ` · ${order.buyerName}` : ''}`;
        return {
          lineNumber: line.lineNumber,
          date: line.date,
          reference: line.reference,
          amountMinor: line.amountMinor,
          status: exactAmount ? 'matched' : 'amount_mismatch',
          targetKind: 'order',
          targetId: order.id,
          matchedLabel: label,
          expectedAmountMinor: order.totalMinor,
          approved: exactAmount,
        };
      }
    }

    // 3. Name / Team / Pony Club match on pending signups
    const nameMatchedSignups = pendingSignups.filter((s) => {
      if (usedSignupIds.has(s.id)) return false;
      const team = s.teamId != null ? teamById.get(s.teamId) : undefined;
      const candidates = [
        s.fullName,
        s.teamName,
        s.ponyClubName,
        s.stablingClubOrTeam,
        team?.displayName,
      ]
        .map(normaliseToken)
        .filter((c) => c.length >= 3);
      return candidates.some((c) => refNorm.includes(c));
    });

    const exactSignup =
      nameMatchedSignups.find((s) => s.amountMinor === line.amountMinor) ?? nameMatchedSignups[0];
    if (exactSignup) {
      const exactAmount = exactSignup.amountMinor === line.amountMinor;
      if (exactAmount) usedSignupIds.add(exactSignup.id);
      return {
        lineNumber: line.lineNumber,
        date: line.date,
        reference: line.reference,
        amountMinor: line.amountMinor,
        status: exactAmount ? 'matched' : 'amount_mismatch',
        targetKind: 'signup',
        targetId: exactSignup.id,
        matchedLabel: formatSignupMatchLabel(exactSignup, teamById),
        expectedAmountMinor: exactSignup.amountMinor,
        approved: exactAmount,
      };
    }

    // 4. Buyer name match on pending shop orders
    const nameMatchedOrders = pendingOrders.filter((o) => {
      if (usedOrderIds.has(o.id)) return false;
      const buyerNorm = normaliseToken(o.buyerName);
      return buyerNorm.length >= 3 && refNorm.includes(buyerNorm);
    });
    const exactOrder =
      nameMatchedOrders.find((o) => o.totalMinor === line.amountMinor) ?? nameMatchedOrders[0];
    if (exactOrder) {
      const exactAmount = exactOrder.totalMinor === line.amountMinor;
      if (exactAmount) usedOrderIds.add(exactOrder.id);
      return {
        lineNumber: line.lineNumber,
        date: line.date,
        reference: line.reference,
        amountMinor: line.amountMinor,
        status: exactAmount ? 'matched' : 'amount_mismatch',
        targetKind: 'order',
        targetId: exactOrder.id,
        matchedLabel: `Order #${exactOrder.id}${exactOrder.buyerName ? ` · ${exactOrder.buyerName}` : ''}`,
        expectedAmountMinor: exactOrder.totalMinor,
        approved: exactAmount,
      };
    }

    return {
      lineNumber: line.lineNumber,
      date: line.date,
      reference: line.reference,
      amountMinor: line.amountMinor,
      status: 'unmatched',
      targetKind: null,
      targetId: null,
      matchedLabel: null,
      expectedAmountMinor: null,
      approved: false,
    };
  });
}

function formatSignupMatchLabel(signup: TreasurerSignupRow, teamById: Map<number, Team>): string {
  const team = signup.teamId != null ? teamById.get(signup.teamId) : undefined;
  const group = signup.teamName?.trim() || team?.displayName || signup.ponyClubName?.trim();
  return group ? `${signup.fullName} (${group})` : signup.fullName;
}

export class AccountingExportError extends Error {}

export type AccountingPreset = 'xero' | 'quickbooks' | 'freeagent';

/** Manually recorded receipts and completed refunds, for a clearing account after checking against the bank. */
export function accountingCsv(input: TreasurerCsvInput, preset: AccountingPreset): string {
  const records: { date: string; amount: number; payee: string; description: string; reference: string }[] = [];
  const ukDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  function add(date: string | null | undefined, amount: number, payee: string, description: string, reference: string) {
    if (!Number.isSafeInteger(amount)) throw new AccountingExportError(tr('completion.penceError'));
    if (!amount) return;
    if (!date) throw new AccountingExportError(tr('completion.dateError'));
    const day = date.slice(0, 10);
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new AccountingExportError(tr('completion.dateError'));
    let recordedDay = day;
    if (date.length > 10) {
      // These API timestamps are UTC; SQLite may omit the suffix when reading them back.
      const utc = /Z|[+-]\d{2}:?\d{2}$/.test(date) ? date : `${date}Z`;
      const instant = new Date(utc);
      if (!Number.isFinite(instant.getTime())) throw new AccountingExportError(tr('completion.dateError'));
      recordedDay = ukDay.format(instant);
    }
    records.push({ date: recordedDay, amount, payee, description, reference });
  }
  for (const signup of input.signups) {
    // Withdrawal changes the entry status, not the historical receipt. A known fee
    // disposition without a date must fail validation rather than silently lose money.
    const cancelledReceipt = signup.status === 3 && (signup.paidAt != null || signup.refundPending
      || ['RefundPending', 'Refunded', 'Retained', 'CreditRollover'].includes(signup.feeDisposition ?? ''));
    if (signup.status !== 1 && signup.status !== 2 && !cancelledReceipt) continue;
    const reference = formatBacsReference(signup.id, input.competitionId);
    const description = `Entry · ${signup.sectionName} · ${input.competitionName ?? ''}`;
    add(signup.paidAt, signup.amountMinor, signup.fullName, description, reference);
    if (signup.status === 2) add(signup.dispositionUpdatedAt, -Math.min(signup.amountMinor, Math.max(0, signup.refundedAmountMinor ?? signup.amountMinor)), signup.fullName, `Refund · ${description}`, reference);
  }
  for (const order of input.orders ?? []) {
    if (order.isTestOrder || order.status !== 2 && order.status !== 5) continue;
    if (order.currency && order.currency.toUpperCase() !== 'GBP') throw new AccountingExportError(tr('completion.currencyError'));
    const description = `Shop · ${order.lines.map(line => line.title).join('; ')}`;
    const reference = `ORDER-${order.id}`;
    add(order.paidAt, order.totalMinor, order.buyerName ?? '', description, reference);
    if (order.status === 5) add(order.refundedAt, -order.totalMinor, order.buyerName ?? '', `Refund · ${description}`, reference);
  }
  records.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  const date = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const plain = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();
  if (preset === 'xero') return toCsv(['Date', 'Amount', 'Payee', 'Description', 'Reference'], records.map(r => [date(r.date), (r.amount / 100).toFixed(2), plain(r.payee), plain(r.description), r.reference]));
  const rows = records.map(r => [date(r.date), `${r.reference} · ${plain(r.description)} · ${plain(r.payee)}`, (r.amount / 100).toFixed(2)]);
  if (preset === 'quickbooks') return toCsv(['Date', 'Description', 'Amount'], rows);
  // FreeAgent requires no header, no quote marks and no line breaks within descriptions.
  return rows.map(([day, description, amount]) => `${day},${amount},${description.replace(/[,"\r\n]/g, ' ')}`).join('\r\n');
}
