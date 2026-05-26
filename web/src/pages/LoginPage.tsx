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
    <div className="min-h-screen flex items-center justify-center px-4">
      <motion.form
        onSubmit={submit}
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="card p-8 w-full max-w-md"
      >
        <Link to="/" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600 mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to public view
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-soft" />
          <div>
            <h1 className="text-2xl font-bold">Sign in</h1>
            <p className="text-sm text-slate-500">Trainers and organisers only — guests can browse without signing in.</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 mb-6">
          <button type="button"
            onClick={() => { setTab('trainer'); setError(null); }}
            className={`px-2 py-2 rounded-lg text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 ${
              tab === 'trainer' ? 'bg-white dark:bg-slate-700 shadow-soft' : 'text-slate-600 dark:text-slate-300'
            }`}>
            <Mail className="w-4 h-4" /> Sign in
          </button>
          <button type="button"
            onClick={() => { setTab('signup'); setError(null); }}
            className={`px-2 py-2 rounded-lg text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 ${
              tab === 'signup' ? 'bg-white dark:bg-slate-700 shadow-soft' : 'text-slate-600 dark:text-slate-300'
            }`}>
            <UserPlus className="w-4 h-4" /> Sign up
          </button>
          <button type="button"
            onClick={() => { setTab('admin'); setError(null); }}
            className={`px-2 py-2 rounded-lg text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 ${
              tab === 'admin' ? 'bg-white dark:bg-slate-700 shadow-soft' : 'text-slate-600 dark:text-slate-300'
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

        <button type="submit" disabled={loading} className="btn-primary w-full">
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
  );
}
