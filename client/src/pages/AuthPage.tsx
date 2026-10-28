import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form.email, form.name, form.password);
      // LoginRoute redirects as soon as the user is set.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <main className="auth">
      <div className="auth-intro">
        <div className="brand brand-lg">
          <span className="brand-mark">{'</>'}</span> CodeSync
        </div>
        <h1>Write code together, in real time.</h1>
        <p>
          Share a link and pair-program instantly. Live cursors, conflict-free editing, and runs that everyone in the
          room can see.
        </p>
      </div>

      <form className="card auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
        {mode === 'register' && (
          <label>
            Name
            <input value={form.name} onChange={set('name')} required maxLength={60} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={mode === 'register' ? 8 : 1}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <p className="muted switch">
          {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </form>
    </main>
  );
}
