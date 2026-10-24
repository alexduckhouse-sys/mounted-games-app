import { describe, expect, it } from 'vitest';
import type { DeclarationForm, RiderEntry, SavedRider } from '../types';
import {
  blankRider, buildSubmitBody, canSubmit, decDraftKey, dobText, emptySlots, firstEmpty, heightText, isReserveSlot, panelTitle,
  parseDob, parseDraft, parseHeight, riderFromSaved, riderReady, ridersAdded, ridersRequired, savedChoices, slotLabel, slotMeta,
  slotsFromForm, statusText, subtitleOf, teamIsFull, type DecRider, type Slot,
} from './decForm';

const rider = (fullName: string, extra: Partial<DecRider> = {}): DecRider =>
  ({ ...blankRider(), fullName, dob: '05/04/2015', pony: 'Pickle', height: '13.2', ...extra });

const filled = (n: number, reserve = false): Slot[] => {
  const slots = emptySlots(5);
  for (let i = 0; i < n; i++) slots[i] = rider(`Rider ${i + 1}`);
  if (reserve) slots[5] = rider('Reserve One', { pony: '', height: '' });
  return slots;
};

const entry = (id: number, extra: Partial<RiderEntry> = {}): RiderEntry =>
  ({ id, fullName: `Rider ${id}`, isCaptain: false, isReserve: false, orderIndex: id, ...extra });

const form = (riders: RiderEntry[]): DeclarationForm =>
  ({ id: 1, teamId: 7, teamName: 'Stockport C', competitionId: 1, competitionName: 'Spring', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, riders });

describe('ridersRequired', () => {
  it('is five for a team, two for pairs and one for an individual', () => {
    expect(ridersRequired(2)).toBe(5);
    expect(ridersRequired(1)).toBe(2);
    expect(ridersRequired(3)).toBe(1);
    expect(ridersRequired(undefined)).toBe(5);
  });
});

describe('slots', () => {
  it('has one more slot than riders, and the last is the reserve', () => {
    const slots = emptySlots(5);
    expect(slots).toHaveLength(6);
    expect(isReserveSlot(slots, 5)).toBe(true);
    expect(isReserveSlot(slots, 4)).toBe(false);
    expect(slotLabel(slots, 0)).toBe('Rider');
    expect(slotLabel(slots, 5)).toBe('Non-riding reserve (optional)');
  });

  it('finds the first empty slot, or none', () => {
    expect(firstEmpty(emptySlots(5))).toBe(0);
    expect(firstEmpty(filled(2))).toBe(2);
    expect(firstEmpty(filled(5, true))).toBeNull();
  });

  it('counts only the riders, and the team is full at five', () => {
    expect(ridersAdded(filled(3, true))).toBe(3);
    expect(teamIsFull(filled(4, true))).toBe(false);
    expect(teamIsFull(filled(5))).toBe(true);
  });

  it('titles the panel for the slot being filled or edited', () => {
    const slots = filled(2, true);
    expect(panelTitle(slots, 3)).toBe('Add a rider');
    expect(panelTitle(slots, 0)).toBe('Edit rider');
    expect(panelTitle(emptySlots(5), 5)).toBe('Add a non-riding reserve');
    expect(panelTitle(slots, 5)).toBe('Edit reserve');
  });

  it('describes a filled slot', () => {
    expect(slotMeta(rider('A'), false)).toBe('Pickle · 13.2 hh · born 05/04/2015');
    expect(slotMeta(rider('A'), true)).toBe('Non-riding · born 05/04/2015');
  });
});

describe('dates and heights', () => {
  const today = new Date(2026, 9, 23);

  it('turns dd/mm/yyyy into an ISO date', () => {
    expect(parseDob('05/04/2015', today)).toBe('2015-04-05');
    expect(parseDob(' 5/4/2015 ', today)).toBe('2015-04-05');
  });

  it.each(['', 'abc', '31/02/2015', '00/01/2015', '12/13/2015', '05-04-2015', '05/04/15', '05/04/1899', '24/10/2026'])('refuses %j', (text) => {
    expect(parseDob(text, today)).toBeNull();
  });

  it('accepts today but not tomorrow, and uses the real clock by default', () => {
    expect(parseDob('23/10/2026', today)).toBe('2026-10-23');
    expect(parseDob('01/01/2015')).toBe('2015-01-01');
  });

  it('shows an API date as dd/mm/yyyy', () => {
    expect(dobText('2015-04-05T00:00:00')).toBe('05/04/2015');
    expect(dobText('2015-04-05')).toBe('05/04/2015');
    expect(dobText(null)).toBe('');
    expect(dobText('soon')).toBe('');
  });

  it('reads heights in hands and inches', () => {
    expect(parseHeight('13.2')).toBe(13.2);
    expect(parseHeight(' 14 ')).toBe(14);
    expect(parseHeight('12.0')).toBe(12);
    expect(parseHeight('5')).toBe(5);
    expect(parseHeight('20')).toBe(20);
  });

  it.each(['', 'tall', '13.4', '13.25', '4.3', '21', '20.1', '1.2', '-13', '13,2'])('refuses the height %j', (text) => {
    expect(parseHeight(text)).toBeNull();
  });

  it('writes a height with one decimal', () => {
    expect(heightText(13.2)).toBe('13.2');
    expect(heightText(14)).toBe('14.0');
    expect(heightText(null)).toBe('');
    expect(heightText(undefined)).toBe('');
  });
});

