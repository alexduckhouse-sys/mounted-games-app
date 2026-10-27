import { useState } from 'react';
import type { LinkedSignInsState } from '../hooks/useLinkedSignIns';
import { externalErrorMessage } from '../lib/externalAuthError';
import { confirmDialog } from './ConfirmDialog';
import { Notice } from './Notice';
import { SocialLoginButtons, useSocialProviders, type SocialCredential } from './SocialLoginButtons';
import './sitePages.css';

// eslint-disable-next-line react-refresh/only-export-components
export const LINKED_SIGN_INS_COPY = {
  heading: 'Ways to sign in',
  onlyWayIn: 'Only way in',
  onlyWayInNote: 'Your account has no password, so this is the only way you can sign in.',
  add: 'Add one so you can sign in with it too.',
  removeTitle: (name: string) => `Remove ${name} sign-in?`,
  removeMessage: (name: string) => `You won’t be able to sign in with ${name} any more. You can add it again later.`,
  added: (name: string) => `${name} added`,
  removed: (name: string) => `${name} removed`,
  failed: 'Couldn’t change that. Check your signal and try again.',
};

interface LinkedSignInsProps extends LinkedSignInsState {
  /** A short "Google added" for the page's toast. */
  onChanged: (message: string) => void;
}

/**
 * "Ways to sign in" on My account: the Google and Apple sign-ins linked to the account, each with Remove, and the
 * providers' own "Continue with …" buttons to add the others. The last way into an account with no password can't be
 * removed (the API refuses too). Adding one emails the account's address.
 */
export function LinkedSignIns({ info, connect, remove, onChanged }: LinkedSignInsProps) {
  const providers = useSocialProviders();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!info) return null;

  const linked = new Set(info.logins.map((l) => l.provider));
  const addable = providers.filter((p) => !linked.has(p.id));
  if (info.logins.length === 0 && addable.length === 0) return null;
  const lastWayIn = !info.hasPassword && info.logins.length === 1;

  async function add(credential: SocialCredential) {
    setBusy(true);
    setError(null);
    try {
      await connect(credential);
      // The button came from this list, so the provider is in it.
      onChanged(LINKED_SIGN_INS_COPY.added(addable.find((p) => p.id === credential.provider)!.name));
    } catch (e) {
      setError(externalErrorMessage(e, LINKED_SIGN_INS_COPY.failed));
    } finally {
      setBusy(false);
    }
  }

  async function removeOne(provider: string, name: string) {
    const sure = await confirmDialog({
      title: LINKED_SIGN_INS_COPY.removeTitle(name),
      message: LINKED_SIGN_INS_COPY.removeMessage(name),
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!sure) return;
    setBusy(true);
    setError(null);
    try {
      await remove(provider);
      onChanged(LINKED_SIGN_INS_COPY.removed(name));
    } catch (e) {
      setError(externalErrorMessage(e, LINKED_SIGN_INS_COPY.failed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="ways-to-sign-in">
      <h2 id="ways-to-sign-in" className="sp-sec">{LINKED_SIGN_INS_COPY.heading}</h2>
      {info.logins.length > 0 && (
        <div className="sp-card">
          {info.logins.map((login) => (
            <div key={login.provider} className="sp-row">
              <span className="sp-t1 sp-grow">{login.name}</span>
              {lastWayIn
                ? <span className="sp-t2">{LINKED_SIGN_INS_COPY.onlyWayIn}</span>
                : (
                  <button type="button" className="sp-red" disabled={busy} onClick={() => removeOne(login.provider, login.name)}
                    aria-label={`Remove ${login.name} sign-in`}>
                    Remove
                  </button>
                )}
            </div>
          ))}
        </div>
      )}
      {lastWayIn && <p className="sp-note">{LINKED_SIGN_INS_COPY.onlyWayInNote}</p>}
      {addable.length > 0 && (
        <div className="mt-3 flex flex-col gap-2.5">
          <p className="sp-note !mt-0">{LINKED_SIGN_INS_COPY.add}</p>
          <SocialLoginButtons only={addable.map((p) => p.id)} divider={false} label="continue" disabled={busy} onCredential={add} onError={setError} />
        </div>
      )}
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    </section>
  );
}
