import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Card } from '@/components/ui';

type Channel = 'phone' | 'email';

export function LoginPage() {
  const { signInWithPhone, verifyOtp, signInWithEmail, verifyEmailOtp } = useAuth();
  const [channel, setChannel] = useState<Channel>('phone');
  const [destination, setDestination] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'input' | 'verify'>('input');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      if (channel === 'phone') await signInWithPhone(destination.replace(/\s/g, ''));
      else await signInWithEmail(destination.trim());
      setStage('verify');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setError(null);
    setBusy(true);
    try {
      if (channel === 'phone') await verifyOtp(destination.replace(/\s/g, ''), code.trim());
      else await verifyEmailOtp(destination.trim(), code.trim());
      // AuthProvider picks up the session; operator gate decides access.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-1 text-lg font-bold text-slate-900">Nandyal Ride — Operator Dashboard</div>
        <p className="mb-5 text-xs text-slate-500">
          Sign in with the phone number or email registered to a settlement operator account.
        </p>

        <div className="mb-4 flex rounded-lg bg-slate-100 p-1 text-sm font-medium">
          {(['phone', 'email'] as Channel[]).map((c) => (
            <button
              key={c}
              onClick={() => {
                setChannel(c);
                setStage('input');
                setError(null);
              }}
              className={`flex-1 rounded-md py-1.5 capitalize transition-colors ${
                channel === c ? 'bg-white text-slate-900 shadow' : 'text-slate-500'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {stage === 'input' ? (
          <>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {channel === 'phone' ? 'Phone (E.164, e.g. +9198…)' : 'Email'}
            </label>
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && destination && void sendCode()}
              placeholder={channel === 'phone' ? '+91…' : 'operator@example.com'}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <button
              disabled={busy || !destination}
              onClick={() => void sendCode()}
              className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {busy ? 'Sending…' : `Send code`}
            </button>
          </>
        ) : (
          <>
            <p className="mb-2 text-xs text-slate-500">Enter the 6-digit code sent to {destination}.</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && code && void submitCode()}
              inputMode="numeric"
              autoFocus
              className="tabular w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.4em] focus:border-indigo-500 focus:outline-none"
            />
            <button
              disabled={busy || code.length === 0}
              onClick={() => void submitCode()}
              className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {busy ? 'Verifying…' : 'Verify & sign in'}
            </button>
          </>
        )}

        {error ? <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div> : null}
      </Card>
    </div>
  );
}
