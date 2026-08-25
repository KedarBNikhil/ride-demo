import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

type OperatorStatus = 'loading' | 'authorized' | 'unauthorized' | 'signed_out';

interface AuthState {
  session: Session | null;
  status: OperatorStatus;
  phone: string | null;
  signInWithPhone: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, token: string) => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function checkOperator(session: Session | null): Promise<OperatorStatus> {
  if (!session || !supabase) return 'signed_out';
  const { data, error } = await supabase.rpc('is_settlement_operator');
  if (error) {
    console.error('Operator check failed', error.message);
    return 'unauthorized';
  }
  return data === true ? 'authorized' : 'unauthorized';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<OperatorStatus>('loading');

  const refresh = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    setStatus(await checkOperator(nextSession));
  }, []);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => refresh(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => refresh(nextSession));
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      status,
      phone: session?.user.phone ?? session?.user.email ?? null,
      async signInWithPhone(phone) {
        const { error } = await supabase!.auth.signInWithOtp({ phone });
        if (error) throw new Error(error.message);
      },
      async verifyOtp(phone, token) {
        const { error } = await supabase!.auth.verifyOtp({ phone, token, type: 'sms' });
        if (error) throw new Error(error.message);
      },
      async signInWithEmail(email) {
        const { error } = await supabase!.auth.signInWithOtp({ email });
        if (error) throw new Error(error.message);
      },
      async verifyEmailOtp(email, token) {
        const { error } = await supabase!.auth.verifyOtp({ email, token, type: 'email' });
        if (error) throw new Error(error.message);
      },
      async signOut() {
        await supabase!.auth.signOut();
        setStatus('signed_out');
      },
    }),
    [session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
