import { describe, expect, it } from 'vitest';
import {
  DRAFT_KEY, audienceLabel, buildBlocks, defaultFooter, describeTarget, emptyDraft, footerShown, isHttps, linkedParagraphs, loadDraft, paragraphsOf, saveDraft,
  targetFields, whyNot, withWords, type EmailDraft, type LinkDraft,
} from './emailDraft';

const link = (words: string, extra: Partial<LinkDraft> = {}): LinkDraft => ({ words, to: 'address', competitionId: null, address: 'https://example.org', ...extra });
const draft = (extra: Partial<EmailDraft> = {}): EmailDraft => ({ ...emptyDraft(), subject: 'Hi', message: 'Hello there', ...extra });

describe('targets', () => {
  it('turns a choice into the fields the API wants, or null while it is incomplete', () => {
    expect(targetFields({ to: 'address', competitionId: null, address: ' https://example.org/a ' })).toEqual({ url: 'https://example.org/a' });
    expect(targetFields({ to: 'address', competitionId: null, address: 'http://example.org' })).toBeNull();
    expect(targetFields({ to: 'results', competitionId: 4, address: '' })).toEqual({ competitionId: 4, page: 3 });
    expect(targetFields({ to: 'competition', competitionId: 4, address: '' })).toEqual({ competitionId: 4, page: 0 });
    expect(targetFields({ to: 'timetable', competitionId: 4, address: '' })).toEqual({ competitionId: 4, page: 2 });
    expect(targetFields({ to: 'entry', competitionId: null, address: '' })).toBeNull();
    expect(isHttps('javascript:alert(1)')).toBe(false);
  });

  it('describes where a link goes', () => {
    const name = (id: number) => (id === 4 ? 'Spring Open' : undefined);
    expect(describeTarget({ to: 'entry', competitionId: 4, address: '' }, name)).toBe('Entry form · Spring Open');
    expect(describeTarget({ to: 'entry', competitionId: 9, address: '' }, name)).toBe('Entry form');
    expect(describeTarget({ to: 'entry', competitionId: null, address: '' }, name)).toBe('Entry form');
    expect(describeTarget({ to: 'address', competitionId: null, address: ' https://x.org ' }, name)).toBe('https://x.org');
  });
});

describe('linked words', () => {
  it('links the first place the words appear, ignoring case, and never inside another link', () => {
    const { paragraphs, missing } = linkedParagraphs('Enter now to win.\n\nNo, ENTER NOW today.', [{ words: 'enter now' }, { words: 'Enter' }, { words: 'today' }]);
    expect(missing).toEqual([]);
    expect(paragraphs[0]).toEqual([{ text: 'Enter now', link: true }, { text: ' to win.', link: false }]);
    // "Enter" can't sit inside the first link, so it goes on the next place it appears.
    expect(paragraphs[1]).toEqual([{ text: 'No, ', link: false }, { text: 'ENTER', link: true }, { text: ' NOW ', link: false }, { text: 'today', link: true }, { text: '.', link: false }]);
  });

  it('lists words that are nowhere, and keeps blank lines as paragraph breaks', () => {
    expect(linkedParagraphs('One\n\n\nTwo', [{ words: 'three' }, { words: ' ' }]).missing).toEqual(['three', ' ']);
    expect(paragraphsOf('  One\r\n\r\nTwo  \n\n')).toEqual(['One', 'Two']);
    expect(linkedParagraphs('', []).paragraphs).toEqual([]);
  });

  it('adds words to the end of the message only when they are not already in it', () => {
    expect(withWords('Hello', 'enter now')).toBe('Hello enter now');
    expect(withWords('', 'enter now')).toBe('enter now');
    expect(withWords('Please ENTER NOW.', 'enter now')).toBe('Please ENTER NOW.');
    expect(withWords('Hello  \n', 'go')).toBe('Hello go');
  });
});