describe('riderReady', () => {
  it('needs a name and a real birth date for anyone', () => {
    expect(riderReady(rider('Ella'), false)).toBe(true);
    expect(riderReady(rider(' '), true)).toBe(false);
    expect(riderReady(rider('Ella', { dob: '' }), true)).toBe(false);
    expect(riderReady(rider('Ella', { dob: '31/02/2015' }), true)).toBe(false);
  });

  it('needs the pony and its height for a rider, but not for the reserve', () => {
    expect(riderReady(rider('Ella', { pony: '' }), false)).toBe(false);
    expect(riderReady(rider('Ella', { height: '' }), false)).toBe(false);
    expect(riderReady(rider('Ella', { height: '13.5' }), false)).toBe(false);
    expect(riderReady(rider('Ella', { pony: '', height: '' }), true)).toBe(true);
  });
});

describe('riderFromSaved', () => {
  const saved: SavedRider = { id: 9, clubId: 1, fullName: 'Ella Hughes', dateOfBirth: '2015-04-05T00:00:00', horseName: 'Pickle', ponyHeightHands: 13.2, useInitialOnly: true, noFilming: true };

  it('fills every field and keeps the privacy choices', () => {
    expect(riderFromSaved(saved, false)).toMatchObject({
      savedRiderId: 9, fullName: 'Ella Hughes', dob: '05/04/2015', pony: 'Pickle', height: '13.2', useInitialOnly: true, noFilming: true,
    });
  });

  it('leaves the pony out for the reserve', () => {
    expect(riderFromSaved(saved, true)).toMatchObject({ fullName: 'Ella Hughes', dob: '05/04/2015', pony: '', height: '' });
  });

  it('copes with a rider saved before heights and dates were kept', () => {
    expect(riderFromSaved({ id: 1, clubId: 1, fullName: 'Old Rider' }, false)).toMatchObject({ dob: '', pony: '', height: '', useInitialOnly: false, noFilming: false });
  });
});

describe('slotsFromForm', () => {
  it('puts the riders in order and the reserve last', () => {
    const slots = slotsFromForm(form([
      entry(3, { orderIndex: 5, isReserve: true, dateOfBirth: '2016-01-02T00:00:00' }),
      entry(2, { orderIndex: 1, horseName: 'Toffee', ponyHeightHands: 12.3, isCaptain: true }),
      entry(1, { orderIndex: 0, savedRiderId: 4, useInitialOnly: true, noFilming: true, isGuestRider: true }),
    ]), 5);
    expect(slots).toHaveLength(6);
    expect(slots[0]).toMatchObject({ fullName: 'Rider 1', savedRiderId: 4, useInitialOnly: true, noFilming: true, isGuestRider: true });
    expect(slots[1]).toMatchObject({ fullName: 'Rider 2', pony: 'Toffee', height: '12.3', isCaptain: true });
    expect(slots[2]).toBeNull();
    expect(slots[5]).toMatchObject({ fullName: 'Rider 3', dob: '02/01/2016' });
  });

  it('gives every rider a slot when an older form had more than five', () => {
    const riders = Array.from({ length: 7 }, (_, i) => entry(i + 1, { orderIndex: i }));
    const slots = slotsFromForm(form(riders), 5);
    expect(slots).toHaveLength(8);
    expect(slots.slice(0, 7).every(Boolean)).toBe(true);
    expect(slots[7]).toBeNull();
  });

  it('has an empty reserve when the form has none', () => {
    expect(slotsFromForm(form([entry(1)]), 2)[2]).toBeNull();
  });
});

describe('savedChoices', () => {
  const saved: SavedRider[] = [
    { id: 1, clubId: 1, fullName: 'Ella Hughes' }, { id: 2, clubId: 1, fullName: 'Oliver Smith' }, { id: 3, clubId: 1, fullName: 'Maisie Clarke' },
  ];

  it('leaves out anyone already in the team, by link or by name', () => {
    const slots = emptySlots(5);
    slots[0] = rider('Somebody', { savedRiderId: 1 });
    slots[1] = rider('  oliver smith ');
    expect(savedChoices(saved, slots).map((s) => s.id)).toEqual([3]);
  });

  it('offers everyone for an empty team', () => {
    expect(savedChoices(saved, emptySlots(5))).toHaveLength(3);
  });
});

