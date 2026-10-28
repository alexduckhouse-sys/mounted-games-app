import { useT } from '../../i18n/LanguageContext';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { tr } from '../../i18n/translate';
import { Notice } from '../../components/Notice';
import { apiErrorMessage } from '../../lib/apiError';
import { createZipArchive, eventArchiveFileName, fetchEventArchive } from '../../lib/eventArchive';

/**
 * The organiser's whole-event archive: results book, standings, timetable, dec forms, entries and a snapshot, as one
 * zip made on this device from the server's files. Dec forms hold riders' details, so it stays on staff pages.
 */
export function ArchiveDownload({ competitionId }: { competitionId: number }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const archive = await fetchEventArchive(competitionId);
      const files = archive && typeof archive === 'object' && archive.files && typeof archive.files === 'object' ? archive.files : null;
      if (!files || Object.keys(files).length === 0) throw new Error('empty');
      const zip = createZipArchive(files);
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = archive.fileName || eventArchiveFileName(archive.competitionName ?? 'competition');
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setError(err instanceof Error && err.message === 'empty'
        ? tr('ops3.archive.nothing')
        : apiErrorMessage(err, tr('ops3.archive.error')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="rf-row w-full text-left" onClick={() => { void download(); }} disabled={busy}>
        <span className="rf-grow">
          <span className="rf-t1">{busy ? t('ops3.archive.making') : t('ops3.archive.download')}</span>
          <span className="rf-t2">{t('ops3.archive.sub')}</span>
        </span>
        <Download aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-heading))]" strokeWidth={2.25} />
      </button>
      {error && <Notice className="tools-msg">{error}</Notice>}
    </>
  );
}
