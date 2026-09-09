import { supabase } from '../lib/supabase';

export type EmergencyContact = { id: string; contactName: string; phoneNumber: string; createdAt: string };

type EmergencyContactRow = { id: string; contact_name: string; phone_number: string; created_at: string };

function toContact(row: EmergencyContactRow): EmergencyContact {
  return { id: row.id, contactName: row.contact_name, phoneNumber: row.phone_number, createdAt: row.created_at };
}

async function requireUserId(): Promise<string> {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('AUTH_REQUIRED');
  return data.user.id;
}

export const emergencyContactsService = {
  async list(): Promise<EmergencyContact[]> {
    if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
    const { data, error } = await supabase
      .from('emergency_contacts')
      .select('id, contact_name, phone_number, created_at')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(toContact);
  },

  async add(contactName: string, phoneNumber: string): Promise<EmergencyContact> {
    if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from('emergency_contacts')
      .insert({ user_id: userId, contact_name: contactName.trim(), phone_number: phoneNumber.trim() })
      .select('id, contact_name, phone_number, created_at')
      .single();
    if (error) throw error;
    return toContact(data as EmergencyContactRow);
  },

  async remove(id: string): Promise<void> {
    if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
    const { error } = await supabase.from('emergency_contacts').delete().eq('id', id);
    if (error) throw error;
  },
};