describe('blocks to send', () => {
  it('sends a text email with its links, and a footer only when there is something in it', () => {
    expect(buildBlocks(draft({ message: ' Hello there ', links: [link('Hello', { to: 'entry', competitionId: 4 })] }))).toEqual([
      { type: 0, text: 'Hello there', links: [{ words: 'Hello', competitionId: 4, page: 1 }] },
    ]);
    const withFooter = buildBlocks(draft({ footerText: ' From us ', footerPicture: { imageId: 'f', url: '/u', name: 'f.png' } }));
    expect(withFooter?.[1]).toEqual({ type: 4, text: 'From us', imageId: 'f', alt: '' });
    expect(buildBlocks(draft({ footerPicture: { imageId: 'f', url: '/u', name: 'f.png' } }))?.[1]).toEqual({ type: 4, text: null, imageId: 'f', alt: '' });
    expect(buildBlocks(draft({ footerText: '   ' }))).toHaveLength(1);
    expect(buildBlocks(draft({ links: [link('Hello', { address: 'nope' })] }))).toBeNull();
  });

  it('sends a picture email with an optional link', () => {
    const picture = { imageId: 'p', url: '/u', name: 'p.png' };
    expect(buildBlocks(draft({ kind: 'picture', picture }))).toEqual([{ type: 1, imageId: 'p', alt: 'Hi' }]);
    expect(buildBlocks(draft({ kind: 'picture', picture, pictureLink: link('') }))).toEqual([{ type: 1, imageId: 'p', alt: 'Hi', url: 'https://example.org' }]);
    expect(buildBlocks(draft({ kind: 'picture', picture, pictureLink: link('', { address: 'x' }) }))).toBeNull();
    expect(buildBlocks(draft({ kind: 'picture' }))).toBeNull();
  });
});

describe('why an email is not ready', () => {
  it('names the first thing missing', () => {
    expect(whyNot(draft({ subject: ' ' }), 3)).toBe('Add a subject.');
    expect(whyNot(draft({ message: ' ' }), 3)).toBe('Write the message.');
    expect(whyNot(draft({ links: [link('gone')] }), 3)).toMatch(/gone.*isn.t in the message/);
    expect(whyNot(draft({ kind: 'picture' }), 3)).toBe('Add the picture.');
    const picture = { imageId: 'p', url: '/u', name: 'p.png' };
    expect(whyNot(draft({ kind: 'picture', picture, pictureLink: link('', { address: 'x' }) }), 3)).toMatch(/picture.s link/);
    expect(whyNot(draft(), null)).toMatch(/counting/);
    expect(whyNot(draft(), 0)).toBe('No one is on that list yet.');
    expect(whyNot(draft(), 3)).toBeNull();
  });
});

describe('footer and audiences', () => {
  it('has a usual footer for each audience, and shows the edited one when there is one', () => {
    expect(defaultFooter(0)).toMatch(/asked to hear about new competitions/);
    expect(defaultFooter(1)).toMatch(/run or help run competitions/);
    expect(footerShown(draft({ footerText: null }))).toBe(defaultFooter(0));
    expect(footerShown(draft({ footerText: ' Mine ' }))).toBe('Mine');
    expect(audienceLabel(3)).toBe('Admins');
    expect(audienceLabel(99)).toBe('Everyone');
  });
});

describe('the saved draft', () => {
  it('round-trips, and falls back to a fresh draft when what is stored is no use', () => {
    const saved = draft({ audience: 1, kind: 'picture', picture: { imageId: 'p', url: '/u', name: 'p.png' }, pictureLink: { to: 'entry', competitionId: 4, address: '' }, links: [link('Hello')], footerText: 'Mine' });
    saveDraft(saved);
    expect(loadDraft()).toEqual(saved);

    window.localStorage.setItem(DRAFT_KEY, '{not json');
    expect(loadDraft()).toEqual(emptyDraft());
    window.localStorage.setItem(DRAFT_KEY, 'null');
    expect(loadDraft()).toEqual(emptyDraft());
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ audience: 42, kind: 'other', subject: 5, links: [{ words: 'x', to: 'bogus' }, 'nope'], picture: { imageId: 1 }, pictureLink: { to: 'nope' }, footerPicture: { imageId: 'f', url: '/f' } }));
    expect(loadDraft()).toEqual({ ...emptyDraft(), footerPicture: { imageId: 'f', url: '/f', name: '' } });
    window.localStorage.removeItem(DRAFT_KEY);
    expect(loadDraft()).toEqual(emptyDraft());
  });

  it('copes with storage being unavailable', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    try {
      expect(() => saveDraft(draft())).not.toThrow();
      expect(loadDraft()).toEqual(emptyDraft());
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });
});
