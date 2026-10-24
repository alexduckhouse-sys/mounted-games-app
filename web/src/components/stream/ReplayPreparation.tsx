export function ReplayPreparation({ progress, error, cancel }: { progress: number | null; error: string; cancel: () => void }) {
  return <>{progress !== null && <div role="status" className="pointer-events-auto rounded bg-black/90 p-3 text-sm text-white">
    <p>Preparing replay · {Math.round(progress * 100)}%. Keep this tab open.</p>
    <button type="button" className="mg-stream-control mt-2 px-3" onClick={cancel}>Cancel preparation</button>
  </div>}{error && <p role="alert" className="rounded bg-black/90 p-3 text-sm text-white">{error}</p>}</>;
}
