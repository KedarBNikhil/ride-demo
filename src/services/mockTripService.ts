const delay = (ms = 300) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const expectedPickupOtp = '1234';
export type CustomerRating = { stars: number; note: string };
let latestCustomerRating: CustomerRating | null = null;
/** Demo trip contract; replace OTP validation, payment, and rating calls with backend APIs later. */
export const mockTripService = {
  async validatePickupOtp(otp: string) { await delay(); return otp === expectedPickupOtp; },
  async confirmCashReceived() { await delay(); return { confirmed: true }; },
  async saveCustomerRating(rating: CustomerRating) { await delay(); latestCustomerRating = rating; return latestCustomerRating; },
};
