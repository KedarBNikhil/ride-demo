import type { AppLanguage } from '../i18n/createI18n';

export type CaptainProfile = { name: string; language: AppLanguage; vehicleType: 'bike' | 'auto' | null };
export type CaptainDocumentType = 'license' | 'rc' | 'insurance';
export type CaptainDocument = { uri: string; name: string };
export type CaptainPayout = { method: 'bank' | 'upi'; accountNumber?: string; ifsc?: string; accountHolder?: string; upiId?: string };
const delay = (ms = 450) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Replace these functions with API calls later; screens depend only on this contract. */
export const captainOnboardingService = {
  async sendOtp(phone: string) { await delay(); return { requestId: `otp-${phone.slice(-4)}` }; },
  async verifyOtp(_phone: string, _otp: string) { await delay(); return { verified: true }; },
  async saveProfile(profile: CaptainProfile) { await delay(); return { ...profile, id: 'captain-demo-001' }; },
  async saveDocuments(_documents: Record<CaptainDocumentType, CaptainDocument>) { await delay(); return { approved: true }; },
  async savePayout(_payout: CaptainPayout) { await delay(); return { saved: true }; },
};
