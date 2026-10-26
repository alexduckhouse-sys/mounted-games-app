import type { CustomEmailAudience, EmailBlock, EmailLink, EmailPage } from './customEmailTypes';

/** What a link opens: one of an event's pages on the site, or any https address. */
export type LinkTo = 'competition' | 'entry' | 'timetable' | 'results' | 'address';

export interface LinkTarget { to: LinkTo; competitionId: number | null; address: string }
export interface LinkDraft extends LinkTarget { words: string }
export interface PictureDraft { imageId: string; url: string; name: string }

export interface EmailDraft {
  audience: CustomEmailAudience;
  kind: 'text' | 'picture';
  subject: string;
  message: string;
  links: LinkDraft[];
  picture: PictureDraft | null;
  /** Where the picture opens; `null` when it doesn't link anywhere. */
  pictureLink: LinkTarget | null;
  /** The footer line when it has been edited; `null` means the usual one. */
  footerText: string | null;
  footerPicture: PictureDraft | null;
}

export const LINK_TO_OPTIONS: { value: LinkTo; label: string }[] = [
  { value: 'competition', label: 'Competition page' },
  { value: 'entry', label: 'Entry form' },
  { value: 'timetable', label: 'Timetable' },
  { value: 'results', label: 'Results' },
  { value: 'address', label: 'A web address' },
];

const PAGE_OF: Record<Exclude<LinkTo, 'address'>, EmailPage> = { competition: 0, entry: 1, timetable: 2, results: 3 };

export const MAX_LINKS = 20;
export const MAX_PICTURE_BYTES = 500 * 1024;
export const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** The audiences, in the order shown: the API's number, and the short name used on this page. */
export const AUDIENCES: { audience: CustomEmailAudience; label: string; list: string }[] = [
  { audience: 0, label: 'News list', list: 'the news list' },
  { audience: 1, label: 'Trainers', list: 'the trainers' },
  { audience: 2, label: 'Organisers and admins', list: 'the organisers and admins' },
  { audience: 3, label: 'Admins', list: 'the admins' },
];

export const audienceLabel = (audience: number) => AUDIENCES.find((a) => a.audience === audience)?.label ?? 'Everyone';

/** The usual footer line for an audience. It matches what the API uses when none is given. */
export const defaultFooter = (audience: CustomEmailAudience) => (audience === 0
  ? 'You’re getting this because you asked to hear about new competitions.'
  : 'You’re getting this because you run or help run competitions on Mounted Games.');

export const isHttps = (value: string) => /^https:\/\/\S+$/i.test(value.trim());

export const emptyTarget = (competitionId: number | null): LinkTarget => ({ to: 'entry', competitionId, address: '' });

export const emptyDraft = (audience: CustomEmailAudience = 0): EmailDraft => ({
  audience, kind: 'text', subject: '', message: '', links: [], picture: null, pictureLink: null, footerText: null, footerPicture: null,
});

/** The fields that say where a link goes, or null while the choice isn't complete. */
export function targetFields(target: LinkTarget): Pick<EmailLink, 'url' | 'competitionId' | 'page'> | null {
  if (target.to === 'address') return isHttps(target.address) ? { url: target.address.trim() } : null;
  return target.competitionId === null ? null : { competitionId: target.competitionId, page: PAGE_OF[target.to] };
}

/** "Entry form · Spring Open", or the web address. */
export function describeTarget(target: LinkTarget, eventName: (id: number) => string | undefined): string {
  if (target.to === 'address') return target.address.trim();
  const page = LINK_TO_OPTIONS.find((o) => o.value === target.to)?.label ?? '';
  const event = target.competitionId === null ? undefined : eventName(target.competitionId);
  return event ? `${page} · ${event}` : page;
}

export interface Part { text: string; link: boolean }

/** A message cut into paragraphs, the way the email will be: blank lines make paragraphs. */
export const paragraphsOf = (text: string): string[] => text.trim().replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

/**
 * Each paragraph as pieces of text, some of them links. A link goes on the first place its words appear (ignoring case)
 * that isn't already part of another link, which is what the API does. `missing` lists words that appear nowhere.
 */
export function linkedParagraphs(text: string, links: { words: string }[]): { paragraphs: Part[][]; missing: string[] } {
  const paragraphs = paragraphsOf(text);
  const marks = paragraphs.map(() => [] as { at: number; len: number }[]);
  const missing: string[] = [];
  for (const link of links) {
    const needle = link.words.trim().toLowerCase();
    let placed = false;
    for (let p = 0; p < paragraphs.length && !placed && needle; p += 1) {
      const hay = paragraphs[p].toLowerCase();
      let from = 0;
      for (;;) {
        const at = hay.indexOf(needle, from);
        if (at < 0) break;
        if (marks[p].some((m) => at < m.at + m.len && at + needle.length > m.at)) { from = at + 1; continue; }
        marks[p].push({ at, len: needle.length });
        placed = true;
        break;
      }
    }
    if (!placed) missing.push(link.words);
  }
  return {
    missing,
    paragraphs: paragraphs.map((paragraph, p) => {
      const parts: Part[] = [];
      let pos = 0;
      for (const m of [...marks[p]].sort((a, b) => a.at - b.at)) {
        if (m.at > pos) parts.push({ text: paragraph.slice(pos, m.at), link: false });
        parts.push({ text: paragraph.slice(m.at, m.at + m.len), link: true });
        pos = m.at + m.len;
      }
      if (pos < paragraph.length) parts.push({ text: paragraph.slice(pos), link: false });
      return parts;
    }),
  };
}

