import { useState } from 'react';
import { Plus } from 'lucide-react';
import { wholeNumber, type BreakDraft } from '../../../lib/creatorDraft';
import { NumberBox, SelectBox, TextBox } from './parts';

/** Adds a break or briefing: what it is, when it starts, how long it lasts and who stops (one arena or everyone). */
export function BreakForm({ date, arenas, busy, onAdd }: {
  /** The day to start from (yyyy-mm-dd). */
  date: string;
  arenas: string[];
  busy?: boolean;
  onAdd: (b: BreakDraft) => void;
}) {
  const [kind, setKind] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [day, setDay] = useState(date);
  const [time, setTime] = useState('12:30');
  const [minutes, setMinutes] = useState('45');
  const [arena, setArena] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function add() {
    const length = wholeNumber(minutes);
    if (length === null || length < 1 || length > 1440) { setProblem('Enter how many minutes it lasts.'); return; }
    if (!day || !time) { setProblem('Choose when it starts.'); return; }
    setProblem(null);
    onAdd({ kind, name: name.trim() || (kind === 2 ? 'Briefing' : 'Break'), date: day, time, minutes: String(length), arena });
    setName('');
  }

  return (
    <div role="group" aria-label="Add a break or briefing" className="flex flex-col gap-3 border-t border-[rgb(var(--mg-rule-soft))] p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SelectBox label="Type" value={kind} onChange={(v) => setKind(v === '2' ? 2 : 1)}>
          <option value="1">Break</option>
          <option value="2">Briefing</option>
        </SelectBox>
        <TextBox label="Name" value={name} placeholder={kind === 2 ? 'Briefing' : 'Lunch'} onChange={setName} className="col-span-1 sm:col-span-3" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-[rgb(var(--mg-body))]">Day
          <span className="mg-field !min-h-11 !rounded-lg"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-[rgb(var(--mg-body))]">Starts
          <span className="mg-field !min-h-11 !rounded-lg"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></span>
        </label>
        <NumberBox label="Minutes" value={minutes} suffix="min" onChange={setMinutes} />
        <SelectBox label="Who stops" value={arena} onChange={setArena}>
          <option value="">Everyone</option>
          {arenas.map((a) => <option key={a} value={a}>{a}</option>)}
        </SelectBox>
      </div>
      {problem && <p role="alert" className="text-sm font-medium text-[rgb(var(--mg-elim))]">{problem}</p>}
      <button type="button" disabled={busy} onClick={add} className="mg-btn mg-btn-secondary !min-h-11 self-start">
        <Plus aria-hidden="true" className="h-[18px] w-[18px]" />Add to timetable
      </button>
    </div>
  );
}
