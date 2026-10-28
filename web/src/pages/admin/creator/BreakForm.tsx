import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useT } from '../../../i18n/LanguageContext';
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
  const t = useT();
  const [kind, setKind] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [day, setDay] = useState(date);
  const [time, setTime] = useState('12:30');
  const [minutes, setMinutes] = useState('45');
  const [arena, setArena] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function add() {
    const length = wholeNumber(minutes);
    if (length === null || length < 1 || length > 1440) { setProblem(t('admin.creator.break.problemMinutes')); return; }
    if (!day || !time) { setProblem(t('admin.creator.break.problemStart')); return; }
    setProblem(null);
    onAdd({ kind, name: name.trim() || (kind === 2 ? t('admin.creator.break.briefing') : t('admin.creator.break.break')), date: day, time, minutes: String(length), arena });
    setName('');
  }

  return (
    <div role="group" aria-label={t('admin.creator.break.group')} className="flex flex-col gap-3 border-t border-[rgb(var(--mg-rule-soft))] p-4">
      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-2.5 sm:grid-cols-4 sm:gap-3">
        <SelectBox label={t('admin.creator.break.type')} value={kind} onChange={(v) => setKind(v === '2' ? 2 : 1)}>
          <option value="1">{t('admin.creator.break.break')}</option>
          <option value="2">{t('admin.creator.break.briefing')}</option>
        </SelectBox>
        <TextBox label={t('admin.creator.name')} value={name} placeholder={kind === 2 ? t('admin.creator.break.briefing') : t('admin.creator.break.lunch')} onChange={setName} className="col-span-1 sm:col-span-3" />
      </div>
      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-2.5 sm:grid-cols-4 sm:gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-[rgb(var(--mg-body))]">{t('admin.creator.break.day')}
          <span className="mg-field !min-h-11 !rounded-lg"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-[rgb(var(--mg-body))]">{t('admin.creator.break.starts')}
          <span className="mg-field !min-h-11 !rounded-lg"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></span>
        </label>
        <NumberBox label={t('admin.creator.break.minutes')} value={minutes} suffix={t('admin.creator.min')} onChange={setMinutes} />
        <SelectBox label={t('admin.creator.break.whoStops')} value={arena} onChange={setArena}>
          <option value="">{t('admin.creator.break.everyone')}</option>
          {arenas.map((a) => <option key={a} value={a}>{a}</option>)}
        </SelectBox>
      </div>
      {problem && <p role="alert" className="text-sm font-medium text-[rgb(var(--mg-elim))]">{problem}</p>}
      <button type="button" disabled={busy} onClick={add} className="mg-btn mg-btn-secondary !min-h-11 self-start">
        <Plus aria-hidden="true" className="h-[18px] w-[18px]" />{t('admin.creator.break.add')}
      </button>
    </div>
  );
}
