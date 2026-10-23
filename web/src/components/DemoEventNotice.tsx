/** Small pill for competition cards and headers: this is a sample event, not a real one. */
export function DemoEventBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex min-h-6 shrink-0 items-center rounded-md border border-violet-400 bg-violet-50 px-2 text-xs font-bold uppercase tracking-wide text-violet-900 ${className}`.trim()}>
      Demo event
    </span>
  );
}

/** Shown on every tab of a demo competition so nobody mistakes it for a real event. */
export function DemoEventNotice() {
  return (
    <div role="note" className="mx-auto w-full max-w-xl rounded-lg border-2 border-violet-400 bg-violet-50 p-3 text-violet-950">
      <p className="text-sm font-extrabold uppercase tracking-wide">Demo event</p>
      <p className="mt-1 text-sm">
        This is a sample competition for trying the app. The teams and results are made up.
        Any payment here is a test and no money is taken.
      </p>
    </div>
  );
}