describe('submitting', () => {
  it('needs all the riders, the tick and a team name', () => {
    expect(canSubmit(filled(5), true, 'Stockport C')).toBe(true);
    expect(canSubmit(filled(5, true), true, 'Stockport C')).toBe(true);
    expect(canSubmit(filled(4, true), true, 'Stockport C')).toBe(false);
    expect(canSubmit(filled(5), false, 'Stockport C')).toBe(false);
    expect(canSubmit(filled(5), true, '  ')).toBe(false);
  });

  it('says where the form has got to', () => {
    expect(statusText(filled(3), false, false)).toBe('3 of 5 riders added');
    expect(statusText(emptySlots(2), false, false)).toBe('0 of 2 riders added');
    expect(statusText(filled(5), false, false)).toBe('Tick to agree, then submit');
    expect(statusText(filled(5), true, false)).toBe('Ready to submit');
    expect(statusText(filled(5), true, true)).toBe('Submitted');
  });

  it('builds the request: reserve flagged, no pony on the reserve, order kept, terms ticked', () => {
    const slots = filled(2, true);
    slots[1] = rider('  Oliver Smith ', { savedRiderId: 8, isCaptain: true, useInitialOnly: true, noFilming: true });
    const body = buildSubmitBody({ teamId: 7, teamName: ' Stockport C ', bibs: ' Yellow ', trainerName: ' Alex Morgan ', phone: ' 07700 900123 ', notes: '  ' }, slots);
    expect(body).toMatchObject({
      teamId: 7, teamName: 'Stockport C', bibDescription: 'Yellow', trainerName: 'Alex Morgan', trainerPhone: '07700 900123',
      notes: null, saveToRoster: true, acceptTerms: true,
    });
    expect(body.riders).toHaveLength(3);
    expect(body.riders[0]).toMatchObject({
      fullName: 'Rider 1', dateOfBirth: '2015-04-05', horseName: 'Pickle', ponyHeightHands: 13.2, isReserve: false, isCaptain: false, isGuestRider: false, orderIndex: 0,
    });
    expect(body.riders[1]).toMatchObject({ fullName: 'Oliver Smith', savedRiderId: 8, isCaptain: true, useInitialOnly: true, noFilming: true, orderIndex: 1 });
    expect(body.riders[2]).toMatchObject({ fullName: 'Reserve One', isReserve: true, horseName: null, ponyHeightHands: null, orderIndex: 5 });
  });

  it('sends nulls for empty trainer, phone and pony text, and prepends a flag tag when chosen', () => {
    const slots = emptySlots(1);
    slots[0] = rider('Solo', { pony: '  ' });
    const body = buildSubmitBody({ teamId: 1, teamName: 'T', bibs: '', trainerName: '', phone: '', notes: 'Be kind' }, slots);
    expect(body).toMatchObject({ bibDescription: '', trainerName: null, trainerPhone: null, notes: 'Be kind' });
    expect(body.riders[0].horseName).toBeNull();

    const withFlag = buildSubmitBody({ teamId: 1, teamName: 'T', bibs: 'Red bibs', flag: 'gb-eng', trainerName: '', phone: '', notes: '' }, slots);
    expect(withFlag.bibDescription).toBe('[flag:gb-eng] Red bibs');
  });
});

describe('drafts', () => {
  const draft = { teamId: 7, teamName: 'Stockport C', bibs: 'Yellow', trainerName: 'Alex', phone: '0770', notes: '', slots: filled(2, true) };

  it('keeps one draft per team', () => {
    expect(decDraftKey(1, 7)).not.toBe(decDraftKey(1, 8));
    expect(decDraftKey(1, 7)).not.toBe(decDraftKey(2, 7));
  });

  it('reads back what was kept', () => {
    const back = parseDraft(JSON.stringify(draft), 5);
    expect(back).toMatchObject({ teamId: 7, teamName: 'Stockport C', bibs: 'Yellow', trainerName: 'Alex', phone: '0770' });
    expect(back?.slots[0]).toMatchObject({ fullName: 'Rider 1', pony: 'Pickle' });
    expect(back?.slots[2]).toBeNull();
  });

  it('fills in anything an older draft lacked', () => {
    const back = parseDraft(JSON.stringify({ teamId: 7, slots: [{ fullName: 'Half' }, null, null, null, null, null] }), 5);
    expect(back?.slots[0]).toEqual({ ...blankRider(), fullName: 'Half' });
    expect(back).toMatchObject({ teamName: '', bibs: '', notes: '' });
  });

  it.each([
    ['nothing', null],
    ['not JSON', '{oops'],
    ['null', 'null'],
    ['no team', JSON.stringify({ slots: filled(1) })],
    ['no slots', JSON.stringify({ teamId: 7 })],
    ['too few slots for the section', JSON.stringify({ teamId: 7, slots: emptySlots(2) })],
  ])('ignores a draft that is %s', (_name, raw) => {
    expect(parseDraft(raw, 5)).toBeNull();
  });
});

describe('subtitleOf', () => {
  it('joins what is there', () => {
    expect(subtitleOf(['U10', ' Cheshire Area MG ', 'Sat 24 Oct'])).toBe('U10 · Cheshire Area MG · Sat 24 Oct');
    expect(subtitleOf([undefined, '', null, 'Sat 24 Oct'])).toBe('Sat 24 Oct');
  });
});
