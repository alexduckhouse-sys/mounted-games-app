import { tr } from '../../i18n/translate';
import { useState } from 'react';
import { whatsAppUrl } from '../../lib/whatsapp';
import { RefineSheet } from '../refine/Refine';

/** Opening WhatsApp prepares text only. The organiser chooses the chat and sends it there. */
export function WhatsAppComposer({ text, title = tr('completion.whatsapp') }: { text: string; title?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <>
    <button className="rf-btn" type="button" onClick={() => setDraft(text)}>{title}</button>
    {draft !== null && <RefineSheet title={title} onClose={() => setDraft(null)}><div className="et-sheet">
      <label className="rf-fld">{tr('completion.message')}<textarea rows={6} value={draft} onChange={e => setDraft(e.target.value)} /></label>
      <p className="rf-note">{tr('completion.whatsappHint')}</p>
      {draft.trim() && <a className="rf-btn rf-btn-primary" href={whatsAppUrl(draft)} target="_blank" rel="noopener noreferrer">{tr('completion.openWhatsapp')}</a>}
    </div></RefineSheet>}
  </>;
}
