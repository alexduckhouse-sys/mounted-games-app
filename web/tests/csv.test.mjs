import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, safeFilename, signupsToCsv, downloadCsv } from '../src/lib/csv.ts';

test('CSV preserves separators, quotes and embedded line breaks', () => {
  assert.equal(toCsv(['Heading, one', 'Second'], [['A "quoted" value', 'line\nnext'], ['carriage\rreturn', 'plain']]), '"Heading, one",Second\r\n"A ""quoted"" value","line\nnext"\r\n"carriage\rreturn",plain');
});

test('CSV represents numbers, booleans and absent values without losing zero', () => {
  assert.equal(toCsv(['A', 'B', 'C', 'D'], [[0, false, null, undefined]]), 'A,B,C,D\r\n0,false,,');
  assert.equal(toCsv(['A'], []), 'A');
});

test('download filenames strip path separators and are limited to 80 characters', () => {
  assert.equal(safeFilename('Example / event: 2026'), 'Example_event_2026');
  assert.equal(safeFilename('a'.repeat(90)).length, 80);
  assert.equal(safeFilename('Example-event_1.csv'), 'Example-event_1.csv');
});

test('signup exports format pounds, optional fields and payment statuses', () => {
  const rows = [0, 1, 2, 3, 99].map((status) => ({ sectionName: 'Example section', fullName: 'Test Entrant', amountMinor: 1234, status, createdAt: '2026-01-01T00:00:00Z' }));
  const lines = signupsToCsv(rows).split('\r\n');
  for (const [index, status] of ['pending', 'paid', 'refunded', 'cancelled', '99'].entries()) {
    assert.equal(lines[index + 1], `Example section,Test Entrant,,,12.34,${status},,2026-01-01T00:00:00Z`);
  }
});

test('signup exports preserve supplied optional fields using CSV escaping', () => {
  const csv = signupsToCsv([{ sectionName: 'Example', fullName: 'Test Entrant', ponyClubName: 'Example, Club', contactInfo: 'test@example.invalid', amountMinor: 0, status: 1, paidAt: '2026-01-02', createdAt: '2026-01-01' }]);
  assert.equal(csv.split('\r\n')[1], 'Example,Test Entrant,"Example, Club",test@example.invalid,0.00,paid,2026-01-02,2026-01-01');
});

test('downloads UTF-8 CSV and releases the temporary link and object URL', async (t) => {
  let blob;
  let cleanup;
  let clicked = false;
  const elements = [];
  const anchor = { click() { clicked = true; } };
  t.mock.method(URL, 'createObjectURL', (value) => { blob = value; return 'blob:example'; });
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  t.mock.method(globalThis, 'setTimeout', (fn) => { cleanup = fn; });
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement(tag) { assert.equal(tag, 'a'); return anchor; }, body: { appendChild(element) { elements.push(element); }, removeChild(element) { elements.splice(elements.indexOf(element), 1); } } } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'document', prior); else delete globalThis.document; });
  downloadCsv('example.csv', 'Example');
  assert.equal(clicked, true);
  assert.equal(anchor.download, 'example.csv');
  assert.equal(anchor.href, 'blob:example');
  assert.equal(blob.type, 'text/csv;charset=utf-8');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)], [239, 187, 191]);
  cleanup();
  assert.equal(elements.length, 0);
  assert.equal(revoke.mock.calls[0].arguments[0], 'blob:example');
});
