import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AuthError, LocalBackend, SupabaseBackend, type Backend } from '../lib/backend';
import { clearBrowserConfig, readConfig, saveBrowserConfig, type AppConfig } from '../lib/config';
import { defaultSettings } from '../lib/defaults';
import { StoreProvider } from '../lib/store';
import type { AppData } from '../lib/types';
import { Button, Notice } from './ui';

interface SessionValue {
  mode: 'supabase' | 'local';
  email: string;
  signOut: () => void;
  idleMinutes: number;
}
const SessionCtx = createContext<SessionValue | null>(null);
export function useSession(): SessionValue {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('useSession outside AuthGate');
  return v;
}

type Phase =
  | { name: 'setup' }
  | { name: 'checking' }
  | { name: 'login'; message?: string }
  | { name: 'recovery' }
  | { name: 'not-member'; email: string }
  | { name: 'loading'; email: string }
  | { name: 'ready'; email: string; backend: Backend; initial: { data: AppData; versions: Map<string, number>; settingsVersion: number | null } }
  | { name: 'error'; message: string };

const LOCAL_MODE_KEY = 'create-agency-rms:local-mode';

async function loadInitial(backend: Backend) {
  const loaded = await backend.load();
  let settingsVersion = loaded.settingsVersion;
  if (settingsVersion === null) {
    // First time this database is used: store the default settings.
    try {
      settingsVersion = await backend.saveSettings(defaultSettings(), null);
    } catch {
      /* another teammate may have just created them; they'll load on next refresh */
    }
  }
  return {
    data: { settings: loaded.settings, projects: loaded.projects.map((x) => x.project) },
    versions: new Map(loaded.projects.map((x) => [x.project.id, x.version])),
    settingsVersion,
  };
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(() => readConfig());
  const [localMode, setLocalMode] = useState<boolean>(() => {
    try {
      return !readConfig() && localStorage.getItem(LOCAL_MODE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const client = useMemo<SupabaseClient | null>(
    () => (config ? createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } }) : null),
    [config],
  );
  const [phase, setPhase] = useState<Phase>(() => (config ? { name: 'checking' } : localMode ? { name: 'checking' } : { name: 'setup' }));
  // A password-reset link lands with #...type=recovery; hold the normal sign-in until a new password is set.
  const recovering = useRef(typeof window !== 'undefined' && /type=recovery/.test(window.location.hash));
  const entered = useRef(false);

  const enter = useCallback(
    async (email: string) => {
      if (!client) return;
      setPhase({ name: 'loading', email });
      try {
        const { data: member, error } = await client.rpc('is_member');
        if (error) throw error;
        if (!member) {
          setPhase({ name: 'not-member', email });
          return;
        }
        const backend = new SupabaseBackend(client);
        const initial = await loadInitial(backend);
        setPhase({ name: 'ready', email, backend, initial });
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        if (/JWT|jwt|401/.test(msg)) {
          await client.auth.signOut().catch(() => {});
          setPhase({ name: 'login', message: 'Please sign in again.' });
        } else if (/function .*is_member|Could not find the function|schema cache/i.test(msg)) {
          setPhase({ name: 'error', message: 'The database is not set up yet. Run supabase/schema.sql in the Supabase SQL Editor (see SETUP-GUIDE).' });
        } else {
          setPhase({ name: 'error', message: `Could not load your data: ${msg}` });
        }
      }
    },
    [client],
  );

  // Offline demo mode (no Supabase keys): data stays in this browser.
  useEffect(() => {
    if (!localMode || config) return;
    const backend = new LocalBackend();
    void loadInitial(backend).then((initial) => setPhase({ name: 'ready', email: 'Offline demo mode', backend, initial }));
  }, [localMode, config]);

  // Supabase session handling.
  useEffect(() => {
    if (!client) return;
    let alive = true;
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (event === 'PASSWORD_RECOVERY') {
        recovering.current = true;
        setPhase({ name: 'recovery' });
      } else if (event === 'SIGNED_OUT') {
        entered.current = false;
        setPhase((p) => (p.name === 'login' ? p : { name: 'login' }));
      } else if (event === 'SIGNED_IN' && session && !recovering.current && !entered.current) {
        entered.current = true;
        void enter(session.user.email ?? '');
      }
    });
    void client.auth.getSession().then(({ data }) => {
      if (!alive || recovering.current) return;
      if (data.session) {
        if (!entered.current) {
          entered.current = true;
          void enter(data.session.user.email ?? '');
        }
      } else setPhase((p) => (p.name === 'checking' ? { name: 'login' } : p));
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [client, enter]);

  const signOut = useCallback(
    async (message?: string) => {
      entered.current = false;
      if (client) await client.auth.signOut().catch(() => {});
      setPhase({ name: 'login', message });
    },
    [client],
  );

  // Automatic sign-out after a period without activity.
  const idleMinutes = config?.idleMinutes ?? 30;
  useEffect(() => {
    if (phase.name !== 'ready' || !client) return;
    let last = Date.now();
    const bump = () => (last = Date.now());
    const evs = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = window.setInterval(() => {
      if (Date.now() - last > idleMinutes * 60_000) void signOut(`You were signed out after ${idleMinutes} minutes without activity.`);
    }, 15_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(t);
    };
  }, [phase.name, client, idleMinutes, signOut]);

  if (phase.name === 'ready') {
    const session: SessionValue = {
      mode: phase.backend.kind,
      email: phase.email,
      idleMinutes,
      signOut: () => {
        if (phase.backend.kind === 'local') {
          try {
            localStorage.removeItem(LOCAL_MODE_KEY);
          } catch {
            /* ignore */
          }
          setLocalMode(false);
          setPhase({ name: 'setup' });
        } else void signOut();
      },
    };
    return (
      <SessionCtx.Provider value={session}>
        <StoreProvider key={phase.email} backend={phase.backend} initial={phase.initial} onAuthError={(m) => void signOut(m === new AuthError().message ? 'Your session ended. Please sign in again.' : m)}>
          {children}
        </StoreProvider>
      </SessionCtx.Provider>
    );
  }

  return (
    <Screen>
      {phase.name === 'setup' && (
        <SetupForm
          onSaved={() => setConfig(readConfig())}
          onLocal={() => {
            try {
              localStorage.setItem(LOCAL_MODE_KEY, '1');
            } catch {
              /* ignore */
            }
            setPhase({ name: 'checking' });
            setLocalMode(true);
          }}
        />
      )}
      {(phase.name === 'checking' || phase.name === 'loading') && <p className="py-10 text-center text-sm text-muted">{phase.name === 'loading' ? 'Loading your data…' : 'Checking your sign-in…'}</p>}
      {phase.name === 'login' && client && <LoginForm client={client} message={phase.message} />}
      {phase.name === 'recovery' && client && (
        <NewPasswordForm
          client={client}
          onDone={async () => {
            recovering.current = false;
            const { data } = await client.auth.getSession();
            if (data.session) {
              entered.current = true;
              void enter(data.session.user.email ?? '');
            } else setPhase({ name: 'login', message: 'Password updated. Please sign in.' });
          }}
        />
      )}
      {phase.name === 'not-member' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Access not approved</h2>
          <p className="text-sm text-muted">
            You signed in as <b>{phase.email}</b>, but this email is not on the C.R.E.A.T.E. team list. Ask Merlin to add you.
          </p>
          <Button variant="dark" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      )}
      {phase.name === 'error' && (
        <div className="space-y-4">
          <Notice tone="red">{phase.message}</Notice>
          <div className="flex flex-wrap gap-2">
            <Button variant="dark" onClick={() => location.reload()}>
              Try again
            </Button>
            <Button onClick={() => void signOut()}>Sign out</Button>
            {config?.source === 'browser' && (
              <Button
                onClick={() => {
                  clearBrowserConfig();
                  setConfig(null);
                  setPhase({ name: 'setup' });
                }}
              >
                Change database keys
              </Button>
            )}
          </div>
        </div>
      )}
    </Screen>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold tracking-wide text-ink">
            C.R.E.A.T.E.<span className="text-ochre">•</span>
          </p>
          <p className="mt-1 text-xs text-muted">Revenue & Project Finance — team access only</p>
        </div>
        <div className="rounded-3xl border border-line bg-white p-6 shadow-[0_10px_40px_rgba(45,41,40,0.06)] sm:p-8">{children}</div>
      </div>
    </div>
  );
}

function LoginForm({ client, message }: { client: SupabaseClient; message?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(message ?? null);
  const [forgot, setForgot] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    if (!email.trim()) return setErr('Enter your email.');
    setBusy(true);
    try {
      if (forgot) {
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + window.location.pathname });
        if (error && !/rate|limit/i.test(error.message)) throw error;
        setInfo('If that email is on the team, a password reset link is on its way. Check your inbox (and spam).');
        setForgot(false);
      } else {
        if (!password) throw new Error('Enter your password.');
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error(/invalid/i.test(error.message) ? 'Email or password is not correct.' : error.message);
      }
    } catch (e2) {
      const m = (e2 as Error).message;
      setErr(/fetch|network|load failed/i.test(m) ? 'Can’t reach the server. Check your internet connection and try again.' : m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h2 className="text-lg font-semibold text-ink">{forgot ? 'Reset your password' : 'Sign in'}</h2>
      {info && <Notice tone="blue">{info}</Notice>}
      {err && <Notice tone="red">{err}</Notice>}
      <div>
        <label htmlFor="login-email" className="label">
          Email
        </label>
        <input id="login-email" type="email" autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {!forgot && (
        <div>
          <label htmlFor="login-password" className="label">
            Password
          </label>
          <div className="relative">
            <input id="login-password" type={show ? 'text' : 'password'} autoComplete="current-password" className="input pr-16" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-muted hover:text-ink">
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
      )}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? 'Please wait…' : forgot ? 'Send reset link' : 'Sign in'}
      </Button>
      <button type="button" className="w-full text-center text-xs text-muted underline hover:text-ink" onClick={() => (setForgot((f) => !f), setErr(null))}>
        {forgot ? 'Back to sign in' : 'Forgot your password?'}
      </button>
    </form>
  );
}

