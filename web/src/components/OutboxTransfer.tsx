import { useT } from '../i18n/LanguageContext';
import { useState } from 'react';
import { exportCompetitionOutbox, importCompetitionOutbox, shareOrCopyOutboxBackup, useScoreOutbox } from '../offline/useScoreOutbox';
import { backupFrames, recoveryText, scoreBackupPdf } from '../offline/outboxRecovery';
import { QrCode } from './QrCode';
import { ScoreBackupScanner } from './ScoreBackupScanner';
import { Notice } from './Notice';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

/**
 * Emergency hand-over of scores between phones when neither has signal: send what is unsent from this phone, or
 * paste (or pick) a backup from another one. Sending only shows when this competition has unsent scores.
 */
export function OutboxTransfer({ competitionId, competitionName, showImport = true, viaLink = false }: { competitionId: number; competitionName?: string; showImport?: boolean; viaLink?: boolean }) {
  const t = useT();
  const scores = useScoreOutbox().filter((q) => q.competitionId === competitionId);
  const unsent = scores.length;
  const [frames, setFrames] = useState<string[]>([]);
  const [frame, setFrame] = useState(0);
  const [importing, setImporting] = useState(false);
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  if (unsent === 0 && !showImport) return null;

  async function send() {
    const result = await shareOrCopyOutboxBackup(competitionId, competitionName);
    toast.show(result === 'shared' ? 'Backup shared' : result === 'copied' ? 'Backup copied. Paste it into a message' : 'Couldn’t share or copy. Try again');
  }

  function add() {
    let backup: string;
    try { backup = recoveryText(raw); } catch (e) { setError(e instanceof Error ? e.message : t('reliability.readBackupError')); return; }
    const result = importCompetitionOutbox(backup, { fallbackCompetitionId: competitionId, viaLink });
    if (!result.ok) { setError(result.error); return; }
    setImporting(false);
    setRaw('');
    setError(null);
    toast.show(result.count === 1 ? '1 race added' : `${result.count} races added`);
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    try { setRaw(await file.text()); setError(null); } catch { setError('That file could not be read.'); }
  }

  function showQr() {
    try { setFrames(backupFrames(exportCompetitionOutbox(competitionId))); setFrame(0); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : t('reliability.makeBackupError')); }
  }
  function savePdf() {
    try {
      const now = new Date().toISOString();
      const blob = scoreBackupPdf(exportCompetitionOutbox(competitionId, now), scores, competitionName ?? t('reliability.competition', { id: competitionId }), now);
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `score-backup-${competitionId}-${now.slice(0, 10)}.pdf`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : t('reliability.saveBackupError')); }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4">
      {unsent > 0 && <button type="button" className="sc-link" onClick={() => void send()}>Send unsent scores to another phone</button>}
      {unsent > 0 && <><button type="button" className="sc-link" onClick={showQr}>{t('reliability.showQr')}</button><button type="button" className="sc-link" onClick={savePdf}>{t('reliability.savePdf')}</button></>}
      {error && !importing && <Notice>{error}</Notice>}
      {frames.length > 0 && <Sheet title={t('reliability.qrTitle')} description={t('reliability.qrHelp')} onClose={() => setFrames([])}>
        <QrCode value={frames[frame]} label={t('reliability.backupCode', { n: frame + 1, total: frames.length })} className="w-full max-w-sm mx-auto" />
        <p role="status">{t('reliability.code', { n: frame + 1, total: frames.length })}</p>
        <div className="kit-acts"><button type="button" className="kit-pill" disabled={frame === 0} onClick={() => setFrame(n => n - 1)}>{t('reliability.previousCode')}</button><button type="button" className="kit-pill" disabled={frame === frames.length - 1} onClick={() => setFrame(n => n + 1)}>{t('reliability.nextCode')}</button></div>
        <label className="kit-sheet-field">{t('reliability.copyCode')}<textarea readOnly rows={3} value={frames[frame]} /></label>
      </Sheet>}
      {showImport && <button type="button" className="sc-link" onClick={() => setImporting(true)}>Import scores from another phone</button>}
      {importing && (
        <Sheet title="Import scores" description="Paste the backup sent from the other phone. The races join this phone’s waiting list and send when you have signal." onClose={() => { setImporting(false); setError(null); }}>
          <ScoreBackupScanner onBackup={(backup) => { setRaw(backup); setError(null); }} />
          <label className="kit-sheet-field">Backup
            <textarea className="input" rows={5} value={raw} onChange={(event) => { setRaw(event.target.value); setError(null); }} />
          </label>
          <label className="kit-sheet-field">Or choose a saved backup file
            <input type="file" accept=".json,.txt,.pdf,application/json,text/plain,application/pdf" onChange={(event) => void pickFile(event.target.files?.[0])} />
          </label>
          {error && <Notice>{error}</Notice>}
          <div className="kit-acts">
            <button type="button" className="kit-pill kit-pill-fill" disabled={!raw.trim()} onClick={add}>Add scores</button>
          </div>
        </Sheet>
      )}
      {toast.node}
    </div>
  );
}
