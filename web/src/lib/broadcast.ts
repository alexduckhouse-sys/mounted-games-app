export interface BroadcastRow {
  teamId: number; name: string; bibColour: string | null; lane: number | null; sitOut: boolean;
  hc: boolean; place: number | null; joint: boolean; points: number | null; eliminated: boolean;
}
export interface BroadcastHeat {
  heatId: number; label: string; sessionName: string; sectionId: number | null; sectionName: string;
  raceId: number | null; raceName: string | null; started: boolean; rows: BroadcastRow[];
}
export interface BroadcastScore { raceId: number; raceName: string; heatLabel: string; rows: BroadcastRow[]; expiresAt?: string | null }
export interface BroadcastStanding { teamId: number; teamName: string; totalPoints: number; place: number | null; joint: boolean }
export interface BroadcastPodium { action: string; sectionName: string | null; champions: boolean; places: { teamId: number; teamName: string; place: number; points: number }[] }
export interface BroadcastCue { revision: number; commandId: string; kind: string; action: string; startsAt: string; expiresAt: string; payload: unknown }
export interface BroadcastGraphics {
  competitionName: string; arena: string; current: BroadcastHeat | null; next: BroadcastHeat | null;
  score: BroadcastScore | null; standings: BroadcastStanding[]; banner: string | null;
  sponsors: { name: string; logoData: string | null }[]; cues: BroadcastCue[];
  card?: string; toplistRows?: number; podium?: BroadcastPodium | null; background?: string; accent?: string;
}
export interface BroadcastSnapshot {
  revision: number; serverTime: string; observedAt: string | null; playbackAt: string; expiresAt: string;
  hidden: boolean; warmingUp: boolean; graphics: BroadcastGraphics | null;
}
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown): v is string => typeof v === 'string';
const date = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const nullableText = (v: unknown) => v === null || text(v);
function isRow(v: unknown): v is BroadcastRow {
  return record(v) && finite(v.teamId) && text(v.name) && nullableText(v.bibColour)
    && (v.lane === null || finite(v.lane)) && (v.place === null || finite(v.place)) && (v.points === null || finite(v.points))
    && ['sitOut', 'hc', 'joint', 'eliminated'].every(k => typeof v[k] === 'boolean');
}
function isHeat(v: unknown): v is BroadcastHeat {
  return record(v) && finite(v.heatId) && text(v.label) && text(v.sessionName) && text(v.sectionName)
    && (v.sectionId === null || finite(v.sectionId)) && (v.raceId === null || finite(v.raceId))
    && nullableText(v.raceName) && typeof v.started === 'boolean' && Array.isArray(v.rows) && v.rows.every(isRow);
}
export function isBroadcastScore(v: unknown): v is BroadcastScore {
  return record(v) && finite(v.raceId) && text(v.raceName) && text(v.heatLabel) && Array.isArray(v.rows) && v.rows.every(isRow) && (v.expiresAt == null || date(v.expiresAt));
}
export function isBroadcastPodium(v: unknown): v is BroadcastPodium {
  return record(v) && text(v.action) && nullableText(v.sectionName) && typeof v.champions === 'boolean'
    && Array.isArray(v.places) && v.places.every(p => record(p) && finite(p.teamId) && text(p.teamName) && finite(p.place) && finite(p.points));
}
export function isBroadcastSnapshot(v: unknown): v is BroadcastSnapshot {
  if (!record(v) || !finite(v.revision) || !date(v.serverTime) || !date(v.playbackAt) || !date(v.expiresAt)
    || (v.observedAt !== null && !date(v.observedAt)) || typeof v.hidden !== 'boolean' || typeof v.warmingUp !== 'boolean') return false;
  const g = v.graphics;
  return g === null || (record(g) && text(g.competitionName) && text(g.arena) && nullableText(g.banner)
    && (g.current === null || isHeat(g.current)) && (g.next === null || isHeat(g.next)) && (g.score === null || isBroadcastScore(g.score))
    && Array.isArray(g.standings) && g.standings.every(r => record(r) && finite(r.teamId) && text(r.teamName) && finite(r.totalPoints) && (r.place === null || finite(r.place)) && typeof r.joint === 'boolean')
    && Array.isArray(g.sponsors) && g.sponsors.every(s => record(s) && text(s.name) && nullableText(s.logoData))
    && (g.podium == null || isBroadcastPodium(g.podium)) && (g.card === undefined || text(g.card))
    && (g.toplistRows === undefined || finite(g.toplistRows))
    && [g.background, g.accent].every(c => c === undefined || (text(c) && /^#[0-9a-f]{6}$/i.test(c)))
    && Array.isArray(g.cues) && g.cues.every(c => record(c) && finite(c.revision) && text(c.commandId) && text(c.kind) && text(c.action) && date(c.startsAt) && date(c.expiresAt)
      && (c.kind === 'score' ? isBroadcastScore(c.payload) : c.kind === 'podium' && isBroadcastPodium(c.payload))));
}

export function broadcastOptions(search: URLSearchParams) {
  const arena = search.get('arena') ?? '';
  const delayText = search.get('delay') ?? '0';
  const sectionText = search.get('section');
  const valid = arena.length > 0 && arena.length <= 80 && /^\d{1,3}$/.test(delayText) && Number(delayText) <= 120
    && (sectionText === null || /^[1-9]\d{0,8}$/.test(sectionText));
  return { arena, delay: Number(delayText), section: sectionText === null ? null : Number(sectionText), valid };
}

export function broadcastSource(id: number, arena: string, delay: number, section: number | null = null) {
  const query = new URLSearchParams({ arena, delay: String(delay) });
  if (section !== null) query.set('section', String(section));
  return `/embed/competitions/${id}/overlay?${query}`;
}

/** Expiry follows playback, including time elapsed since receipt. Older replies cannot overwrite a newer revision. */
export function broadcastPresentation(snapshot: BroadcastSnapshot | null, receivedAt: number, now: number) {
  const elapsed = Math.max(0, now - receivedAt);
  if (!snapshot || snapshot.hidden || snapshot.warmingUp || !snapshot.graphics || elapsed >= 15_000) return null;
  const playback = Date.parse(snapshot.playbackAt) + elapsed;
  const cues = snapshot.graphics.cues.filter(c => Date.parse(c.startsAt) <= playback && Date.parse(c.expiresAt) > playback);
  const scoreCue = cues.filter(c => c.kind === 'score').sort((a, b) => b.revision - a.revision)[0];
  const podiumCue = cues.filter(c => c.kind === 'podium').sort((a, b) => b.revision - a.revision)[0];
  let score = snapshot.graphics.score;
  if (score?.expiresAt && Date.parse(score.expiresAt) <= playback) score = null;
  if (scoreCue && isBroadcastScore(scoreCue.payload)) {
    if (scoreCue.action === 'skip') { if (score?.raceId === scoreCue.payload.raceId) score = null; }
    else score = scoreCue.payload;
  }
  const podium = podiumCue ? podiumCue.action === 'show' && isBroadcastPodium(podiumCue.payload) ? podiumCue.payload : null : snapshot.graphics.podium ?? null;
  const card = snapshot.graphics.card ?? 'auto';
  const manualScore = scoreCue && scoreCue.action !== 'skip';
  return { ...snapshot.graphics, card, score: manualScore || ['auto', 'result'].includes(card) ? score : null,
    podium: podiumCue || card === 'podium' ? podium : null,
    current: ['auto', 'heat', 'lanes', 'title'].includes(card) ? snapshot.graphics.current : card === 'next' ? snapshot.graphics.next : null,
    standings: ['auto', 'toplist'].includes(card) ? snapshot.graphics.standings : [],
    next: ['auto', 'next'].includes(card) ? snapshot.graphics.next : null };
}
