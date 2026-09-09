const DEVELOPMENT_OTP = '1234';

const delay = (ms = 350) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Demo-only phone adapter. No SMS is sent and only OTP 1234 is accepted. */
export const demoAuthService = {
  async sendOtp(phone: string) {
    await delay();
    return { requestId: `demo-otp-${phone.slice(-4)}` };
  },
  async verifyOtp(_phone: string, otp: string) {
    await delay();
    if (otp !== DEVELOPMENT_OTP) throw new Error('Invalid development OTP');
    return { verified: true };
  },
};
