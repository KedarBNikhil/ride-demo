import type { AppLanguage } from '../i18n/createI18n';
import { demoAuthService } from './demoAuth';
import { supabase } from '../lib/supabase';
import { registerPushNotifications } from './pushNotifications';
import { isProductionAuthMode } from './authMode';
import { createProductionAuthService } from './productionAuth';

export type CaptainProfile = { name: string; language: AppLanguage; vehicleType: 'bike' | 'auto' | null };
export type CaptainDocumentType = 'license' | 'rc' | 'insurance';
export type CaptainDocument = { uri: string; name: string };
export type CaptainPayout = { method: 'bank' | 'upi'; accountNumber?: string; ifsc?: string; accountHolder?: string; upiId?: string };
const delay = (ms = 450) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const requiredDocumentTypes: CaptainDocumentType[] = ['license', 'rc', 'insurance'];

function requireSupabase() {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  return supabase;
}

async function currentCaptainUser() {
  const client = requireSupabase();
  const { data: { session } } = await client.auth.getSession();
  if (session?.user) return session.user;
  if (isProductionAuthMode) throw new Error('AUTHENTICATION_REQUIRED');
  const { data, error: signInError } = await client.auth.signInAnonymously();
  if (signInError?.code === 'anonymous_provider_disabled') throw new Error('DEMO_ANONYMOUS_SIGN_IN_DISABLED');
  if (signInError || !data.user) throw signInError ?? new Error('Unable to create a test captain session');
  return data.user;
}

function documentContentType(document: CaptainDocument) {
  const extension = document.name.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function payoutDetails(payout: CaptainPayout) {
  return payout.method === 'bank'
    ? { account_number: payout.accountNumber?.trim(), ifsc: payout.ifsc?.trim(), account_holder: payout.accountHolder?.trim() }
    : { upi_id: payout.upiId?.trim() };
}

/** Replace these functions with API calls later; screens depend only on this contract. */
export const captainOnboardingService = {
  sendOtp: isProductionAuthMode ? createProductionAuthService('captain').sendOtp : demoAuthService.sendOtp,
  async verifyOtp(phone: string, otp: string) {
    if (isProductionAuthMode) {
      await createProductionAuthService('captain').verifyOtp(phone, otp);
      void registerPushNotifications('captain').catch(() => undefined);
      return { verified: true };
    }
    await demoAuthService.verifyOtp(phone, otp);
    await currentCaptainUser();
    void registerPushNotifications('captain').catch(() => undefined);
    return { verified: true };
  },
  async saveProfile(profile: CaptainProfile) {
    if (!profile.vehicleType) throw new Error('Choose a vehicle type');
    const user = await currentCaptainUser();
    const client = requireSupabase();
    const { error: profileError } = await client.from('profiles').update({ full_name: profile.name.trim(), preferred_language: profile.language }).eq('id', user.id);
    if (profileError) throw profileError;
    const { error } = await client.from('captain_onboarding_applications').upsert({
      user_id: user.id,
      full_name: profile.name.trim(),
      preferred_language: profile.language,
      vehicle_type: profile.vehicleType,
      status: 'draft',
    }, { onConflict: 'user_id' });
    if (error) throw error;
    return { ...profile, id: user.id };
  },
  async saveDocuments(documents: Record<CaptainDocumentType, CaptainDocument>) {
    const user = await currentCaptainUser();
    const client = requireSupabase();
    const { data: application, error: applicationError } = await client
      .from('captain_onboarding_applications').select('id').eq('user_id', user.id).eq('status', 'draft').single();
    if (applicationError || !application) throw applicationError ?? new Error('Start your captain profile before uploading documents');

    for (const type of requiredDocumentTypes) {
      const document = documents[type];
      const response = await fetch(document.uri);
      const file = await response.arrayBuffer();
      const extension = document.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${user.id}/${type}-${Date.now()}.${extension}`;
      const contentType = documentContentType(document);
      const { error: uploadError } = await client.storage.from('captain-documents').upload(path, file, { contentType, upsert: false });
      if (uploadError) throw uploadError;
      const { error: documentError } = await client.from('captain_onboarding_documents').upsert({
        application_id: application.id,
        user_id: user.id,
        document_type: type,
        storage_path: path,
        verification_status: 'pending',
      }, { onConflict: 'application_id,document_type' });
      if (documentError) throw documentError;
    }
    return { submitted: true };
  },
  async savePayout(payout: CaptainPayout) {
    const user = await currentCaptainUser();
    const { error } = await requireSupabase().from('captain_onboarding_applications').update({
      payout_method: payout.method,
      payout_details: payoutDetails(payout),
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    }).eq('user_id', user.id);
    if (error) throw error;
    return { submitted: true };
  },
  async getReviewStatus() {
    const user = await currentCaptainUser();
    const { data, error } = await requireSupabase().from('captain_onboarding_applications').select('status').eq('user_id', user.id).single();
    if (error) throw error;
    return data.status as 'draft' | 'submitted' | 'approved' | 'rejected';
  },
};
