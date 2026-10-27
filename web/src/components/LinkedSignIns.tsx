import { useState, type FormEvent } from 'react';
import type { LinkedSignInsState, SignInProof } from '../hooks/useLinkedSignIns';
import { useT } from '../i18n/LanguageContext';
import { externalErrorMessage } from '../lib/externalAuthError';
import type { ExternalProvider } from '../types';
import { Notice } from './Notice';
import { Sheet } from './Sheet';
import { SocialLoginButtons, useSocialProviders, type SocialCredential } from './SocialLoginButtons';
import './sitePages.css';

interface LinkedSignInsProps extends LinkedSignInsState {
  /** A short "Google added" for the page's toast. */
  onChanged: (message: string) => void;
}

/** What is waiting for the owner to confirm: a provider to add (its sign-in is already in hand) or one to remove. */
type Pending =
  | { kind: 'add'; credential: SocialCredential; name: string }
  | { kind: 'remove'; provider: string; name: string };

const isProviderId = (id: string): id is ExternalProvider['id'] => id === 'google' || id === 'apple' || id === 'facebook';

/**
 * "Ways to sign in" on My account: the Google, Apple and Facebook sign-ins linked to the account, each with Remove, and
 * the providers' own "Continue with …" buttons to add the others. Adding or removing one first asks the owner to prove
 * they're here, in a sheet: the password, or for an account without one a fresh sign-in with a provider it already has.
 * The API insists on that too, emails the account, and signs every other device out. The last way into an account with
 * no password can't be removed (the API refuses too).
 */
export function LinkedSignIns({ info, connect, remove, onChanged }: LinkedSignInsProps) {
  const t = useT();
  const providers = useSocialProviders();
  const [pending, setPending] = useState<Pending | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  if (!info) return null;

  const linked = new Set(info.logins.map((l) => l.provider));
  const addable = providers.filter((p) => !linked.has(p.id));
  if (info.logins.length === 0 && addable.length === 0) return null;
  const lastWayIn = !info.hasPassword && info.logins.length === 1;
  const confirmWith = info.logins.map((l) => l.provider).filter(isProviderId);

  function open(next: Pending) {
    setPassword('');
    setError(null);
    setSheetError(null);
    setPending(next);
  }

  function close() {
    if (busy) return;
    setPending(null);
    setPassword('');
    setSheetError(null);
  }

  async function confirmed(proof: SignInProof) {
    if (!pending || busy) return;
    setBusy(true);
    setSheetError(null);
    try {
      if (pending.kind === 'add') {
        await connect(pending.credential, proof);
        onChanged(t('account.signIns.added', { name: pending.name }));
      } else {
        await remove(pending.provider, proof);
        onChanged(t('account.signIns.removed', { name: pending.name }));
      }
      setPending(null);
      setPassword('');
    } catch (e) {
      setSheetError(externalErrorMessage(e, t('account.signIns.failed')));
    } finally {
      setBusy(false);
    }
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (password) void confirmed({ password });
  }

  function add(credential: SocialCredential) {
    // The button came from this list, so the provider is in it.
    open({ kind: 'add', credential, name: addable.find((p) => p.id === credential.provider)!.name });
  }

  const adding = pending?.kind === 'add';
  return (
    <section aria-labelledby="ways-to-sign-in">
      <h2 id="ways-to-sign-in" className="sp-sec">{t('account.signIns.heading')}</h2>
      {info.logins.length > 0 && (
        <div className="sp-card">
          {info.logins.map((login) => (
            <div key={login.provider} className="sp-row">
              <span className="sp-t1 sp-grow">{login.name}</span>
              {lastWayIn
                ? <span className="sp-t2">{t('account.signIns.onlyWayIn')}</span>
                : (
                  <button type="button" className="sp-red" disabled={busy}
                    onClick={() => open({ kind: 'remove', provider: login.provider, name: login.name })}
                    aria-label={t('account.signIns.removeAria', { name: login.name })}>
                    {t('account.signIns.remove')}
                  </button>
                )}
            </div>
          ))}
        </div>
      )}
      {lastWayIn && <p className="sp-note">{t('account.signIns.onlyWayInNote')}</p>}
      {/* Hidden while a sheet is open, so only one Google button is set up at a time. */}
      {addable.length > 0 && !pending && (
        <div className="mt-3 flex flex-col gap-2.5">
          <p className="sp-note !mt-0">{t('account.signIns.add')}</p>
          <SocialLoginButtons only={addable.map((p) => p.id)} divider={false} label="continue" disabled={busy} onCredential={add} onError={setError} />
        </div>
      )}
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}

      {pending && (
        <Sheet
          title={t(adding ? 'account.signIns.addTitle' : 'account.signIns.removeTitle', { name: pending.name })}
          description={t(adding ? 'account.signIns.addMessage' : 'account.signIns.removeMessage', { name: pending.name })}
          onClose={close}
          dismissible={!busy}
          initialFocus={info.hasPassword ? '#linked-sign-ins-password' : undefined}
        >
          {info.hasPassword ? (
            <form onSubmit={submitPassword} className="kit-sheet-inner">
              <label className="kit-sheet-field" htmlFor="linked-sign-ins-password">
                {t('account.signIns.password')}
                <input
                  id="linked-sign-ins-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {sheetError && <Notice>{sheetError}</Notice>}
              <div className={adding ? 'kit-acts' : 'kit-acts-del'}>
                {adding ? (
                  <>
                    <button type="submit" className="kit-pill kit-pill-fill" disabled={!password || busy}>
                      {busy ? t('account.signIns.adding') : t('account.signIns.addButton')}
                    </button>
                    <button type="button" className="kit-pill" onClick={close} disabled={busy}>{t('common.cancel')}</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="kit-pill" onClick={close} disabled={busy}>{t('common.cancel')}</button>
                    <button type="submit" className="kit-pill kit-pill-del" disabled={!password || busy}>
                      {busy ? t('account.signIns.removing') : t('account.signIns.remove')}
                    </button>
                  </>
                )}
              </div>
            </form>
          ) : (
            <div className="kit-sheet-inner">
              <p className="m-0">{t('account.signIns.confirmWithProvider')}</p>
              <SocialLoginButtons only={confirmWith} divider={false} confirm disabled={busy}
                onCredential={({ provider, idToken, nonce }) => confirmed({ provider, idToken, nonce })} onError={setSheetError} />
              {sheetError && <Notice>{sheetError}</Notice>}
              <div className="kit-acts-del">
                <button type="button" className="kit-pill" onClick={close} disabled={busy}>{t('common.cancel')}</button>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </section>
  );
}
