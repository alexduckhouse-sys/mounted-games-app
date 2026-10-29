import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n/LanguageContext';
import { apiErrorMessage } from '../../lib/apiError';
import { CardDropdownRow } from '../CardDropdownRow';
import { Notice } from '../Notice';
interface Fulfilment { kind: 0 | 1 | 2 | 3 | 4; fromDate: string | null; untilDate: string | null; expectedVersion: number }
export function CatalogueFulfilmentEditor({ itemId, onChanged }: { itemId: number; onChanged: () => Promise<void> }) {
  const t = useT(); const [value, setValue] = useState<Fulfilment | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  const path = `/apple/catalogue/${itemId}/fulfilment`;
  useEffect(() => { let active = true; void api.get<Fulfilment>(path).then(r => { if (active) setValue(r.data); }).catch(e => { if (active) setError(apiErrorMessage(e, t('apple.arrival.error'))); }); return () => { active = false; }; }, [path, t]);
  function change(patch: Partial<Fulfilment>) { if (value) setValue({ ...value, ...patch }); setSaved(false); }
  async function save() {
    setBusy(true); setError(''); setSaved(false);
    try { const r = await api.put<Fulfilment>(path, value); setValue(r.data); setSaved(true); await onChanged(); }
    catch (e) { setError(apiErrorMessage(e, t('apple.arrival.error'))); } finally { setBusy(false); }
  }
  const valid = value && (value.kind < 3 || (value.fromDate && value.untilDate && value.untilDate > value.fromDate));
  return <section><h2 className="sp-sec">{t('apple.arrival.kind')}</h2>{value && <>
    <div className="sp-card"><CardDropdownRow label={t('apple.arrival.kind')} value={String(value.kind)} disabled={busy} options={([0, 1, 2, 3, 4] as const).map(kind => ({ value: String(kind), label: t(`apple.arrival.kind${kind}`) }))} onChange={kind => change({ kind: Number(kind) as Fulfilment['kind'] })} /></div>
    <p className="sp-note">{t('apple.arrival.futurePurchases')}</p>
    {value.kind >= 3 && <><div className="et-two"><label className="rf-fld">{t('apple.arrival.firstNight')}<input type="date" disabled={busy} value={value.fromDate ?? ''} onChange={e => change({ fromDate: e.target.value })} /></label><label className="rf-fld">{t('apple.arrival.departure')}<input type="date" disabled={busy} value={value.untilDate ?? ''} onChange={e => change({ untilDate: e.target.value })} /></label></div><p className="sp-note">{t('apple.arrival.nightsHint')}</p></>}
    <div className="kit-acts"><button type="button" className="kit-pill" disabled={busy || !valid} onClick={() => void save()}>{t('apple.arrival.confirmKind')}</button>{saved && <span role="status">{t('ops2.signup.saved')}</span>}</div>
  </>}{error && <Notice>{error}</Notice>}</section>;
}
