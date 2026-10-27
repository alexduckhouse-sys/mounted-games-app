import { useState } from 'react';
import { importCompetitionOutbox, shareOrCopyOutboxBackup, useScoreOutbox } from '../offline/useScoreOutbox';
import { Notice } from './Notice';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

/**
 * Emergency hand-over of scores between phones when neither has signal: send what is unsent from this phone, or
 * paste (or pick) a backup from another one. Sending only shows when this competition has unsent scores.
 */
export function OutboxTransfer({ competitionId, competitionName, showImport = true, viaLink = false }: { competitionId: number; competitionName?: string; showImport?: boolean; viaLink?: boolean }) {
  const unsent = useScoreOutbox().filter((q) => q.competitionId === competitionId).length;
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
    const result = importCompetitionOutbox(raw, { fallbackCompetitionId: competitionId, viaLink });
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

  return (
    <div className="flex flex-wrap items-center gap-x-4">
      {unsent > 0 && <button type="button" className="sc-link" onClick={() => void send()}>Send unsent scores to another phone</button>}
      {showImport && <button type="button" className="sc-link" onClick={() => setImporting(true)}>Import scores from another phone</button>}
      {importing && (
        <Sheet title="Import scores" description="Paste the backup sent from the other phone. The races join this phone’s waiting list and send when you have signal." onClose={() => { setImporting(false); setError(null); }}>
          <label className="kit-sheet-field">Backup
            <textarea className="input" rows={5} value={raw} onChange={(event) => { setRaw(event.target.value); setError(null); }} />
          </label>
          <label className="kit-sheet-field">Or choose a saved backup file
            <input type="file" accept=".json,.txt,application/json,text/plain" onChange={(event) => void pickFile(event.target.files?.[0])} />
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
