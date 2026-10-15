import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LogIn, AlertCircle, KeyRound, Mail, ArrowLeft, UserPlus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api';
import { SIGNUP_ROLES, type Club } from '../types';

type Tab = 'trainer' | 'signup' | 'admin';

interface NavState { from?: string }

export function LoginPage() {
  const { login, loginWithAdminKey, signupTrainer, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [tab, setTab] = useState<Tab>('trainer');
  const [email, setEmail] = useState('trainer@mg.local');
  const [password, setPassword] = useState('Trainer!234');
  const [signupUser, setSignupUser] = useState('');
  const [signupPw, setSignupPw] = useState('');
  const [signupRole, setSignupRole] = useState<'Trainer' | 'Manager' | 'Member'>('Trainer');
  const [signupClub, setSignupClub] = useState('');
  const [clubs, setClubs] = useState<Club[]>([]);

  useEffect(() => {
    if (tab !== 'signup' || clubs.length > 0) return;
    api.get<Club[]>('/clubs').then((r) => setClubs(r.data)).catch(() => {});
  }, [tab, clubs.length]);
  const [adminKey, setAdminKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (tab === 'trainer') {
        await login(email, password);
      } else if (tab === 'signup') {
        await signupTrainer(signupUser, signupPw, signupRole, signupClub.trim() || undefined);
      } else {
        await loginWithAdminKey(adminKey);
      }
      const from = (loc.state as NavState | null)?.from ?? '/';
      nav(from, { replace: true });
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data;
      const msg = data?.message ?? data?.errors?.join(' ');
      setError(msg ?? (
        tab === 'trainer' ? 'Could not sign in. Check your credentials.' :
        tab === 'signup' ? 'Could not create the account.' :
        'That admin key did not work.'
      ));
    }
  }

  return (
    <div className="skin flex min-h-screen flex-col">
      <header className="mg-header">
        <div className="mx-auto flex max-w-5xl items-center gap-2.5 py-3 pl-4 pr-3">
          <Link to="/" className="mg-logo" aria-label="Mounted Games home">MG</Link>
          <span className="min-w-0 flex-1 truncate text-base font-semibold">Mounted Games</span>
          <Link to="/" className="mg-nav-btn !pl-2"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Back to public view</Link>
        </div>
      </header>
      <div className="flex flex-1 items-start justify-center px-4 py-6 sm:items-center">
      <motion.form
        onSubmit={submit}
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="mg-card w-full max-w-md p-6"
      >
        <div className="mb-6 flex flex-col gap-1.5">
          <h1 className="mg-h1">Sign in</h1>
          <p className="mg-lede">For trainers, organisers and stewards. You don't need an account to follow a competition.</p>
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 rounded-[10px] bg-[rgb(var(--mg-tint))] mb-6">
          <button type="button"
            onClick={() => { setTab('trainer'); setError(null); }}
            className={`min-h-11 px-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 ${
              tab === 'trainer' ? 'bg-[rgb(var(--mg-surface))] text-[rgb(var(--mg-heading))] shadow-sm' : 'text-[rgb(var(--mg-body))]'
            }`}>
            <Mail className="w-4 h-4" /> Sign in
          </button>
          <button type="button"
            onClick={() => { setTab('signup'); setError(null); }}
            className={`min-h-11 px-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 ${
              tab === 'signup' ? 'bg-[rgb(var(--mg-surface))] text-[rgb(var(--mg-heading))] shadow-sm' : 'text-[rgb(var(--mg-body))]'
            }`}>
            <UserPlus className="w-4 h-4" /> Sign up
          </button>
          <button type="button"
            onClick={() => { setTab('admin'); setError(null); }}
            className={`min-h-11 px-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 ${
              tab === 'admin' ? 'bg-[rgb(var(--mg-surface))] text-[rgb(var(--mg-heading))] shadow-sm' : 'text-[rgb(var(--mg-body))]'
            }`}>
            <KeyRound className="w-4 h-4" /> Organiser
          </button>
        </div>

        {tab === 'trainer' && (
          <>
            <label className="block mb-3">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email" className="input mt-1" value={email}
                onChange={(e) => setEmail(e.target.value)} required autoFocus
              />
            </label>
            <label className="block mb-4">
              <span className="text-sm font-medium">Password</span>
              <input
                type="password" className="input mt-1" value={password}
                onChange={(e) => setPassword(e.target.value)} required
              />
            </label>
          </>
        )}
        {tab === 'signup' && (
          <>
            <label className="block mb-3">
              <span className="text-sm font-medium">Username</span>
              <input
                type="text" className="input mt-1" value={signupUser}
                onChange={(e) => setSignupUser(e.target.value)}
                placeholder="e.g. coach.alex" required autoFocus
              />
              <span className="text-xs text-slate-500 mt-1 block">An email is fine too.</span>
            </label>
            <label className="block mb-3">
              <span className="text-sm font-medium">I'm signing up as a</span>
              <div className="grid grid-cols-3 gap-1 mt-1">
                {SIGNUP_ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setSignupRole(r.value)}
                    className={`px-2 py-1.5 rounded-md text-xs font-semibold border transition ${
                      signupRole === r.value
                        ? 'bg-brand-600 text-white border-brand-600 shadow-soft'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                    }`}
                    title={r.description}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-500 mt-1 block">
                {SIGNUP_ROLES.find((r) => r.value === signupRole)?.description}
              </span>
            </label>
            <label className="block mb-3">
              <span className="text-sm font-medium">Pony Club <span className="text-slate-400 font-normal">(optional)</span></span>
              <input
                type="text"
                className="input mt-1"
                list="signup-clubs"
                placeholder="Start typing to autocomplete…"
                value={signupClub}
                onChange={(e) => setSignupClub(e.target.value)}
              />
              <datalist id="signup-clubs">
                {clubs.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
              <span className="text-xs text-slate-500 mt-1 block">
                Links your account to your club so you can see its teams + dec forms.
              </span>
            </label>
            <label className="block mb-4">
              <span className="text-sm font-medium">Password</span>
              <input
                type="password" className="input mt-1" value={signupPw}
                onChange={(e) => setSignupPw(e.target.value)} required minLength={8}
              />
              <span className="text-xs text-slate-500 mt-1 block">
                At least 8 chars, with a number, a lowercase letter and a symbol.
              </span>
            </label>
          </>
        )}
        {tab === 'admin' && (
          <label className="block mb-4">
            <span className="text-sm font-medium">Admin key</span>
            <input
              type="text" className="input mt-1 font-mono"
              placeholder="Enter the shared admin key"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              required autoFocus
            />
            <span className="text-xs text-slate-500 mt-1 block">
              All organisers share the same key. Ask your event lead for it.
            </span>
          </label>
        )}

        {error && (
          <div className="flex items-center gap-2 text-rose-600 text-sm mb-3">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="mg-btn mg-btn-primary w-full">
          {tab === 'signup' ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
          {loading
            ? (tab === 'signup' ? 'Creating account…' : 'Signing in…')
            : (tab === 'signup' ? `Create ${signupRole.toLowerCase()} account` : 'Sign in')}
        </button>

        <div className="mt-6 text-xs text-slate-500">
          {tab === 'trainer' && (
            <>
              <p className="font-semibold mb-1">Demo credentials</p>
              <ul className="space-y-0.5">
                <li><code>trainer@mg.local</code> / <code>Trainer!234</code></li>
                <li><code>coach@mg.local</code> / <code>Trainer!234</code></li>
              </ul>
            </>
          )}
          {tab === 'signup' && (
            <p>Passwords are hashed with PBKDF2 before being stored — we never see the plain text.</p>
          )}
          {tab === 'admin' && (
            <ul className="space-y-0.5">
              <li>Key: <code>MGADMIN-DEMO-2026</code></li>
            </ul>
          )}
        </div>
      </motion.form>
      </div>
    </div>
  );
}
