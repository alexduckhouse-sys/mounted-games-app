import { tr } from '../../i18n/translate';
export class TeamImportFormatError extends Error {}

/** Recognise team-export headers only. Rider names must never become public team names implicitly. */
export function normaliseTeamCsvHeaders(csv: string): { csv: string; mapped: string[] } {
  const newline = csv.search(/\r?\n/);
  const first = newline < 0 ? csv : csv.slice(0, newline);
  const headers: string[] = [];
  let cell = '', quoted = false;
  for (let i = 0; i < first.length; i++) {
    const c = first[i];
    if (c === '"') { if (quoted && first[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { headers.push(cell); cell = ''; }
    else cell += c;
  }
  if (quoted) throw new TeamImportFormatError(tr('completion.csvQuote'));
  headers.push(cell);
  const aliases: Record<string, string> = { club: 'club', ponyclub: 'club', branch: 'club', clubname: 'club', section: 'section', classname: 'section', class: 'section', agegroup: 'section', suffix: 'suffix', teamsuffix: 'suffix', team: 'team', teamname: 'team', name: 'name' };
  const mapped: string[] = [];
  const normal = headers.map(h => {
    const clean = h.replace(/^\uFEFF/, '').trim();
    const key = clean.toLowerCase().replace(/[\s_-]/g, '');
    const target = aliases[key];
    if (target && target !== clean.toLowerCase()) mapped.push(`${clean} → ${target}`);
    return target ?? clean;
  });
  const keys = headers.map(h => h.toLowerCase().replace(/[\s_-]/g, ''));
  if (keys.some(k => /^(rider|ridername|competitor|competitorname|horse|horsename|pony|ponyname)$/.test(k))) {
    throw new TeamImportFormatError(tr('completion.csvRiders'));
  }
  if (!normal.includes('club') || !normal.includes('section')) throw new TeamImportFormatError(tr('completion.csvRequired'));
  if (new Set(normal.map(h => h.toLowerCase())).size !== normal.length) throw new TeamImportFormatError(tr('completion.csvDuplicate'));
  const escaped = normal.map(h => /[",]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h).join(',');
  return { csv: escaped + (newline < 0 ? '' : csv.slice(newline)), mapped };
}
