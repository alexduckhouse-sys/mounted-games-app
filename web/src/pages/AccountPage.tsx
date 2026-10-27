import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/LanguageContext';
import { ChangePasswordSheet } from '../components/ChangePasswordSheet';
import { usePageHeader } from '../components/CompactPageBarContext';
import { DeleteAccountPanel } from '../components/DeleteAccountPanel';
import { Notice } from '../components/Notice';
import { useToast } from '../components/Toast';
import { apiErrorMessage } from '../lib/apiError';
import { roleLabel } from '../lib/profile';
import '../components/sitePages.css';

/** The signed-in person's own details: name (editable in place), email, club, role, password and deleting the account. */
export function AccountPage() {
  const t = useT();
  const { user, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const toast = useToast();
  usePageHeader({ title: t('account.account.title'), plain: true, backTo: '/me', backLabel: t('account.backToMe') });
  if (!user) return null;

  function startEditing() {
    setDraft(user?.fullName ?? '');
    setError(null);
    setEditing(true);
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name || busy) return;
    if (name === user?.fullName) { setEditing(false); return; }
    setBusy(true);
    setError(null);
    try {
      await api.put('/auth/me', { fullName: name });
      await refreshUser();
      setEditing(false);
      toast.show(t('account.account.nameSaved'));
    } catch (e) {
      setError(apiErrorMessage(e, t('account.account.nameFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="skin mx-auto w-full max-w-[560px] pb-4 pt-3">
      <h1 className="sr-only">{t('account.account.title')}</h1>
      <h2 className="sp-sec sp-first">{t('account.account.you')}</h2>
      <div className="sp-card">
        {editing ? (
          <form onSubmit={saveName} className="sp-row !items-end">
            <label className="sp-field sp-grow !p-0">
              {t('account.account.name')}
              <input value={draft} maxLength={100} autoComplete="name" autoFocus onChange={(e) => setDraft(e.target.value)} />
            </label>
            <button type="submit" className="sp-pill sp-pill-fill" disabled={!draft.trim() || busy}>{busy ? t('common.saving') : t('entries.dec.done')}</button>
          </form>
        ) : (
          <button type="button" className="sp-row" onClick={startEditing} aria-label={t('account.account.nameAria', { value: user.fullName || t('account.account.notSet') })}>
            <span className="sp-t1 sp-grow">{t('account.account.name')}</span>
            <span className="sp-val">{user.fullName || t('account.account.notSet')}</span>
            <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
        {error && <div className="px-3.5 py-3"><Notice>{error}</Notice></div>}
        <div className="sp-row"><span className="sp-t1 sp-grow">{t('account.account.email')}</span><span className="sp-t2 break-all text-right">{user.email}</span></div>
        {user.clubName && <div className="sp-row"><span className="sp-t1 sp-grow">{t('account.account.club')}</span><span className="sp-t2 text-right">{user.clubName}</span></div>}
        <div className="sp-row"><span className="sp-t1 sp-grow">{t('account.account.role')}</span><span className="sp-t2 text-right">{roleLabel(user.roles)}</span></div>
        <button type="button" className="sp-row" onClick={() => setPasswordOpen(true)} aria-label={t('account.account.passwordAria')}>
          <span className="sp-t1 sp-grow">{t('account.account.password')}</span>
          <span className="sp-val">{t('account.account.change')}</span>
          <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
      <p className="sp-note">{t('account.account.privacyBefore')}<Link to="/privacy" className="font-semibold text-[rgb(var(--mg-heading))] underline">{t('account.account.privacyLink')}</Link>{t('account.account.privacyAfter')}</p>
      <div className="mt-4"><DeleteAccountPanel /></div>
      {passwordOpen && <ChangePasswordSheet onClose={() => setPasswordOpen(false)} onChanged={() => { setPasswordOpen(false); toast.show(t('account.account.passwordChanged')); }} />}
      {toast.node}
    </div>
  );
}
