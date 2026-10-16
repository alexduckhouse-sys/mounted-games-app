import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv, safeFilename, signupsToCsv, toCsv } from './csv';

describe('toCsv', () => {
  it('joins rows with CRLF and leaves plain values unquoted', () => {
    expect(toCsv(['A', 'B'], [[1, 'x'], [2, 'y']])).toBe('A,B\r\n1,x\r\n2,y');
  });

  it('quotes values containing commas, quotes or line breaks, doubling embedded quotes', () => {
    expect(toCsv(['a,b'], [['say "hi"'], ['line\nbreak'], ['cr\rhere'], ['plain']]))
      .toBe('"a,b"\r\n"say ""hi"""\r\n"line\nbreak"\r\n"cr\rhere"\r\nplain');
  });

  it('writes null and undefined as empty cells and stringifies other types', () => {
    expect(toCsv(['n'], [[null, undefined, 0, false]])).toBe('n\r\n,,0,false');
  });

  it('produces just the header when there are no rows', () => {
    expect(toCsv(['A'], [])).toBe('A');
  });
});

describe('safeFilename', () => {
  it('replaces unsafe runs with one underscore and keeps safe punctuation', () => {
    expect(safeFilename('Spring Games / 2026: Final?')).toBe('Spring_Games_2026_Final_');
    expect(safeFilename('a-b_c.d')).toBe('a-b_c.d');
  });

  it('limits the name to 80 characters', () => {
    expect(safeFilename('x'.repeat(200))).toHaveLength(80);
  });
});

describe('signupsToCsv', () => {
  const signup = {
    sectionName: 'Seniors', fullName: 'Ann, Smith', ponyClubName: 'Ashdown', contactInfo: 'ann@example.com',
    amountMinor: 1250, status: 1, paidAt: '2026-05-01', createdAt: '2026-04-30',
  };

  it('writes one row per signup with pounds and a readable status', () => {
    const [header, row] = signupsToCsv([signup]).split('\r\n');
    expect(header).toBe('Section,Name,Pony Club,Contact,Amount (GBP),Status,Paid at,Signed up at');
    expect(row).toBe('Seniors,"Ann, Smith",Ashdown,ann@example.com,12.50,paid,2026-05-01,2026-04-30');
  });

  it('labels every payment status and shows unknown ones as their number', () => {
    const statusOf = (status: number) => signupsToCsv([{ ...signup, fullName: 'Ann', status }]).split('\r\n')[1].split(',')[5];
    const statuses = [0, 1, 2, 3, 9].map(statusOf);
    expect(statuses).toEqual(['pending', 'paid', 'refunded', 'cancelled', '9']);
  });

  it('leaves optional fields blank when missing', () => {
    const row = signupsToCsv([{ ...signup, ponyClubName: null, contactInfo: undefined, paidAt: null }]).split('\r\n')[1];
    expect(row).toBe('Seniors,"Ann, Smith",,,12.50,paid,,2026-04-30');
  });
});

describe('downloadCsv', () => {
  let blobs: Blob[];
  let click: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    blobs = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:test'; });
    URL.revokeObjectURL = vi.fn();
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); });

  it('clicks a temporary download link with a BOM so Excel reads UTF-8, then cleans up', async () => {
    downloadCsv('teams.csv', 'a,b');
    expect(click).toHaveBeenCalledTimes(1);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe('teams.csv');
    expect(link.href).toBe('blob:test');
    expect(document.body.contains(link)).toBe(true);
    expect(blobs[0].type).toBe('text/csv;charset=utf-8');
    expect([...new Uint8Array(await blobs[0].arrayBuffer())]).toEqual([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62]);

    vi.runAllTimers();
    expect(document.body.contains(link)).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
