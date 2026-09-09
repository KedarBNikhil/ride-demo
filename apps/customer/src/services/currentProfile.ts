import { supabase } from '../lib/supabase';

export type CurrentProfile = { name: string | null; phone: string | null };

export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  if (!supabase) return null;
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw userError ?? new Error('AUTHENTICATION_REQUIRED');
  const { data, error } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  if (error) throw error;
  return { name: data?.full_name?.trim() || null, phone: user.phone ?? null };
}
