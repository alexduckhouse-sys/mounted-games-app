import { useEffect, useState } from 'react';
import {
  CalendarDays, MapPin, MapPinned, Info, Layers, Users, Banknote, Trophy,
  Hammer, Check, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useCompetition } from './context';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { CompetitionSection, EquipmentLine, SectionSignup } from '../../types';

function priceLabel(minor?: number | null): string {
  if (!minor) return 'Free';
  return `£${(minor / 100).toFixed(2)}`;
}

export function DetailsTab() {
  const { competition, reload } = useCompetition();
  const { canEdit } = useAuth();

  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold">{competition.name}</h2>
          {competition.organiserName && (
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              Organised by <span className="font-semibold">{competition.organiserName}</span>
            </p>
          )}
          {competition.description && (
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">
              {competition.description}
            </p>
          )}
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs sm:text-sm">
          <div className="flex items-start gap-2">
            <CalendarDays className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Dates</dt>
              <dd>
                {new Date(competition.startDate).toLocaleDateString()}
                {competition.endDate && ` → ${new Date(competition.endDate).toLocaleDateString()}`}
              </dd>
            </div>
          </div>

          {competition.location && (
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Location</dt>
                <dd className="break-words">{competition.location}</dd>
              </div>
            </div>
          )}

          {competition.what3Words && (
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">what3words</dt>
                <dd>
                  <a
                    href={`https://what3words.com/${competition.what3Words.replace(/^\/\/\//, '')}`}
                    target="_blank" rel="noreferrer"
                    className="font-mono text-rose-600 dark:text-rose-300 hover:underline"
                  >
                    {competition.what3Words.startsWith('///') ? competition.what3Words : `///${competition.what3Words}`}
                  </a>
                </dd>
              </div>
            </div>
          )}

          {competition.appleMapsUrl && (
            <div className="flex items-start gap-2">
              <MapPinned className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Map pin</dt>
                <dd>
                  <a
                    href={competition.appleMapsUrl}
                    target="_blank" rel="noreferrer"
                    className="text-brand-700 dark:text-brand-300 hover:underline"
                  >
                    Open in Apple Maps
                  </a>
                </dd>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2">
            <Layers className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Sections</dt>
              <dd>{competition.sections.length || '—'}</dd>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Users className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Teams</dt>
              <dd>{competition.teams.length}</dd>
            </div>
          </div>
        </dl>
      </div>

      {/* Signup-by-section */}
      {competition.sections.length > 0 && (
        <div className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Banknote className="w-4 h-4 text-brand-600" /> Enter the competition
          </h3>
          {competition.paymentDestination && (
            <p className="text-[11px] text-slate-500 dark:text-slate-300">
              Pay to: <span className="font-mono">{competition.paymentDestination}</span>
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {competition.sections.map((sec) => (
              <SectionSignupCard
                key={sec.id}
                competitionId={competition.id}
                section={sec}
                onPaid={reload}
                canMarkPaid={canEdit()}
              />
            ))}
          </div>
        </div>
      )}

      <EquipmentBlock competitionId={competition.id} />
    </div>
  );
}

function SectionSignupCard({
  competitionId, section, onPaid, canMarkPaid,
}: {
  competitionId: number;
  section: CompetitionSection;
  onPaid: () => void;
  canMarkPaid: boolean;
}) {
  const [signups, setSignups] = useState<SectionSignup[]>([]);
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [ponyClub, setPonyClub] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    api.get<SectionSignup[]>(`/competitions/${competitionId}/signups`)
      .then((r) => setSignups(r.data.filter((s) => s.competitionSectionId === section.id)))
      .catch(() => {});
  }, [competitionId, section.id]);

  async function submit() {
    if (!fullName.trim()) return;
    setBusy(true);
    try {
      await api.post(`/competitions/${competitionId}/sections/${section.id}/signups`, {
        fullName: fullName.trim(),
        ponyClubName: ponyClub.trim() || null,
        contactInfo: contact.trim() || null,
      });
      setFullName(''); setPonyClub(''); setContact('');
      setDone(section.priceMinor
        ? `Signed up. Pay ${priceLabel(section.priceMinor)} to the destination above; an organiser will confirm.`
        : 'Signed up.');
      setTimeout(() => setDone(null), 6000);
      const r = await api.get<SectionSignup[]>(`/competitions/${competitionId}/signups`);
      setSignups(r.data.filter((s) => s.competitionSectionId === section.id));
      onPaid();
    } finally {
      setBusy(false);
    }
  }

  const paidCount = signups.filter((s) => s.status === 1).length;

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2.5 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm flex-1 truncate">{section.displayName}</span>
        <span className="text-sm font-bold text-brand-700 dark:text-brand-200">{priceLabel(section.priceMinor)}</span>
      </div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">
        {signups.length} signup{signups.length === 1 ? '' : 's'}
        {section.priceMinor ? ` · ${paidCount} paid` : ''}
      </div>
      {!open ? (
        <button onClick={() => setOpen(true)} className="btn-ghost !py-1 !px-2 text-[11px] w-full">
          <Trophy className="w-3 h-3" /> Sign up
        </button>
      ) : (
        <div className="space-y-1.5">
          <input className="input !py-1 text-xs" placeholder="Your full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <input className="input !py-1 text-xs" placeholder="Pony Club (optional)" value={ponyClub} onChange={(e) => setPonyClub(e.target.value)} />
          <input className="input !py-1 text-xs" placeholder="Phone / email (optional)" value={contact} onChange={(e) => setContact(e.target.value)} />
          <div className="flex gap-1">
            <button onClick={submit} disabled={busy || !fullName.trim()} className="btn-primary !py-1 !px-2 text-xs flex-1">
              {busy ? '…' : `Sign up · ${priceLabel(section.priceMinor)}`}
            </button>
            <button onClick={() => setOpen(false)} className="btn-ghost !py-1 !px-2 text-xs">Cancel</button>
          </div>
        </div>
      )}
      {done && (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
          <Check className="w-3 h-3" /> {done}
        </p>
      )}
      {canMarkPaid && signups.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-slate-500">Manage ({signups.length})</summary>
          <ul className="mt-1 space-y-1">
            {signups.map((s) => (
              <li key={s.id} className="flex items-center gap-1">
                <span className="flex-1 truncate">
                  {s.fullName}
                  {s.ponyClubName && <span className="text-slate-500"> · {s.ponyClubName}</span>}
                </span>
                <span className={`text-[9px] uppercase font-bold ${s.status === 1 ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {s.status === 1 ? 'paid' : 'pending'}
                </span>
                {s.status !== 1 && (
                  <button
                    onClick={async () => {
                      await api.put(`/signups/${s.id}/status`, { status: 1 });
                      const r = await api.get<SectionSignup[]>(`/competitions/${competitionId}/signups`);
                      setSignups(r.data.filter((x) => x.competitionSectionId === section.id));
                    }}
                    className="btn-ghost !py-0.5 !px-1 text-[10px] text-emerald-600"
                    title="Mark paid"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function EquipmentBlock({ competitionId }: { competitionId: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ lines: EquipmentLine[]; sessions: number; racesCounted: number } | null>(null);

  useEffect(() => {
    if (!open || data) return;
    api.get<{ lines: EquipmentLine[]; sessions: number; racesCounted: number }>(`/competitions/${competitionId}/equipment`)
      .then((r) => setData(r.data))
      .catch(() => {});
  }, [open, competitionId, data]);

  const byBucket = new Map<string, EquipmentLine[]>();
  for (const l of data?.lines ?? []) {
    if (!byBucket.has(l.bucket)) byBucket.set(l.bucket, []);
    byBucket.get(l.bucket)!.push(l);
  }
  const bucketOrder = ['Lane', 'Start', 'Mid', 'Top', 'Side', 'Other'];

  return (
    <div className="card p-4 space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-sm font-semibold"
      >
        <Hammer className="w-4 h-4 text-brand-600" />
        Equipment required
        <span className="text-[11px] text-slate-500 font-normal ml-1">
          (deduped across sessions, sized for the biggest heat)
        </span>
        <span className="ml-auto">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
      </button>
      {open && (
        data == null ? (
          <p className="text-xs text-slate-500">Computing…</p>
        ) : data.lines.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No races set up yet, so nothing to count.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {data.sessions} session{data.sessions === 1 ? '' : 's'} · {data.racesCounted} unique race{data.racesCounted === 1 ? '' : 's'} counted
            </p>
            {bucketOrder.filter((b) => byBucket.has(b)).map((b) => (
              <div key={b}>
                <h4 className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold mb-0.5">
                  {b}
                </h4>
                <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 text-xs">
                  {byBucket.get(b)!.sort((a, b2) => a.kind.localeCompare(b2.kind)).map((l) => (
                    <li key={`${b}-${l.kind}`} className="flex justify-between">
                      <span>{l.kind}</span>
                      <span className="font-mono font-bold tabular-nums">×{l.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
