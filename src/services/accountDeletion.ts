import { supabase } from '../lib/supabase';

export async function deleteCurrentAccount(appVariant: 'customer' | 'captain') {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  const { error } = await supabase.rpc('delete_current_account', { p_app_variant: appVariant });
  if (error) throw error;
  const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
  if (signOutError) throw signOutError;
}
