import type { CompetitionDetail, MySignup, SectionSignup, SignupPaymentStatus } from '../types';
import { clubLabel } from './clubName';

export type PassPaymentBadge = 'PAID' | 'PENDING' | 'REFUNDED' | 'CANCELLED';

export interface LorryStablingPassData {
  signupId: number;
  competitionId: number;
  competitionName: string;
  competitionStart: string;
  competitionEnd: string | null;
  venueLocation: string | null;
  venuePostcode: string | null;
  venueWhat3Words: string | null;
  sectionName: string;
  clubOrTeamName: string;
  entrantName: string;
  paymentStatus: PassPaymentBadge;
  stablesCount: number;
  stableAssignment: string;
  hookupAssignment: string | null;
  vehicleRegistration: string | null;
  arrivalNotes: string | null;
  verificationPath: string;
  verificationUrl: string;
}

export function paymentStatusBadgeLabel(status: SignupPaymentStatus): PassPaymentBadge {
  switch (status) {
    case 1:
      return 'PAID';
    case 2:
      return 'REFUNDED';
    case 3:
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}

export function stablingPassVerificationPath(competitionId: number, signupId: number): string {
  return `/competitions/${competitionId}/entries?pass=${signupId}`;
}

export function stablingPassVerificationUrl(
  competitionId: number,
  signupId: number,
  origin?: string,
): string {
  const base = (
    origin ?? (typeof window !== 'undefined' ? window.location.origin : 'https://mounted-games-app.vercel.app')
  ).replace(/\/+$/, '');
  return `${base}${stablingPassVerificationPath(competitionId, signupId)}`;
}

export function parsePassSignupIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('pass');
  if (!raw || !/^\d+$/.test(raw.trim())) return null;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveClubOrTeamLabel(input: {
  stablingClubOrTeam?: string | null;
  teamName?: string | null;
  ponyClubName?: string | null;
}): string {
  return (
    clubLabel(input.stablingClubOrTeam) ||
    clubLabel(input.teamName) ||
    clubLabel(input.ponyClubName)
  );
}

export function buildLorryStablingPassFromMySignup(
  signup: MySignup,
  origin?: string,
): LorryStablingPassData {
  const stablesCount = signup.stablesCount ?? 0;
  const assignedBoxes = signup.stableAssignment?.trim() || null;
  const stableAssignment =
    assignedBoxes ??
    (stablesCount > 0 ? 'To be allocated on arrival' : 'Day parking / no overnight stables');
  return {
    signupId: signup.id,
    competitionId: signup.competitionId,
    competitionName: signup.competitionName,
    competitionStart: signup.competitionStart,
    competitionEnd: signup.competitionEnd ?? null,
    venueLocation: signup.competitionLocation?.trim() || null,
    venuePostcode: signup.competitionPostcode?.trim() || null,
    venueWhat3Words: signup.competitionWhat3Words?.trim() || null,
    sectionName: signup.sectionName,
    clubOrTeamName: resolveClubOrTeamLabel(signup),
    entrantName: signup.fullName,
    paymentStatus: paymentStatusBadgeLabel(signup.status),
    stablesCount,
    stableAssignment,
    hookupAssignment: signup.hookupAssignment?.trim() || null,
    vehicleRegistration: signup.vehicleRegistration?.trim() || null,
    arrivalNotes: signup.arrivalNotes?.trim() || null,
    verificationPath: stablingPassVerificationPath(signup.competitionId, signup.id),
    verificationUrl: stablingPassVerificationUrl(signup.competitionId, signup.id, origin),
  };
}

export function buildLorryStablingPassFromSectionSignup(
  signup: SectionSignup,
  competition: Pick<
    CompetitionDetail,
    'id' | 'name' | 'startDate' | 'endDate' | 'location' | 'postcode' | 'what3Words'
  >,
  origin?: string,
): LorryStablingPassData {
  const stablesCount = signup.stablesCount ?? 0;
  const assignedBoxes = signup.stableAssignment?.trim() || null;
  const stableAssignment =
    assignedBoxes ??
    (stablesCount > 0 ? 'To be allocated on arrival' : 'Day parking / no overnight stables');
  return {
    signupId: signup.id,
    competitionId: competition.id,
    competitionName: competition.name,
    competitionStart: competition.startDate,
    competitionEnd: competition.endDate ?? null,
    venueLocation: competition.location?.trim() || null,
    venuePostcode: competition.postcode?.trim() || null,
    venueWhat3Words: competition.what3Words?.trim() || null,
    sectionName: signup.sectionName,
    clubOrTeamName: resolveClubOrTeamLabel(signup),
    entrantName: signup.fullName,
    paymentStatus: paymentStatusBadgeLabel(signup.status),
    stablesCount,
    stableAssignment,
    hookupAssignment: signup.hookupAssignment?.trim() || null,
    vehicleRegistration: signup.vehicleRegistration?.trim() || null,
    arrivalNotes: signup.arrivalNotes?.trim() || null,
    verificationPath: stablingPassVerificationPath(competition.id, signup.id),
    verificationUrl: stablingPassVerificationUrl(competition.id, signup.id, origin),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildOfflineWalletPassHtml(
  pass: LorryStablingPassData,
  qrSvgMarkup?: string,
): string {
  const venueParts = [
    pass.venueLocation,
    pass.venuePostcode,
    pass.venueWhat3Words ? `///${pass.venueWhat3Words.replace(/^\/+/, '')}` : null,
  ].filter((part): part is string => Boolean(part));
  const venueLine = venueParts.length > 0 ? venueParts.join(' · ') : 'Showground gate';
  const badgeBg = pass.paymentStatus === 'PAID' ? '#166534' : '#92400e';

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lorry &amp; Stabling Pass — ${escapeHtml(pass.clubOrTeamName)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #0f172a; }
    .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 20px; padding: 28px; box-shadow: 0 20px 40px rgba(0,0,0,0.35); border: 3px solid #0f172a; }
    .kicker { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #475569; margin: 0 0 6px; }
    .title { font-size: 28px; font-weight: 800; margin: 0 0 4px; }
    .sub { font-size: 14px; color: #334155; margin: 0 0 18px; }
    .badge { display: inline-block; padding: 5px 12px; border-radius: 999px; color: #fff; background: ${badgeBg}; font-weight: 800; font-size: 13px; letter-spacing: 0.06em; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 20px 0; padding: 16px 0; border-top: 2px dashed #cbd5e1; border-bottom: 2px dashed #cbd5e1; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 4px; font-weight: 700; }
    .value { font-size: 18px; font-weight: 800; color: #0f172a; }
    .qr { text-align: center; margin-top: 16px; }
    @media print { body { background: #fff; padding: 0; } .card { box-shadow: none; max-width: 100%; } }
  </style>
</head>
<body>
  <article class="card">
    <p class="kicker">Lorry Windscreen &amp; Stabling Pass · #${escapeHtml(String(pass.signupId))}</p>
    <h1 class="title">${escapeHtml(pass.clubOrTeamName)}</h1>
    <p class="sub">${escapeHtml(pass.competitionName)} · ${escapeHtml(venueLine)}</p>
    <span class="badge">${escapeHtml(pass.paymentStatus)}</span>
    <div class="grid">
      <div><div class="label">Barn / Stable Boxes</div><div class="value">${escapeHtml(pass.stableAssignment)}</div></div>
      <div><div class="label">Hook-up</div><div class="value">${escapeHtml(pass.hookupAssignment ?? 'None allocated')}</div></div>
      <div><div class="label">Stables Booked</div><div class="value">${escapeHtml(String(pass.stablesCount))}</div></div>
      <div><div class="label">Vehicle Reg</div><div class="value">${escapeHtml(pass.vehicleRegistration ?? 'Not recorded')}</div></div>
      <div><div class="label">Entrant</div><div class="value">${escapeHtml(pass.entrantName)}</div></div>
      <div><div class="label">Section</div><div class="value">${escapeHtml(pass.sectionName)}</div></div>
    </div>
    ${pass.arrivalNotes ? `<p class="sub"><strong>Arrival notes:</strong> ${escapeHtml(pass.arrivalNotes)}</p>` : ''}
    <div class="qr">
      ${qrSvgMarkup ?? ''}
      <p class="sub">${escapeHtml(pass.verificationUrl)}</p>
    </div>
  </article>
</body>
</html>`;
}

export function downloadOfflineWalletPass(
  pass: LorryStablingPassData,
  qrSvgMarkup?: string,
): string {
  const filename = `lorry-stabling-pass-${pass.competitionId}-${pass.signupId}.html`;
  if (typeof document === 'undefined') return filename;
  const html = buildOfflineWalletPassHtml(pass, qrSvgMarkup);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return filename;
}
