import { Notice } from '../Notice';

/** The replay being cut: progress (blue-grey, with a bar that fills and a way to stop it) or a problem strip when it couldn't be made. */
export function ReplayPreparation({ progress, error, cancel }: { progress: number | null; error: string; cancel: () => void }) {
  return <>
    {progress !== null && <Notice tone="info" className="pointer-events-auto" actionLabel="Cancel preparation" onAction={cancel}
      extra={<span className="mg-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></span>}>Preparing replay · {Math.round(progress * 100)}%. Keep this tab open.</Notice>}
    {error && <Notice className="pointer-events-auto">{error}</Notice>}
  </>;
}