function NewPasswordForm({ client, onDone }: { client: SupabaseClient; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 10) return setErr('Use at least 10 characters.');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true);
    const { error } = await client.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(error.message);
    onDone();
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h2 className="text-lg font-semibold">Choose a new password</h2>
      {err && <Notice tone="red">{err}</Notice>}
      <div>
        <label htmlFor="new-pw" className="label">
          New password (at least 10 characters)
        </label>
        <input id="new-pw" type="password" autoComplete="new-password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>
      <div>
        <label htmlFor="new-pw2" className="label">
          Type it again
        </label>
        <input id="new-pw2" type="password" autoComplete="new-password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </div>
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        Save new password
      </Button>
    </form>
  );
}

function SetupForm({ onSaved, onLocal }: { onSaved: () => void; onLocal: () => void }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const problem = saveBrowserConfig(url, key);
        if (problem) return setErr(problem);
        onSaved();
      }}
    >
      <h2 className="text-lg font-semibold">Connect your database</h2>
      <p className="text-sm text-muted">
        Paste the two values from Supabase → <b>Project Settings → API</b>. On the Netlify site these go in <code>config.js</code> instead, so teammates don’t need this step.
      </p>
      {err && <Notice tone="red">{err}</Notice>}
      <div>
        <label htmlFor="cfg-url" className="label">
          Project URL
        </label>
        <input id="cfg-url" className="input" placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div>
        <label htmlFor="cfg-key" className="label">
          anon / publishable key
        </label>
        <textarea id="cfg-key" rows={3} className="input font-mono text-xs" placeholder="eyJhbGciOi…  or  sb_publishable_…" value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      <Button type="submit" variant="primary" className="w-full">
        Save and continue
      </Button>
      <button type="button" onClick={onLocal} className="w-full text-center text-xs text-muted underline hover:text-ink">
        Try the offline demo instead (no password; data stays in this browser)
      </button>
    </form>
  );
}
