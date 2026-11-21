import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';

export type SavedAddress = { id: string; label: string; address: string; latitude: number; longitude: number; created_at: string };
export type SavedAddressInput = { label: string; address: string; latitude: number; longitude: number };

const normalize = (row: Record<string, unknown>): SavedAddress => ({ id: String(row.id), label: String(row.label), address: String(row.address), latitude: Number(row.latitude), longitude: Number(row.longitude), created_at: String(row.created_at) });

async function customerId() { const { data: { user }, error } = await getSupabaseClient().auth.getUser(); if (error || !user) throw new Error('CUSTOMER_AUTH_REQUIRED'); return user.id; }

export const customerSavedAddressesService = {
  isEnabled: isSupabaseConfigured,
  async list(): Promise<SavedAddress[]> { if (!isSupabaseConfigured) return []; const { data, error } = await getSupabaseClient().from('customer_saved_addresses').select('*').order('created_at', { ascending: true }); if (error) throw error; return (data ?? []).map((row) => normalize(row as Record<string, unknown>)); },
  async save(input: SavedAddressInput): Promise<SavedAddress> { const client = getSupabaseClient(); const customer_id = await customerId(); const { data, error } = await client.from('customer_saved_addresses').upsert({ customer_id, ...input, label: input.label.trim(), address: input.address.trim() }, { onConflict: 'customer_id,label' }).select().single(); if (error) throw error; return normalize(data as Record<string, unknown>); },
  async remove(id: string) { const { error } = await getSupabaseClient().from('customer_saved_addresses').delete().eq('id', id); if (error) throw error; },
};
