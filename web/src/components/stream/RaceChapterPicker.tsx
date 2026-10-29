import { useT } from '../../i18n/LanguageContext';
import { computeRaceChapters, type ReplayClipWindow } from '../../lib/replayChapters';

/** One compact chapter selector; estimates are labelled so old recordings never imply exact starts. */
export function RaceChapterPicker({ clip, onSeek }: { clip: ReplayClipWindow; onSeek: (seconds: number) => void }) {
  const t = useT();
  const chapters = computeRaceChapters(clip);
  if (!chapters.length) return null;
  return <label className="flex items-center justify-between gap-3 text-sm">
    <span>{t('timing.jump')}</span>
    <select className="input min-h-11 max-w-[75%]" aria-label={t('timing.jump')} value="" onChange={(event) => {
      const chapter = chapters.find((item) => String(item.id) === event.target.value);
      if (chapter) onSeek(chapter.timeSec);
    }}>
      <option value="">{t('timing.choose')}</option>
      {chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.code} · {chapter.name}{chapter.estimated ? t('timing.estimated') : ''}</option>)}
    </select>
  </label>;
}
