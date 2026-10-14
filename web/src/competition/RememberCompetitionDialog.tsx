import { useEffect, useRef } from 'react';
import { useCurrentCompetition } from './CurrentCompetitionContext';

export function RememberCompetitionDialog() {
  const { current, setRememberChoice } = useCurrentCompetition();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby="remember-competition-title" onCancel={() => setRememberChoice('visit')} className="m-auto w-[calc(100%-1.5rem)] max-w-md rounded-2xl bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/50 dark:bg-slate-900 dark:text-slate-100">
      <h2 id="remember-competition-title" className="text-xl font-bold">Remember this competition?</h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">Allow a cookie to remember {current?.name} on this device for six months. Next time you open the site, we’ll take you to its timetable.</p>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">You can change this using the three dots beside the competition name.</p>
      <div className="mt-5 flex flex-col gap-2">
        <button autoFocus className="btn-primary min-h-12 justify-center" onClick={() => setRememberChoice('remember')}>Allow and remember</button>
        <button className="btn-ghost min-h-12 justify-center" onClick={() => setRememberChoice('visit')}>Just for this visit</button>
      </div>
    </dialog>
  );
}
