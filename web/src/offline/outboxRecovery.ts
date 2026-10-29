import { getActiveLang, translate } from '../i18n/translate';
import type { MessageKey } from '../i18n/en';
import type { MessageValues } from '../i18n/messages';
const t = (key: MessageKey, values?: MessageValues) => translate(getActiveLang(), key, values);
import { encode } from 'uqr';
import type { QueuedScore } from './scoreOutbox';

const PREFIX = 'MG-SCORES-1';
const MAX_FRAMES = 512;
function checksum(text: string): string {
  let n = 2166136261;
  for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619);
  return (n >>> 0).toString(16).padStart(8, '0');
}
export function backupFrames(raw: string): string[] {
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  const total = Math.ceil(encoded.length / 900);
  if (!total || total > MAX_FRAMES) throw new Error(t('reliability.tooLarge'));
  const id = checksum(encoded);
  return Array.from({ length: total }, (_, i) => `${PREFIX}:${id}:${i + 1}:${total}:${encoded.slice(i * 900, (i + 1) * 900)}`);
}
export function readBackupFrame(value: string): { id: string; index: number; total: number; data: string } {
  const match = value.trim().match(/^MG-SCORES-1:([a-f0-9]{8}):(\d+):(\d+):([A-Za-z0-9+/=]{1,900})$/);
  if (!match) throw new Error(t('reliability.invalidQr'));
  const index = Number(match[2]), total = Number(match[3]);
  if (index < 1 || index > total || total > MAX_FRAMES) throw new Error(t('reliability.incompleteCode'));
  return { id: match[1], index, total, data: match[4] };
}
export function joinBackupFrames(values: string[]): { raw?: string; received: number; total: number } {
  if (!values.length) return { received: 0, total: 0 };
  const frames = values.map(readBackupFrame), first = frames[0];
  const parts = new Map<number, string>();
  for (const f of frames) {
    if (f.id !== first.id || f.total !== first.total) throw new Error(t('reliability.mixed'));
    if (parts.has(f.index) && parts.get(f.index) !== f.data) throw new Error(t('reliability.damagedCode'));
    parts.set(f.index, f.data);
  }
  if (parts.size !== first.total) return { received: parts.size, total: first.total };
  const encoded = Array.from({ length: first.total }, (_, i) => parts.get(i + 1)).join('');
  if (checksum(encoded) !== first.id) throw new Error(t('reliability.damaged'));
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
    return { raw, received: parts.size, total: first.total };
  } catch { throw new Error(t('reliability.damaged')); }
}
/** The uncompressed PDF includes the original recovery frames, so the PDF itself is importable. */
export function recoveryText(raw: string): string {
  if (!raw.includes(PREFIX)) return raw;
  const source = raw.startsWith('%PDF-') ? raw.split('\n').filter(line => line.startsWith('%MG-SCORES-1:')).join('\n') : raw;
  const frames = source.match(/MG-SCORES-1:[a-f0-9]{8}:\d+:\d+:[A-Za-z0-9+/=]+/g) ?? [];
  const joined = joinBackupFrames(frames);
  if (!joined.raw) throw new Error(t('reliability.incomplete', { n: joined.received, total: joined.total }));
  return joined.raw;
}

function pdfText(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&');
}
/** Small, uncompressed PDF writer. No fonts, image downloads or network calls are needed. */
export function scoreBackupPdf(raw: string, scores: QueuedScore[], competitionName: string, savedAt: string): Blob {
  const frames = backupFrames(raw);
  const pages: string[] = [];
  const lines = [competitionName, t('reliability.pdfTitle'), t('reliability.deviceTime', { time: savedAt }), t('reliability.unsent', { n: scores.length }),
    t('reliability.privateCopy'), t('reliability.provisionalPoints'), ''];
  for (const q of scores) {
    const context: QueuedScore & { arenaName?: string; sessionName?: string; lanes?: Record<number, number>; previewPoints?: Record<number, number> } = q;
    lines.push(`${context.arenaName ? `${context.arenaName} | ` : ''}${context.sessionName || t('reliability.session', { id: q.sessionId })} | ${q.label}`, t('reliability.saved', { time: q.queuedAt }));
    for (const p of q.places) {
      const status = p.eliminated ? ({ 1: 'E', 2: 'DNS', 3: 'DNF', 4: 'R' }[p.status ?? 1] ?? 'E') : String(p.place);
      const preview = context.previewPoints?.[p.teamId];
      const points = p.eliminated ? 0 : typeof preview === 'number' && Number.isFinite(preview) && preview >= 0
        ? preview : typeof p.points === 'number' && Number.isFinite(p.points) && p.points >= 0 ? p.points : t('reliability.calculate');
      lines.push((context.lanes?.[p.teamId] ? `#${context.lanes[p.teamId]} | ` : '') + t('reliability.result', { team: q.teamNames[p.teamId] ?? t('reliability.team', { id: p.teamId }), place: status, points }));
    }
    lines.push('');
  }
  lines.push(t('reliability.olderBackup'), t('reliability.originalData'));
  const wrapped = lines.flatMap(line => line.match(/.{1,90}/g) ?? ['']);
  for (let offset = 0; offset < wrapped.length; offset += 48) {
    pages.push('BT /F1 11 Tf 45 795 Td 15 TL\n' + wrapped.slice(offset, offset + 48).map(line => `(${pdfText(line)}) Tj T*`).join('\n') + '\nET');
  }
  frames.forEach((frame, index) => {
    const qr = encode(frame, { ecc: 'M', border: 4 }).data;
    const scale = 390 / qr.length;
    let content = `BT /F1 12 Tf 45 795 Td (${pdfText(t('reliability.recoveryCode', { n: index + 1, total: frames.length }))}) Tj 0 -20 Td (${pdfText(t('reliability.pdfScan'))}) Tj ET\n`;
    qr.forEach((row, y) => row.forEach((on, x) => { if (on) content += `${(100 + x * scale).toFixed(3)} ${(340 + (qr.length - y - 1) * scale).toFixed(3)} ${scale.toFixed(3)} ${scale.toFixed(3)} re f\n`; }));
    content += 'BT /F1 7 Tf 45 310 Td 10 TL\n' + (frame.match(/.{1,105}/g) ?? []).map(line => `(${pdfText(line)}) Tj T*`).join('\n') + '\nET';
    pages.push(content);
  });
  const objects = ['', '<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pageIds: number[] = [];
  for (const content of pages) {
    const pageId = objects.length, streamId = pageId + 1;
    pageIds.push(pageId);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`;
  let pdf = '%PDF-1.4\n' + frames.map(frame => `%${frame}\n`).join('');
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets[i] = pdf.length; pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}
