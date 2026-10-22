import type { AppLanguage } from '../i18n/createI18n';
import { supabase } from '../lib/supabase';
import { registerPushNotifications } from './pushNotifications';
import { createProductionAuthService } from './productionAuth';
import { normalizeAccountHolder, normalizeAccountNumber, normalizeIfsc, normalizeUpi, payoutIsValid } from '../utils/payoutValidation';

export type CaptainProfile = { name: string; language: AppLanguage; vehicleType: 'bike' | 'auto' | null; vehiclePlateNumber: string };
export type CaptainAccountStatus = 'unauthenticated' | 'new' | 'draft' | 'submitted' | 'approved' | 'rejected';
export type CaptainOnboardingRoute = 'signup' | 'profile' | 'documents' | 'payout' | 'review';
export type CaptainAccount = { status: CaptainAccountStatus; profile: CaptainProfile; onboardingRoute: CaptainOnboardingRoute };
export type CaptainDocumentType = 'license' | 'rc' | 'insurance';
export type CaptainDocument = { uri: string; name: string };
export type CaptainDocumentPair = { front: CaptainDocument; back: CaptainDocument };
export type CaptainPayout = { method: 'bank' | 'upi'; accountNumber?: string; confirmAccountNumber?: string; ifsc?: string; accountHolder?: string; upiId?: string };
const delay = (ms = 450) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const requiredDocumentTypes: CaptainDocumentType[] = ['license', 'rc', 'insurance'];
const productionAuth = createProductionAuthService('captain');

function requireSupabase() {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  return supabase;
}

async function currentCaptainUser() {
  const client = requireSupabase();
  const { data: { session } } = await client.auth.getSession();
  if (session?.user) return session.user;
  throw new Error('AUTHENTICATION_REQUIRED');
}

/**
 * Resolves the authenticated Captain from backend-owned records only. This is
 * intentionally shared by cold-start bootstrap and post-OTP completion: a
 * missing local cache must never decide whether a Captain is new.
 */
async function resolveAuthenticatedCaptainAccount(): Promise<CaptainAccount> {
  const client = requireSupabase();
  const { data: { session } } = await client.auth.getSession();
  if (!session?.user) return { status: 'unauthenticated', profile: { name: '', language: 'en', vehicleType: null, vehiclePlateNumber: '' }, onboardingRoute: 'signup' };

  // getUser validates the session with Auth rather than trusting a locally
  // restored session object before querying Captain-owned rows under RLS.
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user || user.id !== session.user.id) throw userError ?? new Error('AUTHENTICATION_REQUIRED');

  const [{ data: application, error: applicationError }, { data: captainProfile, error: captainProfileError }, { data: documents, error: documentsError }] = await Promise.all([
    client.from('captain_onboarding_applications').select('full_name, preferred_language, vehicle_type, vehicle_plate_number, status').eq('user_id', user.id).maybeSingle(),
    client.from('captain_profiles').select('vehicle_type').eq('user_id', user.id).maybeSingle(),
    client.from('captain_onboarding_documents').select('document_type').eq('user_id', user.id),
  ]);
  if (applicationError) throw applicationError;
  if (captainProfileError) throw captainProfileError;
  if (documentsError) throw documentsError;

  const profile: CaptainProfile = application
    ? {
      name: application.full_name?.trim() ?? '',
      language: application.preferred_language === 'te' ? 'te' : 'en',
      vehicleType: application.vehicle_type === 'bike' || application.vehicle_type === 'auto' ? application.vehicle_type : null,
      vehiclePlateNumber: application.vehicle_plate_number?.trim() ?? '',
    }
    : { name: '', language: 'en', vehicleType: captainProfile?.vehicle_type === 'bike' || captainProfile?.vehicle_type === 'auto' ? captainProfile.vehicle_type : null, vehiclePlateNumber: '' };

  // Approved applications normally have a Captain profile (created by the
  // approval trigger). A legacy Captain profile is also an established account
  // and must never be sent through profile creation again.
  if (captainProfile || application?.status === 'approved') return { status: 'approved', profile, onboardingRoute: 'review' };
  if (application?.status === 'draft') {
    if (!profile.vehiclePlateNumber) return { status: 'draft', profile, onboardingRoute: 'profile' };
    const completedDocumentTypes = new Set(documents?.map((document) => document.document_type));
    return { status: 'draft', profile, onboardingRoute: completedDocumentTypes.size === requiredDocumentTypes.length ? 'payout' : 'documents' };
  }
  if (application) return { status: application.status as Extract<CaptainAccountStatus, 'submitted' | 'rejected'>, profile, onboardingRoute: 'review' };
  return { status: 'new', profile, onboardingRoute: 'profile' };
}

