import { ReplayPreparation } from '../../../components/stream/ReplayPreparation';
import { INSTANT_LENGTHS, lengthLabel, type InstantLength } from '../../../lib/instantReplay';
import type { SavedReplayClip } from '../../../live/replayBuffer';
import { RefineList, RefineNote, RefineSection } from '../../refine/Refine';
import { ReplayEditor } from './ReplayEditor';

interface Controller {
  recording: boolean;
  retainedSeconds: number;
  warning?: string;
  progress: number | null;
  error: string;
  cancelPreparation: () => void;
  justMadeId: string | null;
  cancelClip: (clipId: string) => void;
}

const time = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

function Row({ clip, open, action, onToggle }: { clip: SavedReplayClip; open: boolean; action: string; onToggle: () => void }) {
  return (
    <button type="button" className="rf-row" aria-expanded={open} onClick={onToggle}>
      <span className="rf-grow"><span className="rf-t1">{clip.label}</span><span className="rf-t2">{[time(clip.createdAt) && `Saved ${time(clip.createdAt)}`, lengthLabel(Math.round(clip.durationSeconds))].filter(Boolean).join(' · ')}</span></span>
      <span className="rf-btn">{open ? 'Close' : action}</span>
    </button>
  );
}

export function ReplayTab({ clips, openId, onOpen, controller, instantLength, onInstantLength }: {
  clips: SavedReplayClip[];
  openId: string | null;
  onOpen: (clipId: string | null) => void;
  controller: Controller;
  instantLength: InstantLength;
  onInstantLength: (length: InstantLength) => void;
}) {
  const newestFirst = [...clips].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const races = newestFirst.filter((clip) => clip.source === 'race');
  const saved = newestFirst.filter((clip) => clip.source !== 'race');
  const open = clips.find((clip) => clip.id === openId) ?? null;
  const minutes = Math.floor(controller.retainedSeconds / 60);

  return (
    <>
      <ReplayPreparation progress={controller.progress} error={controller.error} cancel={controller.cancelPreparation} />
      {open && (
        <ReplayEditor key={open.id} clip={open} editable={open.source !== 'race'} justMade={open.id === controller.justMadeId}
          onClose={() => onOpen(null)} onCancelClip={controller.cancelClip} onSaved={(clip) => onOpen(clip.id)} />
      )}
      <RefineNote>
        {controller.recording
          ? `Recording the video on this page. ${minutes > 0 ? `The last ${minutes} min is` : 'The last few seconds are'} kept on this device.`
          : 'Replays are recorded from the video on this page. They start when a camera is live.'}
      </RefineNote>
      {controller.warning && <p className="mg-notice" role="status">{controller.warning}</p>}

      <RefineSection title="Race recordings" />
      <RefineList as="div" label="Race recordings">
        {races.length === 0 && <div className="rf-row"><span className="rf-t2">Each race is recorded here once it is scored.</span></div>}
        {races.map((clip) => <Row key={clip.id} clip={clip} open={openId === clip.id} action="Watch" onToggle={() => onOpen(openId === clip.id ? null : clip.id)} />)}
      </RefineList>

      <RefineSection title="Instant replay saves" />
      <div className="sx-pills" role="radiogroup" aria-label="Instant replay length">
        {INSTANT_LENGTHS.map((length) => (
          <button key={length} type="button" role="radio" aria-checked={instantLength === length} className="sx-pill" onClick={() => onInstantLength(length)}>Last {lengthLabel(length)}</button>
        ))}
      </div>

      <RefineSection title="Saved replays" />
      <RefineList as="div" label="Saved replays">
        {saved.length === 0 && <div className="rf-row"><span className="rf-t2">No saved replays</span></div>}
        {saved.map((clip) => <Row key={clip.id} clip={clip} open={openId === clip.id} action="Edit" onToggle={() => onOpen(openId === clip.id ? null : clip.id)} />)}
      </RefineList>
    </>
  );
}
