import { expect, it } from 'vitest';
import { competitionCalendarUrl, competitionLink, feedLinks, joinKeyFromSearch, joinTeamLink } from './sharing';

it('builds the calendar file address with the site as a query value', () => {
  expect(competitionCalendarUrl(12, 'https://mg.example')).toBe('/api/competitions/12/calendar.ics?site=https%3A%2F%2Fmg.example');
});

it('builds the event and team links that QR codes carry', () => {
  expect(competitionLink('12', 'https://mg.example')).toBe('https://mg.example/competitions/12');
  expect(joinTeamLink('AB CD&1', 'https://mg.example')).toBe('https://mg.example/teams?join=AB%20CD%261');
});

it('reads a join key from the address and cleans it', () => {
  expect(joinKeyFromSearch('?join=abcd2345')).toBe('ABCD2345');
  expect(joinKeyFromSearch('?join=ab%3Cscript%3E')).toBe('ABSCRIPT');
  expect(joinKeyFromSearch('?join=' + 'a'.repeat(60))).toHaveLength(32);
  expect(joinKeyFromSearch('')).toBe('');
});

it('makes webcal and https feed addresses from the API path', () => {
  const links = feedLinks('/api/calendar/teams/5/tok_en-1.ics', 'https://mg.example');
  expect(links.https).toBe('https://mg.example/api/calendar/teams/5/tok_en-1.ics');
  expect(links.webcal).toBe('webcal://mg.example/api/calendar/teams/5/tok_en-1.ics');
  expect(feedLinks('/api/x.ics', 'http://localhost:5173').webcal).toBe('webcal://localhost:5173/api/x.ics');
});