function documentContentType(document: CaptainDocument) {
  const extension = document.name.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function payoutDetails(payout: CaptainPayout) {
  return payout.method === 'bank'
    ? { account_number: normalizeAccountNumber(payout.accountNumber ?? ''), ifsc: normalizeIfsc(payout.ifsc ?? ''), account_holder: normalizeAccountHolder(payout.accountHolder ?? '') }
    : { upi_id: normalizeUpi(payout.upiId ?? '') };
}

/** Replace these functions with API calls later; screens depend only on this contract. */
export const captainOnboardingService = {
  sendOtp: productionAuth.sendOtp,
  async verifyOtp(phone: string, otp: string) {
    await productionAuth.verifyOtp(phone, otp);
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
      vehicle_plate_number: profile.vehiclePlateNumber.trim().toUpperCase(),
      status: 'draft',
    }, { onConflict: 'user_id' });
    if (error) throw error;
    return { ...profile, id: user.id };
  },
  async saveDocuments(documents: Record<CaptainDocumentType, CaptainDocumentPair>) {
    const user = await currentCaptainUser();
    const client = requireSupabase();
    const { data: application, error: applicationError } = await client
      .from('captain_onboarding_applications').select('id').eq('user_id', user.id).eq('status', 'draft').single();
    if (applicationError || !application) throw applicationError ?? new Error('Start your captain profile before uploading documents');

    for (const type of requiredDocumentTypes) {
      const document = documents[type];
      const timestamp = Date.now();
      const uploadSide = async (side: 'front' | 'back', selected: CaptainDocument) => {
        const response = await fetch(selected.uri);
        const file = await response.arrayBuffer();
        const extension = selected.name.split('.').pop()?.toLowerCase() || 'jpg';
        const path = `${user.id}/${type}-${side}-${timestamp}.${extension}`;
        const { error: uploadError } = await client.storage.from('captain-documents').upload(path, file, { contentType: documentContentType(selected), upsert: false });
        if (uploadError) throw uploadError;
        return path;
      };
      const storagePath = await uploadSide('front', document.front);
      const backStoragePath = await uploadSide('back', document.back);
      const { error: documentError } = await client.from('captain_onboarding_documents').upsert({
        application_id: application.id,
        user_id: user.id,
        document_type: type,
        storage_path: storagePath,
        back_storage_path: backStoragePath,
        verification_status: 'pending',
      }, { onConflict: 'application_id,document_type' });
      if (documentError) throw documentError;
    }
    return { submitted: true };
  },
  async savePayout(payout: CaptainPayout) {
    if (!payoutIsValid(payout.method, payout)) throw new Error('Invalid payout details');
    const user = await currentCaptainUser();
    const { data: submittedApplication, error } = await requireSupabase().from('captain_onboarding_applications').update({
      payout_method: payout.method,
      payout_details: payoutDetails(payout),
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    }).eq('user_id', user.id).select('id').maybeSingle();
    if (error) throw error;
    if (!submittedApplication) throw new Error('PAYOUT_APPLICATION_NOT_FOUND');
    // The server calculates hashes from the stored upload bytes. A failure to
    // match (or an unavailable test program) deliberately leaves the normal
    // manual-review path unchanged.
    const { data: testApproval, error: testApprovalError } = await requireSupabase().functions.invoke<{ autoApproved?: boolean }>('auto-approve-test-captain');
    if (testApprovalError) {
      // The payout submission is already durable; do not strand a Captain if
      // the optional closed-test approval check is temporarily unavailable.
      return { submitted: true, autoApproved: false };
    }
    return { submitted: true, autoApproved: testApproval?.autoApproved === true };
  },
  async getReviewStatus() {
    const user = await currentCaptainUser();
    const { data, error } = await requireSupabase().from('captain_onboarding_applications').select('status').eq('user_id', user.id).single();
    if (error) throw error;
    return data.status as 'draft' | 'submitted' | 'approved' | 'rejected';
  },
  resolveAuthenticatedAccount: resolveAuthenticatedCaptainAccount,
};