/** The message with the words added to the end when they aren't in it yet. */
export function withWords(message: string, words: string): string {
  if (message.toLowerCase().includes(words.toLowerCase())) return message;
  return `${message.replace(/\s*$/, '')}${message.trim() ? ' ' : ''}${words}`;
}

/** The footer as it will read: the edited line, else the usual one. */
export const footerShown = (draft: EmailDraft) => (draft.footerText?.trim() ? draft.footerText.trim() : defaultFooter(draft.audience));

/** The blocks to send. Returns null while something is incomplete (see `whyNot`). */
export function buildBlocks(draft: EmailDraft): EmailBlock[] | null {
  const blocks: EmailBlock[] = [];
  if (draft.kind === 'text') {
    const links: EmailLink[] = [];
    for (const link of draft.links) {
      const fields = targetFields(link);
      if (!fields) return null;
      links.push({ words: link.words.trim(), ...fields });
    }
    blocks.push({ type: 0, text: draft.message.trim(), links });
  } else {
    if (!draft.picture) return null;
    const block: EmailBlock = { type: 1, imageId: draft.picture.imageId, alt: draft.subject.trim().slice(0, 200) };
    if (draft.pictureLink) {
      const fields = targetFields(draft.pictureLink);
      if (!fields) return null;
      Object.assign(block, fields);
    }
    blocks.push(block);
  }
  const text = draft.footerText?.trim() ? draft.footerText.trim() : null;
  if (text || draft.footerPicture) blocks.push({ type: 4, text, imageId: draft.footerPicture?.imageId ?? null, alt: '' });
  return blocks;
}

/** Why the email can't be sent yet, or null when it can. */
export function whyNot(draft: EmailDraft, recipients: number | null): string | null {
  if (!draft.subject.trim()) return 'Add a subject.';
  if (draft.kind === 'text') {
    if (!draft.message.trim()) return 'Write the message.';
    const { missing } = linkedParagraphs(draft.message, draft.links);
    if (missing.length > 0) return `“${missing[0]}” isn’t in the message any more. Put the words back or remove the link.`;
  } else {
    if (!draft.picture) return 'Add the picture.';
    if (draft.pictureLink && !targetFields(draft.pictureLink)) return 'Finish the picture’s link, or choose Nothing.';
  }
  if (recipients === null) return 'Still counting who is on the list.';
  if (recipients === 0) return 'No one is on that list yet.';
  return null;
}

// ---- keeping the draft ----

export const DRAFT_KEY = 'mg.draft.admin-email';

/** The saved draft, or a fresh one when there is none or it can't be read. */
export function loadDraft(): EmailDraft {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyDraft();
    const saved = JSON.parse(raw) as Partial<EmailDraft> | null;
    if (!saved || typeof saved !== 'object') return emptyDraft();
    const base = emptyDraft();
    const picture = (value: unknown): PictureDraft | null => {
      const p = value as Partial<PictureDraft> | null;
      return p && typeof p.imageId === 'string' && typeof p.url === 'string' ? { imageId: p.imageId, url: p.url, name: String(p.name ?? '') } : null;
    };
    const target = (value: unknown): LinkTarget | null => {
      const t = value as Partial<LinkTarget> | null;
      return t && LINK_TO_OPTIONS.some((o) => o.value === t.to) ? { to: t.to as LinkTo, competitionId: typeof t.competitionId === 'number' ? t.competitionId : null, address: String(t.address ?? '') } : null;
    };
    return {
      audience: AUDIENCES.some((a) => a.audience === saved.audience) ? (saved.audience as CustomEmailAudience) : base.audience,
      kind: saved.kind === 'picture' ? 'picture' : 'text',
      subject: typeof saved.subject === 'string' ? saved.subject : '',
      message: typeof saved.message === 'string' ? saved.message : '',
      links: Array.isArray(saved.links) ? saved.links.flatMap((l) => { const t = target(l); return t && typeof (l as LinkDraft).words === 'string' ? [{ ...t, words: (l as LinkDraft).words }] : []; }) : [],
      picture: picture(saved.picture),
      pictureLink: target(saved.pictureLink),
      footerText: typeof saved.footerText === 'string' ? saved.footerText : null,
      footerPicture: picture(saved.footerPicture),
    };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(draft: EmailDraft) {
  try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* storage is off or full: the draft just isn't kept */ }
}
