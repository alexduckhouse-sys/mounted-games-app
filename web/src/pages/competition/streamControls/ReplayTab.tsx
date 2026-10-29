import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Notice } from '../../../components/Notice';
import { ReplayPreparation } from '../../../components/stream/ReplayPreparation';
import { useLanguage } from '../../../i18n/LanguageContext';
import { INSTANT_LENGTHS, type InstantLength } from '../../../lib/instantReplay';
import type { SavedReplayClip } from '../../../live/replayBuffer';
import { RefineList, RefineNote, RefineSection } from '../../refine/Refine';
import { ReplayEditor } from './ReplayEditor';
import { lengthText } from './streamText';

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

const timeOf = (iso: string, locale: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
};

function Row({ clip, open, action, onToggle }: { clip: SavedReplayClip; open: boolean; action: string; onToggle: () => void }) {
  const { t, locale } = useLanguage();
  const time = timeOf(clip.createdAt, locale);
  return (
    <button type="button" className="rf-row" aria-expanded={open} onClick={onToggle}>
      <span className="rf-grow"><span className="rf-t1">{clip.label}</span><span className="rf-t2">{[time && t('desk.stream.rt.saved', { time }), lengthText(t, Math.round(clip.durationSeconds))].filter(Boolean).join(' · ')}</span></span>
      <span className="rf-btn">{open ? t('common.close') : action}</span>
    </button>
  );
}

export function ReplayTab({ competitionId, clips, openId, onOpen, controller, instantLength, onInstantLength }: {
  competitionId: number;
  clips: SavedReplayClip[];
  openId: string | null;
  onOpen: (clipId: string | null) => void;
  controller: Controller;
  instantLength: InstantLength;
  onInstantLength: (length: InstantLength) => void;
}) {
  const { t } = useLanguage();
  const newestFirst = [...clips].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
          ? (minutes > 0 ? t('desk.stream.rt.recordingMin', { minutes }) : t('desk.stream.rt.recordingSecs'))
          : t('desk.stream.rt.notRecording')}
      </RefineNote>
      {controller.warning && <Notice role="status">{controller.warning}</Notice>}

      <RefineList as="div" label={t('desk.stream.rt.raceRecordings')}>
        <Link to={`/competitions/${competitionId}/recordings`} className="rf-row">
          <span className="rf-grow"><span className="rf-t1">{t('desk.stream.rt.raceRecordings')}</span><span className="rf-t2">{t('desk.stream.rt.raceRecordingsHint')}</span></span>
          <ChevronRight className="rf-chev h-4 w-4" aria-hidden="true" />
        </Link>
      </RefineList>

      <RefineSection title={t('desk.stream.rt.instantSaves')} />
      <div className="sx-pills" role="radiogroup" aria-label={t('desk.stream.rt.instantLength')}>
        {INSTANT_LENGTHS.map((length) => (
          <button key={length} type="button" role="radio" aria-checked={instantLength === length} className="sx-pill" onClick={() => onInstantLength(length)}>{t('desk.stream.rt.lastLength', { length: lengthText(t, length) })}</button>
        ))}
      </div>

      <RefineSection title={t('desk.stream.rt.savedReplays')} />
      <RefineList as="div" label={t('desk.stream.rt.savedReplays')}>
        {saved.length === 0 && <div className="rf-row"><span className="rf-t2">{t('desk.stream.rt.noSaved')}</span></div>}
        {saved.map((clip) => <Row key={clip.id} clip={clip} open={openId === clip.id} action={t('common.edit')} onToggle={() => onOpen(openId === clip.id ? null : clip.id)} />)}
      </RefineList>
    </>
  );
}
